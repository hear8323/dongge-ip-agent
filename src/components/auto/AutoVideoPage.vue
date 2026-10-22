<script setup lang="ts">
/**
 * 自动成片（整页）
 *
 * 版式照「东哥智能体」的自动成片工作台：
 *   左 2fr = 口播文案（输入 + 动作 + 素材画面类型）
 *   中 280px = 配音设置（语言 / 声音 / 语速 / 音量 / 字幕 / 标题简介 / 数量）
 *   右 1fr = 视频预览 + 一键发布
 *
 * 真实链路：文案 → moark 配音 → moark 字幕时间轴 → 本机 MoneyPrinterTurbo 配素材合成
 *          → ffmpeg 把字幕烧进画面 → 成片落到 D:\WORKBUDDY\成片
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MATERIAL_TERMS, useAutoVideo } from '@/composables/useAutoVideo'
import CoverDesigner from '@/components/cover/CoverDesigner.vue'

const {
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
} = useAutoVideo()

const subOpen = ref(false)
const platform = ref<'douyin' | 'channels' | 'xhs'>('douyin')

/** Pexels API Key 配置弹窗 */
const pexelsOpen = ref(false)
const pexelsInput = ref('')
const pexelsMasked = ref('')
const pexelsSaving = ref(false)

/** 封面设计弹窗（成片生成后可用） */
const coverOpen = ref(false)
const coverSavedPath = ref('')

const coverFileName = computed(() => {
  const base = result.value?.videoPath.split(/[\\/]/).pop() ?? ''
  return `封面_${base.replace(/\.mp4$/i, '')}`
})

// 免费素材库 Pexels：申请页 / 接口文档
const PEXELS_APPLY_URL = 'https://www.pexels.com/api/new/'
const PEXELS_DOC_URL = 'https://www.pexels.com/api/documentation/'

const PLATFORM_UPLOAD: Record<string, string> = {
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  channels: 'https://channels.weixin.qq.com/platform/post/create',
  xhs: 'https://creator.xiaohongshu.com/publish/publish',
}

const textLen = computed(() => (script.value || input.value).length)
const localMaterials = computed(() => probe.value?.localMaterials ?? 0)
const pexelsReady = computed(() => !!probe.value?.pexelsReady)

const statusText = computed(() => {
  if (isRunning.value) {
    return `${progress.value?.label ?? '正在生成…'} · ${percent.value}% · ${elapsedText.value}`
  }
  if (isGeneratingScript.value) return 'AI 正在写文案（一般 20~40 秒，别急）…'
  if (result.value) return `成片完成 · 用时 ${elapsedText.value}`
  return '就绪：输入主题 → 「🚀 一键生成视频」；或粘文案 → 「🎬 用此文案生成视频」'
})

const voiceLabel = computed(() => selectedVoice.value?.name ?? '还没有音色')

onMounted(() => {
  void refreshProbe()
})

type PlatformKey = 'douyin' | 'channels' | 'xhs'

async function goPublish(target?: PlatformKey): Promise<void> {
  const key: PlatformKey = target ?? platform.value
  platform.value = key
  await copyPublishText()
  await window.desktopApi.openAutoVideoUrl(PLATFORM_UPLOAD[key])
  ElMessage.info('已打开平台上传页，标题/简介/话题在剪贴板，粘贴即可')
}

function handleStyleChange(): void {
  saveStyle()
}

async function openPexelsConfig(): Promise<void> {
  pexelsOpen.value = true
  pexelsInput.value = ''
  try {
    const data = (await window.desktopApi.getPexelsInfo()) as { ready?: boolean; masked?: string }
    pexelsMasked.value = data?.masked ?? ''
  } catch {
    pexelsMasked.value = ''
  }
}

