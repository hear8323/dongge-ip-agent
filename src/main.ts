import { createApp } from 'vue'
import App from './App.vue'
import 'element-plus/dist/index.css'
import './style.css'

// Browser polyfill for desktopApi (when not running in Electron)
if (typeof window !== 'undefined' && !window.desktopApi) {
  // ---- 模力方舟账户（浏览器调试）----
  // 优先使用本机 Electron 端导出的真实凭证（/__dev_moark.json，仅本地调试用，勿提交/勿随包发布）；
  // 没有则退化为纯 mock 登录态。
  const MOCK_KEY = '__browser_mock_moark_logged_in'
  const APIKEY_KEY = '__browser_mock_moark_apikey'
  const MOARK_CHAT_URL = 'https://api.moark.com/v1/chat/completions'

  interface DevMoarkConfig {
    apiKey?: string
    account?: { name?: string; username?: string }
  }
  let realCfg: DevMoarkConfig | null = null
  if (localStorage.getItem(APIKEY_KEY)) {
    realCfg = { apiKey: localStorage.getItem(APIKEY_KEY) as string }
  }
  // 启动时尝试读取本地调试凭证（构建产物目录下，重新 build 后需重新放置）
  void fetch('__dev_moark.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg: DevMoarkConfig | null) => {
      if (cfg && typeof cfg.apiKey === 'string' && cfg.apiKey.length > 10) {
        realCfg = cfg
        localStorage.setItem(APIKEY_KEY, cfg.apiKey)
        localStorage.setItem(MOCK_KEY, '1')
        console.info('[Browser Debug] 已加载本机模力方舟凭证，LLM 功能可用')
      }
    })
    .catch(() => undefined)

  const mockStatus = () => {
    const loggedIn =
      Boolean(realCfg?.apiKey) || localStorage.getItem(MOCK_KEY) === '1'
    return {
      loggedIn,
      hasApiKey: loggedIn,
      account: loggedIn
        ? realCfg?.account
          ? {
              name: realCfg.account.name ?? '模力方舟账号',
              username: realCfg.account.username ?? 'moark-user',
            }
          : { name: '浏览器调试账号', username: 'debug-user' }
        : null,
    }
  }

  /** 浏览器直连模力方舟聊天接口（与 Electron 端 chatText 同参数） */
  async function browserChatText(
    apiKey: string,
    system: string,
    user: string,
  ): Promise<string> {
    if (!apiKey?.trim()) throw new Error('请先在配置中心登录模力方舟')
    const response = await fetch(MOARK_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Qwen3-32B',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      throw new Error(`文案生成失败（${response.status}）：${raw.slice(0, 200)}`)
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error(data.error?.message ?? '文案生成返回为空')
    return text
  }

  /** 主题 → 口播文案（与 Electron 端 generateOralScript 同提示词） */
  async function browserGenerateScript(payload: {
    subject: string
    seconds: number
    profile?: string
  }): Promise<string> {
    const apiKey = realCfg?.apiKey ?? ''
    const limit = Math.max(60, Math.round(payload.seconds * 4.2))
    const system = [
      '你是「东哥在努力」的口播文案写手。人设：43 岁中年男，失业在家带娃，零代码自学 AI，讲人话、不端着。',
      '写法：一行一句，每句 12~24 字，能直接念出来；开头 3 秒必须有钩子（冲突/反差/被说中）；不写旁白提示、不写镜头词、不用 emoji、不写 Markdown。',
      `字数控制在 ${limit} 字左右（约 ${payload.seconds} 秒口播）。只输出正文。`,
    ].join('\n')
    const user = payload.profile?.trim()
      ? `【账号画像】\n${payload.profile.trim()}\n\n【本条主题】\n${payload.subject.trim()}`
      : `【本条主题】\n${payload.subject.trim()}`
    const text = await browserChatText(apiKey, system, user)
    return text
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*#>\s]+/, '').trim())
      .filter(Boolean)
      .join('\n')
  }

  /** 文案 → 标题 / 简介 / 话题（与 Electron 端 generatePublishPack 同提示词） */
  async function browserGeneratePack(
    script: string,
  ): Promise<{ title: string; desc: string; tags: string[] }> {
    const apiKey = realCfg?.apiKey ?? ''
    const system = [
      '你是短视频发布文案助手。根据口播文案给出：1 个标题（12~20 字，有钩子不浮夸）、1 段简介（30~60 字，第一人称）、5 个话题标签（不带 # 号）。',
      '严格按 JSON 输出：{"title":"...","desc":"...","tags":["...","..."]}。不要任何解释。',
    ].join('\n')
    const raw = await browserChatText(apiKey, system, script)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('标题/简介生成结果解析失败，再点一次试试')
    const parsed = JSON.parse(match[0]) as {
      title?: string
      desc?: string
      tags?: string[]
    }
    return {
      title: (parsed.title ?? '').trim(),
      desc: (parsed.desc ?? '').trim(),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
    }
  }

  window.desktopApi = {
    getAppVersion: () => Promise.resolve('1.0.1'),
    requestMicrophoneAccess: () => Promise.resolve('denied'),
    moarkGetStatus: () => Promise.resolve(mockStatus()),
    moarkGetQuota: () =>
      Promise.resolve(
        mockStatus().loggedIn
          ? { remaining: 100, total: 100 }
          : { remaining: 0, total: 0 },
      ),
    moarkAuthorize: () => {
      localStorage.setItem(MOCK_KEY, '1')
      return Promise.resolve(mockStatus())
    },
    moarkLogout: () => {
      localStorage.removeItem(MOCK_KEY)
      localStorage.removeItem(APIKEY_KEY)
      realCfg = null
      return Promise.resolve(true)
    },
    extractDouyinCopy: () => Promise.resolve(null),
    cancelDouyinExtraction: () => Promise.resolve(false),
    cacheSynthesizedAudio: () => Promise.resolve(null),
    copyLocalAudio: () => Promise.resolve(''),
    readAudioFile: () => Promise.resolve(null),
    createRewriteCopy: () => Promise.resolve(null),
    cancelCopyCreation: () => Promise.resolve(false),
    runCreator: () => Promise.resolve(null),
    cancelCreator: () => Promise.resolve(false),
    onCreatorDelta: () => () => {},
    probeAutoVideo: () => Promise.resolve({ ok: false, reason: 'Browser mode' }),
    getPexelsInfo: () => Promise.resolve({ ready: false, masked: '' }),
    setPexelsKey: () => Promise.resolve({ ready: false, masked: '' }),
    saveAutoVideoCover: () => Promise.resolve(''),
    generateAutoVideoScript: (payload: unknown) =>
      browserGenerateScript(payload as {
        subject: string
        seconds: number
        profile?: string
      }),
    generateAutoVideoPack: (script: string) => browserGeneratePack(script),
    previewAutoVideoAudio: () => Promise.resolve(''),
    runAutoVideo: () => Promise.resolve({ task_id: '', result: null }),
    cancelAutoVideo: () => Promise.resolve(false),
    openAutoVideoDir: () => Promise.resolve(false),
    revealAutoVideo: () => Promise.resolve(false),
    openAutoVideoUrl: () => Promise.resolve(false),
    onAutoVideoProgress: () => () => {},
    listMoarkVoices: () => Promise.resolve([]),
    createMoarkVoice: () => Promise.resolve(null),
    updateMoarkVoice: () => Promise.resolve(null),
    deleteMoarkVoice: () => Promise.resolve(false),
    saveMoarkRecording: () => Promise.resolve(''),
    synthesizeMoarkVoice: () => Promise.resolve(''),
    cancelMoarkVoiceSynthesis: () => Promise.resolve(false),
    loadLipSyncDedicatedConfig: () => Promise.resolve(null),
    saveLipSyncDedicatedConfig: () => Promise.resolve(),
    submitLipSyncDedicatedTask: () => Promise.resolve(null),
    cancelLipSyncDedicatedTask: () => Promise.resolve(false),
    onLipSyncDedicatedStatus: () => () => {},
    recognizeSubtitles: () => Promise.resolve(null),
    cancelSubtitleRecognition: () => Promise.resolve(false),
    listPipHistory: () => Promise.resolve([]),
    savePipHistory: () => Promise.resolve(null),
    deletePipHistory: () => Promise.resolve(false),
    saveImageFile: () => Promise.resolve(''),
    exportAll: () => Promise.resolve(null),
    selectAudioFile: () => Promise.resolve(null),
    selectVideoFile: () => Promise.resolve(null),
    selectVideoRenderOutput: () => Promise.resolve(null),
    renderVideo: () => Promise.resolve(null),
    captureVideoFilmstrip: () => Promise.resolve([]),
    captureVideoFrame: () => Promise.resolve(''),
    onVideoRenderProgress: () => () => {},
    showVideoInFolder: () => Promise.resolve(),
  } as any
}

createApp(App).mount('#app')
