/**
 * 自动成片（MoneyPrinterTurbo）状态与动作
 *
 * 一条链路：文案 → moark 配音 → moark 字幕时间轴 → 本机 MPT 配素材合成 → ffmpeg 烧字幕。
 * 页面切走再切回来，状态不丢（单例）。
 */
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import { useMoarkAccount } from '@/composables/useMoarkAccount'
import type {
  AutoVideoProbe,
  AutoVideoProgress,
  AutoVideoResult,
  AutoVideoVoice,
  PublishPack,
  SubtitleStyle,
  SynthAudioResult,
} from '@/types/auto-video'

/** 素材画面类型：界面文案 → Pexels 搜索词 */
export const MATERIAL_TERMS: Array<{ label: string; emoji: string; term: string }> = [
  { label: '风景', emoji: '🏞', term: 'scenery' },
  { label: '山川', emoji: '⛰', term: 'mountains' },
  { label: '河流', emoji: '🌊', term: 'river' },
  { label: '人物', emoji: '👤', term: 'people' },
  { label: '城市', emoji: '🏙', term: 'city' },
  { label: '科技', emoji: '💻', term: 'technology' },
  { label: '动物', emoji: '🐾', term: 'animals' },
  { label: '美食', emoji: '🍜', term: 'food' },
  { label: '健身', emoji: '🏃', term: 'fitness' },
  { label: '办公', emoji: '🏢', term: 'office' },
  { label: '日出日落', emoji: '🌅', term: 'sunrise' },
  { label: '抽象', emoji: '🎨', term: 'abstract' },
]

const VOICE_STORAGE_KEY = 'fsa.autovideo.voice'
const STYLE_STORAGE_KEY = 'fsa.autovideo.substyle'

function loadStyle(): SubtitleStyle {
  try {
    const raw = window.localStorage.getItem(STYLE_STORAGE_KEY)
    if (raw) return { ...DEFAULT_STYLE, ...(JSON.parse(raw) as SubtitleStyle) }
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULT_STYLE }
}

const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Microsoft YaHei',
  fontSize: 60,
  textColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2.5,
}

function isProbe(value: unknown): value is AutoVideoProbe {
  return typeof value === 'object' && value !== null && 'mptReady' in value
}

function isResult(value: unknown): value is AutoVideoResult {
  return typeof value === 'object' && value !== null && 'videoUrl' in value
}

/**
 * 输入框里的是「已经写好的成品稿」还是「一个主题」？
 * 既然是成品稿就没必要再让 AI 重写一遍（一次要等二三十秒，用户只会觉得点了没反应）。
 */
function isFinishedScript(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length >= 2) return true
  return text.length >= 60 && /[。！？；，]/.test(text)
}

let shared: ReturnType<typeof useAutoVideoImpl> | null = null