async function savePexelsKey(): Promise<void> {
  const key = pexelsInput.value.trim()
  if (!key) {
    ElMessage.warning('先粘贴一串 Key，或者点「去 Pexels 免费申请」领一个')
    return
  }
  pexelsSaving.value = true
  try {
    const data = (await window.desktopApi.setPexelsKey(key)) as { masked?: string }
    pexelsMasked.value = data?.masked ?? ''
    pexelsInput.value = ''
    await refreshProbe()
    ElMessage.success('Pexels Key 已写入，素材可以正常检索了')
    pexelsOpen.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    pexelsSaving.value = false
  }
}

function openPexelsUrl(url: string): void {
  void window.desktopApi.openAutoVideoUrl(url)
}

async function revealSavedCover(): Promise<void> {
  if (!coverSavedPath.value) return
  try {
    await window.desktopApi.revealAutoVideo(coverSavedPath.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="auto-page">
    <!-- ===== 页头 ===== -->
    <header class="auto-head">
      <div class="head-icon">
        <span class="hi-emoji">🎬</span>
        <span class="hi-label">自动成片</span>
      </div>
      <div class="head-copy">
        <h1 class="head-title">自动成片</h1>
        <p class="head-desc">
          给个主题 → 自动写文案 / 配语音 / 配字幕 / 配素材 / 出成片
        </p>
      </div>
      <div class="head-right">
        <button class="pill pill-btn" type="button" title="配置 Pexels 素材库的 API Key" @click="openPexelsConfig">
          🔑 配置 API
        </button>
        <span class="pill" :class="{ 'is-ok': ready }">
          {{ ready ? 'MPT 已就绪' : 'MPT 未就绪' }}
        </span>
        <span class="pill" :class="{ 'is-ok': hasVoice }">
          {{ hasVoice ? '音色已配置' : '音色未配置' }}
        </span>
      </div>
    </header>

    <div class="auto-card">
      <div class="auto-cols">
        <!-- ───── 左：口播文案 ───── -->
        <section class="col col-main">
          <div class="col-h">
            <span class="col-name">口播文案</span>
            <span class="col-meta">{{ textLen }} 字 · 可留空自动写</span>
            <button class="mini" type="button" @click="copyAllText">📋 复制全部</button>
            <button class="mini" type="button" @click="resetAll">🧹 清空</button>
          </div>

          <textarea
            v-model="input"
            class="main-input"
            spellcheck="false"
            placeholder="输入视频主题，或直接把写好的文案整段粘进来"
          />

          <div class="btn-row">
            <button
              class="btn primary"
              type="button"
              :disabled="isRunning || isGeneratingScript || !input.trim()"
              title="输入框里是什么文案，就用什么直接生成（可直接粘贴）"
              @click="run(false)"
            >
              {{ isGeneratingScript ? '⏳ 写文案中…' : isRunning ? '⏳ 生成中…' : '🎬 用此文案生成视频' }}
            </button>
            <button
              class="btn ghost"
              type="button"
              :disabled="isRunning || isGeneratingScript || !input.trim()"
              title="按输入框里的主题，让 AI 写一条口播稿"
              @click="generateScript"
            >
              ✍️ 生成新文案
            </button>
            <button
              class="btn ghost"
              type="button"
              :disabled="isRunning || isPreviewing"
              title="用当前配音设置读一遍文案"
              @click="previewVoice"
            >
              🔊 试听
            </button>
            <select v-model="source" class="sel">
              <option value="pexels">素材：Pexels 免费素材库</option>
              <option value="local" :disabled="localMaterials === 0">
                素材：我的本地素材库（{{ localMaterials }}）
              </option>
            </select>
            <button
              class="btn orange"
              type="button"
              :disabled="isRunning || isGeneratingScript || !input.trim()"
              title="给个主题，自动写文案+配音+配素材+合成，一步到位"
              @click="run(true)"
            >
              {{ isGeneratingScript ? '⏳ 写文案中…' : isRunning ? '⏳ 生成中…' : '🚀 一键生成视频' }}
            </button>
            <button v-if="isRunning" class="btn ghost-danger" type="button" @click="stop">
              🛑 停止
            </button>
          </div>

          <div class="terms">
            <span class="terms-label">素材画面类型（可多选，不选自动配）</span>
            <div class="terms-wrap">
              <button
                v-for="t in MATERIAL_TERMS"
                :key="t.term"
                class="term"
                :class="{ 'is-on': terms.includes(t.term) }"
                type="button"
                :disabled="isRunning || source === 'local'"
                @click="toggleTerm(t.term)"
              >
                {{ t.emoji }} {{ t.label }}
              </button>
            </div>
          </div>

          <div class="status" :class="{ 'is-busy': isRunning }">{{ statusText }}</div>

          <div v-if="isRunning" class="prog">
            <div class="prog-bar" :style="{ width: `${Math.max(3, percent)}%` }"></div>
          </div>

          <div v-if="logs.length" class="logs">
            <span v-for="(line, i) in logs" :key="i" class="log-line">{{ line }}</span>
          </div>

          <div class="bottom-line">
            <span :class="pexelsReady ? 'ok' : 'warn'">
              {{ pexelsReady ? '✅ Pexels 素材已配置' : '⚠️ Pexels 素材未配置（页头「🔑 配置 API」填 Key）' }}
            </span>
            <span class="dot">·</span>
            <span>本地素材库 {{ localMaterials }} 个视频可用</span>
            <button v-if="result" class="link" type="button" @click="revealVideo">
              ✔ {{ result.videoPath.split(/[\\/]/).pop() }}
            </button>
          </div>
        </section>

        <!-- ───── 中：配音设置 ───── -->
        <section class="col col-set">
          <div class="col-h"><span class="col-name">配音设置</span></div>

          <div class="set">
            <span class="set-label">文案语言</span>
            <select v-model="language" class="set-select">
              <option value="zh-CN">中文</option>
              <option value="en-US">English · 英文</option>
            </select>
          </div>

          <div class="set">
            <span class="set-label">选择声音</span>
            <div class="set-row">
              <select
                v-model="voiceFilePath"
                class="set-select"
                @change="selectVoice(voiceFilePath)"
              >
                <option v-if="!voices.length" value="">（还没有音色）</option>
                <option v-for="v in voices" :key="v.id" :value="v.filePath">
                  {{ v.name }}
                </option>
              </select>
              <button class="mini" type="button" title="刷新音色列表" @click="refreshProbe">
                🔄
              </button>
              <button
                class="mini"
                type="button"
                :disabled="isPreviewing || !hasVoice"
                @click="previewVoice"
              >
                ▶ 试听
              </button>
            </div>
            <p v-if="!hasVoice" class="set-hint is-warn">
              还没有音色：去「工作流 → 配音」导入一段 10~20 秒人声，回来就能选（{{ voiceLabel }}）
            </p>
            <p v-else class="set-hint">{{ voiceLabel }}</p>
          </div>

          <div class="set">
            <span class="set-label">语速</span>
            <select v-model.number="voiceRate" class="set-select">
              <option :value="0.85">0.85x 稍慢</option>
              <option :value="1">1x 正常</option>
              <option :value="1.15">1.15x 稍快</option>
              <option :value="1.3">1.3x 较快</option>
            </select>
          </div>

          <div class="set">
            <span class="set-label">配音音量 <b>{{ voiceVolume.toFixed(1) }}x</b></span>
            <input
              v-model.number="voiceVolume"
              class="slider"
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
            />
          </div>

          <div class="set">
            <div class="set-row">
              <span class="set-label">字幕样式</span>
              <button class="mini" type="button" @click="subOpen = !subOpen">
                {{ subOpen ? '收起' : '展开' }}
              </button>
            </div>
            <div v-if="subOpen" class="sub-panel">
              <label class="sub-row">
                <input v-model="subtitleEnabled" type="checkbox" @change="handleStyleChange" />
                这条带字幕
              </label>
              <div class="sub-row">
                <span>字体</span>
                <select v-model="subtitleStyle.fontName" class="set-select" @change="handleStyleChange">
                  <option value="Microsoft YaHei">微软雅黑</option>
                  <option value="SimHei">黑体</option>
                  <option value="SimSun">宋体</option>
                  <option value="KaiTi">楷体</option>
                </select>
              </div>
              <div class="sub-row">
                <span>字号</span>
                <select v-model.number="subtitleStyle.fontSize" class="set-select" @change="handleStyleChange">
                  <option :value="48">48 小</option>
                  <option :value="60">60 标准</option>
                  <option :value="72">72 大</option>
                  <option :value="84">84 特大</option>
                </select>
              </div>
              <div class="sub-row">
                <span>文字颜色</span>
                <input v-model="subtitleStyle.textColor" type="color" class="color" @change="handleStyleChange" />
                <span>描边</span>
                <input v-model="subtitleStyle.strokeColor" type="color" class="color" @change="handleStyleChange" />
              </div>
              <div class="sub-row">
                <span>描边粗细</span>
                <select v-model.number="subtitleStyle.strokeWidth" class="set-select" @change="handleStyleChange">
                  <option :value="1.5">1.5 细</option>
                  <option :value="2.5">2.5 中</option>
                  <option :value="3.5">3.5 粗</option>
                  <option :value="5">5 特粗</option>
                </select>
              </div>
            </div>
          </div>

          <div class="set">
            <span class="set-label">数量</span>
            <select v-model.number="videoCount" class="set-select">
              <option :value="1">1 条</option>
              <option :value="2">2 条</option>
              <option :value="3">3 条</option>
            </select>
          </div>

          <div class="set-tip">
            <span>画面比例 {{ aspect }} · 目标时长 {{ seconds }} 秒</span>
          </div>

          <div class="set-divider"></div>

          <div class="set">
            <input v-model="title" class="set-input" placeholder="标题（不填用文件名）" />
            <textarea
              v-model="desc"
              class="set-textarea"
              rows="2"
              placeholder="简介 / 话题（可空，自动填正文）"
            />
            <p v-if="tags.length" class="tag-line">
              <span v-for="t in tags" :key="t" class="tag">#{{ t }}</span>
            </p>
            <button
              class="btn primary block"
              type="button"
              :disabled="isPacking"
              title="根据左侧口播文案自动生成标题、简介和话题标签"
              @click="generatePack"
            >
              ✨ {{ isPacking ? '生成中…' : '一键生成标题/简介/话题' }}
            </button>
          </div>

          <div class="set">
            <button
              class="btn ghost block"
              type="button"
              :disabled="isPreviewing || isRunning"
              @click="previewVoice"
            >
              🎵 {{ isPreviewing ? '合成中…' : '生成音频试听' }}
            </button>
            <audio v-if="previewAudioUrl" class="audio" :src="previewAudioUrl" controls></audio>
          </div>

          <div class="set-foot">
            配音 / 字幕走模力方舟，画面由本机 MoneyPrinterTurbo 合成
          </div>
        </section>

        <!-- ───── 右：视频预览 + 发布 ───── -->
        <section class="col col-out">
          <div class="col-h">
            <span class="col-name">视频预览</span>
            <button class="mini" type="button" title="打开成片目录" @click="openOutDir">
              📂 视频目录
            </button>
            <button class="mini" type="button" :disabled="!result" @click="revealVideo">
              📁 定位成片
            </button>
          </div>

          <div class="preview">
            <video v-if="result" :src="result.videoUrl" controls playsinline></video>
            <p v-else class="preview-ph">
              生成的视频将在此处播放<br />
              左边给个主题，点「🚀 一键生成视频」
            </p>
          </div>

          <div v-if="result" class="out-path">
            <span class="out-path-label">成片已存入</span>
            <span class="out-path-text">{{ result.videoPath }}</span>
          </div>

          <button
            v-if="result"
            class="btn cover-btn"
            type="button"
            title="从这条成片截取画面做封面，可加标题、选模板"
            @click="coverOpen = true"
          >
            🖼 用这条成片做封面
          </button>

          <div class="publish-box">
            <div class="publish-title">一键发布</div>
            <div class="publish-warn">🛡 新号一天 1~3 条、别刷同质内容</div>
            <div class="publish-row">
              <button class="btn plat" type="button" @click="goPublish('douyin')">抖音</button>
              <button class="btn plat" type="button" @click="goPublish('channels')">视频号</button>
              <button class="btn plat" type="button" @click="goPublish('xhs')">小红书</button>
            </div>
            <p class="publish-hint">
              点平台名＝复制标题/简介/话题并打开上传页（本版不代登录，避免账号风控）
            </p>
          </div>
        </section>
      </div>
    </div>

    <!-- ===== 封面设计弹窗（成片生成后可用） ===== -->
    <div v-if="coverOpen && result" class="pexels-mask cover-mask" @click.self="coverOpen = false">
      <div class="cover-box">
        <div class="pexels-h">
          <span>🖼 封面设计 · {{ coverFileName }}</span>
          <button class="pexels-x" type="button" @click="coverOpen = false">✕</button>
        </div>

        <div class="cover-body">
          <CoverDesigner
            :video-url="result.videoUrl"
            :default-title="title || ''"
            :default-file-name="coverFileName"
            @saved="(p: string) => { coverSavedPath = p }"
          />
        </div>

        <div v-if="coverSavedPath" class="cover-saved-line">
          ✅ 已导出：<button class="link" type="button" @click="revealSavedCover">{{ coverSavedPath }}</button>
        </div>
      </div>
    </div>

    <!-- ===== Pexels API Key 配置弹窗 ===== -->
    <div v-if="pexelsOpen" class="pexels-mask" @click.self="pexelsOpen = false">
      <div class="pexels-box">
        <div class="pexels-h">
          <span>Pexels 素材库 API</span>
          <button class="pexels-x" type="button" @click="pexelsOpen = false">✕</button>
        </div>

        <p class="pexels-desc">
          Pexels 是免费可商用的图库，自动成片里的画面素材就来自这里。<b>免费额度每月 200 次请求</b>，个人用够了。
        </p>

        <ol class="pexels-steps">
          <li>点下面「去 Pexels 免费申请」，用邮箱注册并登录</li>
          <li>页面会直接给你一串 API Key，复制它</li>
          <li>粘回下面的输入框，点保存</li>
        </ol>

        <div class="pexels-links">
          <button class="btn primary sm" type="button" @click="openPexelsUrl(PEXELS_APPLY_URL)">
            去 Pexels 免费申请 →
          </button>
          <button class="btn ghost sm" type="button" @click="openPexelsUrl(PEXELS_DOC_URL)">
            接口说明
          </button>
        </div>

        <input
          v-model="pexelsInput"
          class="pexels-input"
          type="text"
          spellcheck="false"
          placeholder="把申请到的 API Key 粘在这里"
          @keyup.enter="savePexelsKey"
        />

        <p v-if="pexelsMasked" class="pexels-now">当前已保存：{{ pexelsMasked }}</p>
        <p v-else class="pexels-now is-empty">当前还没配置，用 Pexels 素材会失败</p>

        <div class="pexels-foot">
          <button class="btn ghost" type="button" @click="pexelsOpen = false">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="pexelsSaving"
            @click="savePexelsKey"
          >
            {{ pexelsSaving ? '保存中…' : '保存' }}
          </button>
        </div>

        <p class="pexels-tip">🔒 Key 只写进本机 MoneyPrinterTurbo 的配置文件，不上传任何服务器</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auto-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
}

/* ── 页头 ── */
.auto-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.head-icon {
  width: 54px;
  height: 54px;
  flex: 0 0 auto;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 1px;
  border: 1px solid #dde5f0;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f2f7ff 100%);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
}

.hi-emoji {
  font-size: 19px;
  line-height: 1;
}

.hi-label {
  color: #5a6b82;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.head-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.head-title {
  margin: 0;
  color: #16202e;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
}

.head-desc {
  margin: 0;
  overflow: hidden;
  color: #7b8798;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-right {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  gap: 8px;
}

.pill {
  padding: 3px 10px;
  border: 1px solid #e6e9f0;
  border-radius: 999px;
  color: #98a2b3;
  background: #fafbfd;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}

.pill.is-ok {
  border-color: #b5e3c9;
  color: #2f8a5b;
  background: #f2fcf6;
}

/* 页头可点的胶囊（配置 Pexels API） */
.pill.pill-btn {
  border-color: #f5cfa8;
  color: #d97706;
  background: #fff9f1;
  cursor: pointer;
}

.pill.pill-btn:hover {
  border-color: #f97316;
  color: #f97316;
  background: #fff4e8;
  box-shadow: 0 2px 8px rgba(249, 115, 22, 0.18);
}

/* ── 三栏卡片 ── */
.auto-card {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  border: 1px solid #dfe5ee;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(22, 34, 52, 0.06);
  overflow: hidden;
}

.auto-cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) 280px minmax(0, 1fr);
}

.col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e8edf4;
}

