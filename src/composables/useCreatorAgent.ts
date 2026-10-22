/**
 * 创作台（东哥智能体移植）
 *
 * 走的是和抖音提取 / 文案创作同一份模力方舟中央账户，模型 Qwen3-32B，流式输出。
 * 产出可以直接「送进配音」，即写入 useWorkflowState().createdCopyText，
 * 第三步语音合成会立刻拿到这段话 —— 这就是移植后打通的闭环。
 */
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import {
  isMoarkAuthError,
  useMoarkAccount,
} from '@/composables/useMoarkAccount'
import { useWorkflowState } from '@/composables/useWorkflowState'
import {
  CREATOR_ACTION_META,
  DEFAULT_SECONDS,
  type CreatorActionMeta,
} from '@/config/creator-actions'
import type { CreatorRunPayload, CreatorRunResult } from '@/types/creator'

const PROFILE_STORAGE_KEY = 'fsa.creator.profile'

function isCreatorRunResult(value: unknown): value is CreatorRunResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof value.text === 'string'
  )
}

function loadProfile(): string {
  try {
    return window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

let sharedCreatorState: ReturnType<typeof useCreatorAgentImpl> | null = null

function useCreatorAgentImpl() {
  const { ensureReady, handleAuthExpired } = useMoarkAccount()
  const { createdCopyText } = useWorkflowState()

  const actions = ref<CreatorActionMeta[]>(CREATOR_ACTION_META)
  const activeActionId = ref<string>('pipeline')
  const inputText = ref('')
  const seconds = ref(DEFAULT_SECONDS)
  const profile = ref(loadProfile())
  const outputText = ref('')
  const isRunning = ref(false)
  const elapsedMs = ref(0)
  const finishedMs = ref<number | null>(null)

  let startedAt = 0
  let timer: number | undefined
  let stopStreamListener: (() => void) | null = null

  const activeAction = computed<CreatorActionMeta>(
    () => actions.value.find((item) => item.id === activeActionId.value) ?? actions.value[0],
  )

  const elapsedText = computed(() => `${(elapsedMs.value / 1000).toFixed(1)} 秒`)
  /** 口语约每秒 4~5 字，和主进程算法保持一致的估算，只做界面提示 */
  const maxCharsHint = computed(() => Math.max(60, Math.round(seconds.value * 4.2)))

  function attachStream(): void {
    if (stopStreamListener) return
    stopStreamListener = window.desktopApi.onCreatorDelta((piece: string) => {
      outputText.value += piece
    })
  }

  function detachStream(): void {
    if (stopStreamListener) {
      stopStreamListener()
      stopStreamListener = null
    }
  }

  function startTimer(): void {
    startedAt = Date.now()
    elapsedMs.value = 0
    finishedMs.value = null
    if (timer) window.clearInterval(timer)
    timer = window.setInterval(() => {
      elapsedMs.value = Date.now() - startedAt
    }, 100)
  }

  function stopTimer(): void {
    if (startedAt > 0) {
      elapsedMs.value = Date.now() - startedAt
      finishedMs.value = elapsedMs.value
    }
    if (timer) {
      window.clearInterval(timer)
      timer = undefined
    }
  }

  function selectAction(id: string): void {
    activeActionId.value = id
  }

  function saveProfile(text: string): void {
    profile.value = text
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, text)
      ElMessage.success('账号画像已保存，之后每次生成都会自动带上')
    } catch {
      ElMessage.warning('账号画像保存失败（本机存储不可用）')
    }
  }

  async function run(): Promise<void> {
    if (isRunning.value) return
    if (!ensureReady()) return
    if (!inputText.value.trim()) {
      ElMessage.warning('先填点内容再生成')
      return
    }

    outputText.value = ''
    isRunning.value = true
    startTimer()
    attachStream()

    const payload: CreatorRunPayload = {
      action: activeActionId.value,
      text: inputText.value,
      seconds: seconds.value,
      profile: profile.value,
    }

    try {
      const result = await window.desktopApi.runCreator(payload)
      if (isCreatorRunResult(result) && !outputText.value.trim()) {
        outputText.value = result.text
      }
      ElMessage.success(`「${activeAction.value.name}」生成完成`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/abort|cancel/i.test(message)) {
        // 用户主动停止，不当作错误
      } else if (isMoarkAuthError(message)) {
        handleAuthExpired()
      } else {
        ElMessage.error(message)
      }
    } finally {
      detachStream()
      isRunning.value = false
      stopTimer()
    }
  }

  async function stop(): Promise<void> {
    if (!isRunning.value) return
    await window.desktopApi.cancelCreator()
    isRunning.value = false
    stopTimer()
    detachStream()
    ElMessage.info('已停止生成')
  }

  async function copyOutput(): Promise<void> {
    if (!outputText.value.trim()) {
      ElMessage.warning('还没有内容可复制')
      return
    }
    try {
      await navigator.clipboard.writeText(outputText.value)
      ElMessage.success('已复制到剪贴板')
    } catch {
      ElMessage.warning('复制失败，请手动选中复制')
    }
  }

  /** 送进第三步语音合成：写入共享的 createdCopyText */
  function sendToVoice(): void {
    if (!outputText.value.trim()) {
      ElMessage.warning('还没有内容可送')
      return
    }
    createdCopyText.value = outputText.value
    ElMessage.success('已送进第三步「语音克隆合成」，去右边合成配音')
  }

  function clearAll(): void {
    inputText.value = ''
    outputText.value = ''
    finishedMs.value = null
    elapsedMs.value = 0
  }

  return {
    actions,
    activeAction,
    activeActionId,
    inputText,
    seconds,
    profile,
    outputText,
    isRunning,
    elapsedText,
    finishedMs,
    maxCharsHint,
    selectAction,
    saveProfile,
    run,
    stop,
    copyOutput,
    sendToVoice,
    clearAll,
  }
}

export function useCreatorAgent() {
  if (!sharedCreatorState) {
    sharedCreatorState = useCreatorAgentImpl()
  }
  return sharedCreatorState
}