function useAutoVideoImpl() {
  const { ensureReady, ensureLoggedIn } = useMoarkAccount()
  /** 输入框：可以是主题，也可以是已经写好的整段文案 */
  const input = ref('')
  const script = ref('')
  const title = ref('')
  const desc = ref('')
  const tags = ref<string[]>([])

  const source = ref<'pexels' | 'local'>('pexels')
  const terms = ref<string[]>([])
  const videoCount = ref(1)
  const aspect = ref<'9:16' | '16:9' | '1:1'>('9:16')
  const language = ref<'zh-CN' | 'en-US'>('zh-CN')
  const seconds = ref(45)

  const voiceFilePath = ref(window.localStorage.getItem(VOICE_STORAGE_KEY) ?? '')
  const voiceRate = ref(1)
  const voiceVolume = ref(1.8)

  const subtitleEnabled = ref(true)
  const subtitleStyle = ref<SubtitleStyle>(loadStyle())

  const probe = ref<AutoVideoProbe | null>(null)
  const isRunning = ref(false)
  const isGeneratingScript = ref(false)
  const isPreviewing = ref(false)
  const isPacking = ref(false)
  const elapsedMs = ref(0)
  const progress = ref<AutoVideoProgress | null>(null)
  const logs = ref<string[]>([])
  const result = ref<AutoVideoResult | null>(null)
  const previewAudioUrl = ref('')
  const previewAudioPath = ref('')

  let timer: number | undefined
  let startedAt = 0

  const voices = computed<AutoVideoVoice[]>(() => probe.value?.voices ?? [])
  const selectedVoice = computed<AutoVideoVoice | undefined>(() =>
    voices.value.find((v) => v.filePath === voiceFilePath.value),
  )
  const ready = computed(() => !!probe.value?.mptReady)
  const hasVoice = computed(() => !!voiceFilePath.value)
  const percent = computed(() => progress.value?.percent ?? 0)
  const elapsedText = computed(() => {
    const sec = Math.round(elapsedMs.value / 1000)
    const m = Math.floor(sec / 60)
    return m > 0 ? `${m} 分 ${sec % 60} 秒` : `${sec} 秒`
  })

  function startTimer(): void {
    startedAt = Date.now()
    elapsedMs.value = 0
    if (timer) window.clearInterval(timer)
    timer = window.setInterval(() => {
      elapsedMs.value = Date.now() - startedAt
    }, 500)
  }

  function stopTimer(): void {
    if (timer) {
      window.clearInterval(timer)
      timer = undefined
    }
    if (startedAt > 0) elapsedMs.value = Date.now() - startedAt
  }

  function pushLog(detail?: string): void {
    if (!detail) return
    const line = detail.trim()
    if (!line) return
    logs.value = [...logs.value.slice(-5), line]
  }

  // 进度事件只挂一次
  window.desktopApi.onAutoVideoProgress((p: unknown) => {
    const data = p as AutoVideoProgress
    progress.value = data
    if (data.detail) pushLog(data.detail)
  })

  async function refreshProbe(): Promise<void> {
    try {
      const data = await window.desktopApi.probeAutoVideo()
      if (isProbe(data)) {
        probe.value = data
        // 之前选的音色被删了 → 回到第一个
        if (!data.voices.some((v) => v.filePath === voiceFilePath.value)) {
          voiceFilePath.value = data.voices[0]?.filePath ?? ''
          persistVoice()
        }
        if (data.localMaterials === 0 && source.value === 'local') source.value = 'pexels'
      }
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }

  function persistVoice(): void {
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, voiceFilePath.value)
    } catch {
      /* 忽略 */
    }
  }

  function selectVoice(filePath: string): void {
    voiceFilePath.value = filePath
    persistVoice()
  }

  function toggleTerm(term: string): void {
    terms.value = terms.value.includes(term)
      ? terms.value.filter((t) => t !== term)
      : [...terms.value, term]
  }

  function saveStyle(): void {
    try {
      window.localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(subtitleStyle.value))
    } catch {
      /* 忽略 */
    }
  }

  /** 主题 → 文案（写进 textarea 和 script） */
  async function generateScript(): Promise<void> {
    const subject = input.value.trim()
    if (!subject) {
      ElMessage.warning('先写个主题，或者直接粘一段写好的文案')
      return
    }
    if (!ensureReady()) return
    isGeneratingScript.value = true
    try {
      const text = await window.desktopApi.generateAutoVideoScript({
        subject,
        seconds: seconds.value,
        profile: window.localStorage.getItem('fsa.creator.profile') ?? '',
      })
      const content = typeof text === 'string' ? text : ''
      if (!content.trim()) throw new Error('文案生成返回为空')
      script.value = content
      input.value = content
      ElMessage.success(`文案写好了，共 ${content.length} 字`)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    } finally {
      isGeneratingScript.value = false
    }
  }

  /** 标题 / 简介 / 话题 */
  async function generatePack(): Promise<void> {
    const content = (input.value.trim() || script.value.trim()).trim()
    if (!content) {
      ElMessage.warning('先有文案再生成标题')
      return
    }
    if (!ensureReady()) return
    isPacking.value = true
    try {
      const data = (await window.desktopApi.generateAutoVideoPack(content)) as PublishPack
      title.value = data?.title ?? ''
      desc.value = data?.desc ?? ''
      tags.value = data?.tags ?? []
      ElMessage.success('标题、简介、话题都出来了')
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    } finally {
      isPacking.value = false
    }
  }

  /** 试听：只合成配音 */
  async function previewVoice(): Promise<void> {
    const content = (script.value || input.value).trim()
    if (!content) {
      ElMessage.warning('先写点文案再试听')
      return
    }
    if (!hasVoice.value) {
      ElMessage.warning('还没有音色，先在「选择声音」里导入一段人声样本')
      return
    }
    if (!ensureLoggedIn()) return
    isPreviewing.value = true
    try {
      const data = (await window.desktopApi.previewAutoVideoAudio({
        text: content,
        voiceFilePath: voiceFilePath.value,
        voiceRate: voiceRate.value,
        voiceVolume: voiceVolume.value,
      })) as SynthAudioResult
      previewAudioUrl.value = data?.url ?? ''
      previewAudioPath.value = data?.filePath ?? ''
      const audio = new Audio(previewAudioUrl.value)
      await audio.play().catch(() => undefined)
      ElMessage.success('配音好了，正在播')
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    } finally {
      isPreviewing.value = false
    }
  }

  async function run(asSubject: boolean): Promise<void> {
    if (isRunning.value || isGeneratingScript.value) return
    if (!ready.value) {
      ElMessage.error('本机还没装好 MoneyPrinterTurbo（或路径不对）')
      return
    }
    if (!hasVoice.value) {
      ElMessage.warning('还没有音色：先在工作流页的「配音」里导入一段 10~20 秒人声')
      return
    }
    if (!ensureLoggedIn()) return

    const raw = input.value.trim()
    if (!raw) {
      ElMessage.warning('先写个主题，或者粘一段写好的文案')
      return
    }

    // 「一键生成」默认把输入框当主题先写稿；但输入框里已经是成品稿就直接用，别白等 AI 重写
    // 「用此文案」永远以输入框为准（script 只是生成结果的镜像，用户改过就过期了）
    let content = raw
    const looksLikeScript = isFinishedScript(raw)
    if (asSubject && looksLikeScript) {
      ElMessage.info('输入框里已经是成品稿，直接开跑，不再重写')
    }
    if (asSubject && !looksLikeScript) {
      isGeneratingScript.value = true
      try {
        const text = await window.desktopApi.generateAutoVideoScript({
          subject: raw,
          seconds: seconds.value,
          profile: window.localStorage.getItem('fsa.creator.profile') ?? '',
        })
        content = typeof text === 'string' ? text : ''
        if (!content.trim()) throw new Error('文案生成失败：返回为空')
        script.value = content
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
        isGeneratingScript.value = false
        return
      } finally {
        isGeneratingScript.value = false
      }
    }

    isRunning.value = true
    result.value = null
    logs.value = []
    progress.value = { stage: 'audio', label: '准备中…', percent: 3 }
    startTimer()

    try {
      const payload = {
        script: content,
        source: source.value,
        terms: [...terms.value],
        videoCount: videoCount.value,
        aspect: aspect.value,
        voiceFilePath: voiceFilePath.value,
        voiceRate: voiceRate.value,
        voiceVolume: voiceVolume.value,
        subtitleEnabled: subtitleEnabled.value,
        // ⚠️ 必须是纯对象：Vue 的响应式代理过不了 Electron 的结构化克隆
        subtitleStyle: { ...subtitleStyle.value },
        title: title.value,
      }
      const data = await window.desktopApi.runAutoVideo(payload)
      if (!isResult(data)) throw new Error('成片返回结果异常')
      result.value = data
      ElMessage.success(`成片好了：${data.videoPath.split(/[\\/]/).pop()}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/abort|cancel|已取消/i.test(message)) {
        ElMessage.info('已停止')
      } else {
        ElMessage.error(message)
      }
    } finally {
      isRunning.value = false
      stopTimer()
    }
  }

  async function stop(): Promise<void> {
    if (!isRunning.value) return
    await window.desktopApi.cancelAutoVideo()
    isRunning.value = false
    stopTimer()
    ElMessage.info('已停止')
  }

  async function openOutDir(): Promise<void> {
    try {
      await window.desktopApi.openAutoVideoDir()
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }

  function revealVideo(): void {
    if (result.value) void window.desktopApi.revealAutoVideo(result.value.videoPath)
  }

  async function copyAllText(): Promise<void> {
    const text = (script.value || input.value).trim()
    if (!text) {
      ElMessage.warning('还没有内容可复制')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success('已复制到剪贴板')
    } catch {
      ElMessage.warning('复制失败，请手动选中复制')
    }
  }

  async function copyPublishText(): Promise<void> {
    const body = [title.value, desc.value, tags.value.map((t) => `#${t}`).join(' ')]
      .filter(Boolean)
      .join('\n')
    if (!body.trim()) {
      ElMessage.warning('先点「一键生成标题/简介/话题」')
      return
    }
    try {
      await navigator.clipboard.writeText(body)
      ElMessage.success('标题 / 简介 / 话题已复制，去平台粘贴发布')
    } catch {
      ElMessage.warning('复制失败，请手动复制')
    }
  }

  function resetAll(): void {
    input.value = ''
    script.value = ''
    title.value = ''
    desc.value = ''
    tags.value = []
    logs.value = []
    progress.value = null
  }

  return {
    input,
    script,
    title,
    desc,
    tags,
    source,
    terms,
    videoCount,
    aspect,
    language,
    seconds,
    voiceFilePath,
    voiceRate,
    voiceVolume,
    subtitleEnabled,
    subtitleStyle,
    probe,
    isRunning,
    isGeneratingScript,
    isPreviewing,
    isPacking,
    elapsedText,
    progress,
    percent,
    logs,
    result,
    previewAudioUrl,
    previewAudioPath,
    voices,
    selectedVoice,
    ready,
    hasVoice,
    refreshProbe,
    selectVoice,
    toggleTerm,
    saveStyle,
    generateScript,
    generatePack,
    previewVoice,
    run,
    stop,
    openOutDir,
    revealVideo,
    copyAllText,
    copyPublishText,
    resetAll,
  }
}

export function useAutoVideo() {
  if (!shared) shared = useAutoVideoImpl()
  return shared
}