.col:last-child {
  border-right: none;
}

.col-h {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid #e8edf4;
  background: #fbfcfe;
}

.col-name {
  color: #2b3a4d;
  font-size: 12.5px;
  font-weight: 800;
  white-space: nowrap;
}

.col-meta {
  color: #9aa5b5;
  font-size: 11.5px;
  white-space: nowrap;
}

.col-h .mini:first-of-type {
  margin-left: auto;
}

.mini {
  height: 24px;
  padding: 0 8px;
  border: 1px solid #dfe5ee;
  border-radius: 6px;
  color: #5d6b7e;
  background: #ffffff;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.mini:hover:not(:disabled) {
  border-color: #2f6fed;
  color: #2f6fed;
  background: #f5f8ff;
}

.mini:disabled {
  opacity: 0.45;
}

/* ── 左列 ── */
.main-input {
  flex: 1 1 auto;
  min-height: 120px;
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid #dfe5ee;
  border-radius: 8px;
  color: #1e2938;
  background: #fdfefe;
  font-size: 13px;
  line-height: 1.75;
  resize: none;
  outline: none;
}

.main-input:focus {
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.1);
}

.main-input::placeholder {
  color: #a9b3c2;
}

.btn-row {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 8px 12px 0;
}

.btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}

.btn.primary {
  color: #ffffff;
  background: #2f6fed;
  border-color: #2f6fed;
  box-shadow: 0 2px 8px rgba(47, 111, 237, 0.22);
}

.btn.primary:hover:not(:disabled) {
  background: #245bd0;
}

.btn.ghost {
  color: #4c5a6d;
  background: #ffffff;
  border-color: #dbe2ec;
}

.btn.ghost:hover:not(:disabled) {
  border-color: #9db6e8;
  color: #2f6fed;
  background: #f6f9ff;
}

.btn.orange {
  color: #ffffff;
  background: #f97316;
  border-color: #f97316;
  box-shadow: 0 2px 8px rgba(249, 115, 22, 0.24);
}

.btn.orange:hover:not(:disabled) {
  background: #e2620a;
}

.btn.ghost-danger {
  color: #d0453f;
  background: #ffffff;
  border-color: #f0bcb9;
}

.btn.block {
  width: 100%;
}

.sel {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #dbe2ec;
  border-radius: 7px;
  color: #4c5a6d;
  background: #ffffff;
  font-size: 12px;
  outline: none;
}

.terms {
  flex: 0 0 auto;
  margin: 8px 12px 0;
}

.terms-label {
  display: block;
  margin-bottom: 4px;
  color: #9aa5b5;
  font-size: 11.5px;
}

.terms-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.term {
  padding: 3px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #5d6b7e;
  background: #ffffff;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.term:hover:not(:disabled) {
  border-color: #a9c2f0;
  color: #2f6fed;
}

.term.is-on {
  border-color: #2f6fed;
  color: #ffffff;
  background: #2f6fed;
}

.term:disabled {
  opacity: 0.5;
}

.status {
  flex: 0 0 auto;
  margin: 8px 12px 0;
  color: #8b96a7;
  font-size: 11.5px;
  line-height: 1.5;
}

.status.is-busy {
  color: #2f6fed;
}

.prog {
  flex: 0 0 auto;
  height: 4px;
  margin: 6px 12px 0;
  border-radius: 999px;
  background: #eef2f8;
  overflow: hidden;
}

.prog-bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2f6fed, #63a4ff);
  transition: width 0.35s ease;
}

.logs {
  flex: 0 0 auto;
  max-height: 44px;
  margin: 6px 12px 0;
  overflow: hidden;
  display: grid;
  gap: 1px;
}

.log-line {
  color: #aab4c2;
  font-size: 10.5px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bottom-line {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 6px 12px 8px;
  padding-top: 6px;
  border-top: 1px solid #eef2f8;
  color: #9aa5b5;
  font-size: 11px;
}

.bottom-line .ok {
  color: #2f8a5b;
}

.bottom-line .warn {
  color: #b45309;
}

.link {
  margin-left: auto;
  padding: 0;
  border: none;
  color: #2f6fed;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 中列 ── */
.col-set {
  padding-bottom: 8px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.set {
  flex: 0 0 auto;
  margin: 8px 12px 0;
}

.set-label {
  display: block;
  margin-bottom: 4px;
  color: #8b96a7;
  font-size: 11.5px;
}

.set-label b {
  color: #2f6fed;
}

.set-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.set-row .set-label {
  margin-bottom: 0;
}

.set-row .mini:first-of-type {
  margin-left: auto;
}

.set-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #dfe5ee;
  border-radius: 7px;
  color: #22303f;
  background: #ffffff;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.set-select:focus {
  border-color: #2f6fed;
}

.set-hint {
  margin: 4px 0 0;
  color: #9aa5b5;
  font-size: 10.5px;
  line-height: 1.5;
}

.set-hint.is-warn {
  color: #b45309;
}

.slider {
  width: 100%;
  margin-top: 2px;
  accent-color: #2f6fed;
}

.sub-panel {
  display: grid;
  gap: 5px;
  margin-top: 5px;
  padding: 7px 8px;
  border: 1px solid #e8edf4;
  border-radius: 8px;
  background: #fbfcfe;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #7b8798;
  font-size: 11px;
}

.sub-row .set-select {
  flex: 1;
  height: 24px;
  font-size: 11.5px;
}

.sub-row input[type='checkbox'] {
  accent-color: #2f6fed;
}

.color {
  width: 32px;
  height: 22px;
  padding: 0;
  border: 1px solid #dfe5ee;
  border-radius: 5px;
  background: #ffffff;
}

.set-tip {
  margin: 8px 12px 0;
  color: #9aa5b5;
  font-size: 10.5px;
}

.set-divider {
  height: 1px;
  margin: 8px 12px;
  background: #eef2f8;
}

.set-input,
.set-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #dfe5ee;
  border-radius: 7px;
  color: #22303f;
  background: #ffffff;
  font-size: 12px;
  outline: none;
}

.set-input {
  height: 28px;
  margin-bottom: 5px;
}

.set-textarea {
  line-height: 1.6;
  resize: vertical;
  margin-bottom: 5px;
}

.set-input:focus,
.set-textarea:focus {
  border-color: #2f6fed;
}

.tag-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 5px;
}

.tag {
  padding: 1px 6px;
  border-radius: 4px;
  color: #2f6fed;
  background: #eef4ff;
  font-size: 10.5px;
}

.audio {
  width: 100%;
  height: 30px;
  margin-top: 6px;
}

.set-foot {
  margin: 10px 12px 0;
  color: #a8b2c1;
  font-size: 10px;
  line-height: 1.5;
}

/* ── 右列 ── */
.preview {
  flex: 1 1 0;
  min-height: 160px;
  display: grid;
  place-items: center;
  margin: 8px;
  border-radius: 10px;
  background: #f7f8fa;
  overflow: hidden;
}

.preview video {
  width: 100%;
  height: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000;
}

.preview-ph {
  margin: 0;
  color: #b6bac4;
  font-size: 12px;
  line-height: 1.8;
  text-align: center;
}

.out-path {
  flex: 0 0 auto;
  margin: 0 8px 8px;
  display: grid;
  gap: 2px;
}

.out-path-label {
  color: #9aa5b5;
  font-size: 10.5px;
}

.out-path-text {
  color: #5d6b7e;
  font-size: 10.5px;
  line-height: 1.5;
  word-break: break-all;
}

.publish-box {
  flex: 0 0 auto;
  display: grid;
  gap: 6px;
  margin: 0 8px 10px;
  padding: 9px;
  border: 1px solid #e6ebf3;
  border-radius: 9px;
  background: #fafbfe;
}

.publish-title {
  color: #2b3a4d;
  font-size: 12px;
  font-weight: 800;
}

.publish-warn {
  padding: 4px 6px;
  border: 1px solid #f5d9a8;
  border-radius: 6px;
  color: #b45309;
  background: #fff7e6;
  font-size: 10.5px;
  line-height: 1.4;
}

.publish-row {
  display: flex;
  gap: 6px;
}

.publish-row .btn {
  flex: 1 1 0;
}

/* 三个平台按钮：抖音 / 视频号 / 小红书 */
.btn.plat {
  padding: 6px 4px;
  border: 1px solid #d8e2f2;
  background: #f7faff;
  color: #2f6fed;
  font-size: 12px;
  font-weight: 700;
}

.btn.plat:hover {
  border-color: #2f6fed;
  background: #eaf1ff;
}

.publish-hint {
  margin: 0;
  color: #9aa5b5;
  font-size: 10px;
  line-height: 1.5;
}

/* ── 封面设计弹窗 ── */
.cover-btn {
  height: 38px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #f5cfa8;
  color: #d97706;
  font-weight: 800;
}

.cover-btn:hover {
  border-color: #f97316;
  color: #f97316;
  background: #fff7ed;
}

.cover-mask {
  z-index: 130;
}

.cover-box {
  width: min(860px, 94vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 16px 18px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(16, 26, 40, 0.28);
}

.cover-body {
  min-width: 0;
}

.cover-saved-line {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f2fcf6;
  color: #2f7d55;
  font-size: 12px;
}

.cover-saved-line .link {
  margin-left: 0;
  max-width: none;
  word-break: break-all;
  white-space: normal;
  text-align: left;
}

/* ── Pexels Key 配置弹窗 ── */
.pexels-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  background: rgba(16, 26, 40, 0.45);
}

.pexels-box {
  width: min(460px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(16, 26, 40, 0.28);
}

.pexels-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 800;
  color: #121924;
}

.pexels-x {
  border: none;
  background: transparent;
  color: #8a94a4;
  font-size: 15px;
  cursor: pointer;
}

.pexels-x:hover {
  color: #d0453f;
}

.pexels-desc {
  margin: 0 0 10px;
  color: #5d6b7e;
  font-size: 12.5px;
  line-height: 1.65;
}

.pexels-desc b {
  color: #f97316;
}

.pexels-steps {
  margin: 0 0 12px;
  padding-left: 20px;
  color: #5d6b7e;
  font-size: 12px;
  line-height: 1.85;
}

.pexels-links {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn.sm {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.pexels-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #dbe2ec;
  border-radius: 8px;
  color: #121924;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.pexels-input:focus {
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.14);
}

.pexels-now {
  margin: 8px 0 0;
  color: #2f7d55;
  font-size: 11.5px;
}

.pexels-now.is-empty {
  color: #b0762a;
}

.pexels-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.pexels-tip {
  margin: 10px 0 0;
  color: #9aa5b5;
  font-size: 10.5px;
  text-align: center;
}

@media (max-width: 1140px) {
  .auto-cols {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }

  .col {
    border-right: none;
    border-bottom: 1px solid #e8edf4;
  }

  .col-main {
    min-height: 340px;
  }
}
</style>
