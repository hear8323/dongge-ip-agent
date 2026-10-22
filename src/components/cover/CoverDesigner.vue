<script setup lang="ts">
/**
 * 封面设计（独立可复用组件）
 *
 * 从工作流「第六步：封面设计」抽出，供两处使用：
 *   1. 工作流导出列（那里继续走统一的 exportAll）
 *   2. 自动成片页（成片生成后直接做封面、导出到成片目录）
 *
 * 输入：视频地址（local-video:// 或 http），可选默认标题。
 * 输出：emits('saved', filePath) —— 导出的封面落盘路径。
 */
import { ElMessage } from 'element-plus'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { SUBTITLE_FONT_OPTIONS } from '@/config/subtitle-fonts'

const props = defineProps<{
  /** 视频地址：与工作流一致，走 captureVideoFilmstrip / captureVideoFrame 的协议 */
  videoUrl: string
  /** 默认带入的封面标题（如自动成片的标题） */
  defaultTitle?: string
  /** 导出文件名（不含扩展名），缺省用时间戳 */
  defaultFileName?: string
}>()

const emit = defineEmits<{
  saved: [filePath: string]
}>()

const hasVideo = computed(() => Boolean(props.videoUrl.trim()))

// 字体 @font-face 只注入一次
onMounted(() => {
  if (!document.querySelector('style[data-cover-fonts="true"]')) {
    const styleEl = document.createElement('style')
    styleEl.dataset.coverFonts = 'true'
    styleEl.textContent = SUBTITLE_FONT_OPTIONS.map(
      (f) =>
        `@font-face { font-family: '${f.fontFamily}'; src: url('${f.url}'); font-display: swap; }`,
    ).join('\n')
    document.head.appendChild(styleEl)
  }
  if (hasVideo.value) {
    void buildFilmstrip()
    scheduleCapture()
  }
})

onUnmounted(() => {
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
  releaseFilmstrip()
})

// ── 模板 / 文案 ──
type CoverStyleId = 'bottom-gradient' | 'center-emphasis' | 'top-banner'

const coverFontFamily = computed(() => {
  const opt = SUBTITLE_FONT_OPTIONS.find((f) => f.id === coverFontId.value)
  return opt ? `'${opt.fontFamily}', sans-serif` : 'sans-serif'
})

const coverStyles = [
  { id: 'bottom-gradient' as CoverStyleId, label: '黄底标题', description: '黄色色带，白字黑描边' },
  { id: 'center-emphasis' as CoverStyleId, label: '居中强调', description: '深色遮罩，大字居中' },
  { id: 'top-banner' as CoverStyleId, label: '蓝调渐变', description: '蓝色渐变条，橙色竖线' },
]

const selectedStyleId = ref<CoverStyleId>('bottom-gradient')
const coverTitle = ref(props.defaultTitle ?? '')
const coverFontId = ref('msyhbd')
const coverFontSize = ref(10)
const coverFrameDataUrl = ref('')
const frameTimePercent = ref(10)
const isCapturing = ref(false)
const coverPreviewRef = ref<HTMLElement | null>(null)
const coverVideoDuration = ref(0)

// ── 时间轴 ──
const FILMSTRIP_COUNT = 24
const filmstripThumbs = ref<string[]>([])
const isBuildingFilmstrip = ref(false)
const timelineRef = ref<HTMLElement | null>(null)
let isDraggingPlayhead = false

async function buildFilmstrip(): Promise<void> {
  releaseFilmstrip()
  if (!hasVideo.value) return

  isBuildingFilmstrip.value = true
  try {
    const result = (await window.desktopApi.captureVideoFilmstrip(
      props.videoUrl,
      FILMSTRIP_COUNT,
    )) as { frames: ArrayBuffer[]; mimeType: string; duration: number }

    if (!result?.frames?.length) return

    filmstripThumbs.value = result.frames.map((frame) => {
      const blob = new Blob([frame], { type: result.mimeType })
      return URL.createObjectURL(blob)
    })

    if (Number.isFinite(result.duration)) {
      coverVideoDuration.value = result.duration
    }
  } catch {
    // 生成失败时时间轴退化为纯色条，不影响选帧
  } finally {
    isBuildingFilmstrip.value = false
  }
}

function percentFromClientX(clientX: number): number {
  const el = timelineRef.value
  if (!el) return frameTimePercent.value
  const rect = el.getBoundingClientRect()
  if (!rect.width) return frameTimePercent.value
  const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
  return (offsetX / rect.width) * 100
}

const nearestThumbUrl = computed(() => {
  const thumbs = filmstripThumbs.value
  if (!thumbs.length) return ''
  const index = Math.round((frameTimePercent.value / 100) * (thumbs.length - 1))
  return thumbs[Math.min(Math.max(index, 0), thumbs.length - 1)]
})

const coverDisplayFrameUrl = computed(
  () => coverFrameDataUrl.value || nearestThumbUrl.value,
)

function applyPercent(percent: number): void {
  frameTimePercent.value = Math.round(percent * 10) / 10
}

function onTimelinePointerDown(event: PointerEvent): void {
  if (!hasVideo.value) return
  isDraggingPlayhead = true
  timelineRef.value?.setPointerCapture(event.pointerId)
  coverFrameDataUrl.value = ''
  applyPercent(percentFromClientX(event.clientX))
}

function onTimelinePointerMove(event: PointerEvent): void {
  if (!isDraggingPlayhead) return
  applyPercent(percentFromClientX(event.clientX))
}

function onTimelinePointerUp(event: PointerEvent): void {
  if (!isDraggingPlayhead) return
  isDraggingPlayhead = false
  timelineRef.value?.releasePointerCapture(event.pointerId)
  scheduleCapture()
}

function onTimelineKeydown(event: KeyboardEvent): void {
  if (!hasVideo.value) return

  const step = event.shiftKey ? 5 : 1
  let next = frameTimePercent.value

  if (event.key === 'ArrowLeft') next = Math.max(0, next - step)
  else if (event.key === 'ArrowRight') next = Math.min(100, next + step)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = 100
  else return

  event.preventDefault()
  coverFrameDataUrl.value = ''
  applyPercent(next)
  scheduleCapture()
}

const totalDurationLabel = computed(() => {
  const duration = coverVideoDuration.value
  if (!duration || !Number.isFinite(duration)) return '--:--'
  const mm = String(Math.floor(duration / 60)).padStart(2, '0')
  const ss = String(Math.floor(duration % 60)).padStart(2, '0')
  return `${mm}:${ss}`
})

const frameTimeLabel = computed(() => {
  const duration = coverVideoDuration.value
  if (!duration || !Number.isFinite(duration)) {
    return `${frameTimePercent.value}%`
  }
  const seconds = (duration * frameTimePercent.value) / 100
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${mm}:${ss}`
})

watch(
  () => props.videoUrl,
  () => {
    coverFrameDataUrl.value = ''
    coverVideoDuration.value = 0
    releaseFilmstrip()
    void buildFilmstrip()
    scheduleCapture()
  },
)

watch(
  () => props.defaultTitle,
  (value) => {
    // 默认标题只在组件还没写过标题时带入
    if (value && !coverTitle.value.trim()) coverTitle.value = value
  },
)

function releaseFilmstrip(): void {
  filmstripThumbs.value.forEach((url) => URL.revokeObjectURL(url))
  filmstripThumbs.value = []
}

let captureTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCapture(): void {
  if (captureTimer) clearTimeout(captureTimer)
  captureTimer = setTimeout(() => { void captureFrame() }, 400)
}

async function captureFrame(): Promise<void> {
  if (!hasVideo.value) return

  isCapturing.value = true
  try {
    const result = (await window.desktopApi.captureVideoFrame(
      props.videoUrl,
      frameTimePercent.value,
    )) as { arrayBuffer: ArrayBuffer; mimeType: string }

    const blob = new Blob([result.arrayBuffer], { type: result.mimeType })
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    coverFrameDataUrl.value = dataUrl
  } catch {
    // 截取失败静默
  } finally {
    isCapturing.value = false
  }
}

async function ensureCoverFrame(): Promise<boolean> {
  if (coverFrameDataUrl.value) return true
  if (!hasVideo.value) return false
  await captureFrame()
  return Boolean(coverFrameDataUrl.value)
}

// ── Canvas 合成 ──
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = []
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) { result.push(''); continue }
    let current = ''
    for (const char of rawLine) {
      const test = current + char
      if (ctx.measureText(test).width > maxWidth && current.length > 0) {
        result.push(current)
        current = char
      } else {
        current = test
      }
    }
    if (current) result.push(current)
  }
  return result.filter((l) => l.length > 0)
}

async function buildCoverDataUrl(): Promise<string | null> {
  if (!coverFrameDataUrl.value) return null

  const W = 1080, H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = new Image()
  img.src = coverFrameDataUrl.value
  await new Promise<void>((resolve) => { img.onload = () => resolve() })
  ctx.drawImage(img, 0, 0, W, H)

  const title = coverTitle.value || '封面标题'
  const style = selectedStyleId.value

  await document.fonts.ready

  const previewW = coverPreviewRef.value?.getBoundingClientRect().width || 160
  const previewH = previewW * (16 / 9)
  const scaleW = W / previewW
  const exportFontSize = Math.round(coverFontSize.value * scaleW)
  const fontFamily = coverFontFamily.value

  function drawBand(gradColors: [string, string], accentColor: string): void {
    const padding = exportFontSize * 0.4
    const accentW = 4 * scaleW
    const gapW = exportFontSize * 0.5
    const fontSize = exportFontSize
    ctx.font = `bold ${fontSize}px ${fontFamily}`
    ctx.letterSpacing = `${exportFontSize * 0.08}px`

    const textMaxWidth = W * 0.88 - accentW - gapW
    const lines = wrapTextLines(ctx, title, textMaxWidth)

    const lineH = fontSize * 1.5
    const textBlockH = lines.length * lineH
    const bandH = textBlockH + padding * 2
    const bandY = (H - bandH) / 2

    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, gradColors[0])
    grad.addColorStop(1, gradColors[1])
    ctx.fillStyle = grad
    ctx.fillRect(0, bandY, W, bandH)

    ctx.fillStyle = accentColor
    ctx.fillRect(0, bandY + padding, accentW, textBlockH)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    lines.forEach((line, i) => {
      const x = accentW + gapW
      const y = bandY + padding + lineH * i + lineH / 2
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 1 * scaleW
      ctx.shadowBlur = 4 * scaleW
      ctx.fillText(line, x, y)
      ctx.restore()
    })
  }

  if (style === 'bottom-gradient') {
    drawBand(['rgba(180,130,10,0.92)', 'rgba(248,179,0,0.88)'], '#c0392b')
  } else if (style === 'center-emphasis') {
    drawBand(['rgba(26,26,46,0.94)', 'rgba(45,45,78,0.90)'], '#00b894')
  } else {
    drawBand(['rgba(26,58,92,0.92)', 'rgba(42,111,151,0.85)'], '#ff6b2b')
  }

  return canvas.toDataURL('image/jpeg', 0.95)
}

// ── 导出 ──
const isSaving = ref(false)

async function exportCover(): Promise<void> {
  if (isSaving.value) return
  if (!coverTitle.value.trim()) {
    ElMessage.warning('先写一句封面标题')
    return
  }
  if (!(await ensureCoverFrame())) {
    ElMessage.warning('还没截到画面，先在时间轴上选一个位置')
    return
  }

  isSaving.value = true
  try {
    const dataUrl = await buildCoverDataUrl()
    if (!dataUrl) throw new Error('封面合成失败，再试一次')
    const fileName = `${props.defaultFileName || '封面'}_${Date.now()}.jpg`
    const filePath = (await window.desktopApi.saveAutoVideoCover(
      dataUrl,
      fileName,
    )) as string
    ElMessage.success(`封面已导出：${filePath}`)
    emit('saved', filePath)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="cover-designer">
    <!-- 模板三选 -->
    <div class="cover-style-previews">
      <div
        v-for="(style, idx) in coverStyles"
        :key="style.id"
        class="cover-style-preview-card"
        :class="{ 'is-active': selectedStyleId === style.id }"
        role="button"
        tabindex="0"
        @click="selectedStyleId = style.id"
        @keydown.enter="selectedStyleId = style.id"
      >
        <div
          :ref="idx === 0 ? (el) => { coverPreviewRef = el as HTMLElement | null } : undefined"
          class="cover-style-preview-inner"
          :style="coverDisplayFrameUrl ? { backgroundImage: `url(${coverDisplayFrameUrl})` } : {}"
        >
          <div v-if="!coverDisplayFrameUrl" class="cover-preview-empty"></div>
          <div v-if="selectedStyleId === style.id" class="cover-style-selected-badge">✓</div>
          <div v-if="style.id === 'bottom-gradient'" class="cover-style1-band">
            <span class="cover-style1-accent"></span>
            <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
          </div>
          <div v-else-if="style.id === 'center-emphasis'" class="cover-style2-band">
            <span class="cover-style2-accent"></span>
            <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
          </div>
          <div v-else class="cover-style3-band">
            <span class="cover-style3-accent"></span>
            <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
          </div>
        </div>
        <div class="cover-style-preview-label">{{ style.label }}</div>
      </div>
    </div>

    <!-- 帧截取 -->
    <section class="cover-frame-section">
      <div class="cover-frame-controls">
        <span class="cover-field-label cover-timeline-label">
          截取位置
          <span v-if="isBuildingFilmstrip" class="cover-capturing-hint">生成缩略图...</span>
          <span v-else-if="isCapturing" class="cover-capturing-hint">截取中...</span>
          <span class="cover-timeline-time">{{ frameTimeLabel }} / {{ totalDurationLabel }}</span>
        </span>

        <div
          ref="timelineRef"
          class="cover-timeline"
          :class="{ 'is-disabled': !hasVideo }"
          role="slider"
          tabindex="0"
          aria-label="封面截取位置"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="frameTimePercent"
          :aria-valuetext="`${frameTimeLabel} / ${totalDurationLabel}`"
          @pointerdown="onTimelinePointerDown"
          @pointermove="onTimelinePointerMove"
          @pointerup="onTimelinePointerUp"
          @pointercancel="onTimelinePointerUp"
          @keydown="onTimelineKeydown"
        >
          <div class="cover-timeline-track">
            <img
              v-for="(thumb, i) in filmstripThumbs"
              :key="i"
              class="cover-timeline-thumb"
              :src="thumb"
              alt=""
              draggable="false"
            />
          </div>
          <div
            v-if="hasVideo"
            class="cover-timeline-playhead"
            :style="{ left: `${frameTimePercent}%` }"
          >
            <span class="cover-timeline-playhead-grip"></span>
          </div>
        </div>
      </div>
    </section>

    <!-- 字体 -->
    <div class="cover-font-row">
      <label class="cover-font-field">
        <span class="cover-field-label">字体</span>
        <select v-model="coverFontId" class="cover-input">
          <option v-for="font in SUBTITLE_FONT_OPTIONS" :key="font.id" :value="font.id">
            {{ font.label }}
          </option>
        </select>
      </label>
      <label class="cover-font-field">
        <span class="cover-field-label">字号 <span class="cover-font-size-val">{{ coverFontSize }}px</span></span>
        <input v-model.number="coverFontSize" type="range" min="6" max="64" step="0.5" class="cover-range-input" />
      </label>
    </div>

    <!-- 标题 -->
    <label class="cover-field">
      <span class="cover-field-label">封面标题</span>
      <textarea v-model="coverTitle" class="cover-input cover-title-textarea" rows="2" placeholder="输入封面标题（支持换行）"></textarea>
    </label>

    <button
      class="cover-export-button"
      type="button"
      :disabled="isSaving || !hasVideo"
      @click="exportCover"
    >
      {{ isSaving ? '导出中…' : '🖼 导出封面图' }}
    </button>
  </div>
</template>

<style scoped>
.cover-designer {
  display: grid;
  gap: 12px;
}

.cover-style-previews {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.cover-style-preview-card {
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 3px;
  transition: border-color 0.15s ease;
}

.cover-style-preview-card:hover {
  border-color: rgba(42, 111, 151, 0.35);
}

.cover-style-preview-card.is-active {
  border-color: #2f6fed;
}

.cover-style-preview-inner {
  position: relative;
  aspect-ratio: 9 / 16;
  border-radius: 8px;
  overflow: hidden;
  background-color: #1a2233;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
}

.cover-preview-empty {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #232c40 0%, #151c2c 100%);
}

.cover-style-selected-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #2f6fed;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}

.cover-style-preview-label {
  margin-top: 5px;
  text-align: center;
  color: #5d6b7e;
  font-size: 11.5px;
  font-weight: 700;
}

.cover-style1-band,
.cover-style2-band,
.cover-style3-band {
  position: relative;
  display: flex;
  align-items: center;
  width: 88%;
  margin: 0 auto;
  padding: 8px 10px;
  gap: 6px;
}

.cover-style1-band { background: linear-gradient(90deg, rgba(180,130,10,0.92), rgba(248,179,0,0.88)); }
.cover-style2-band { background: linear-gradient(90deg, rgba(26,26,46,0.94), rgba(45,45,78,0.90)); }
.cover-style3-band { background: linear-gradient(90deg, rgba(26,58,92,0.92), rgba(42,111,151,0.85)); }

.cover-style1-accent { flex: 0 0 3px; align-self: stretch; background: #c0392b; }
.cover-style2-accent { flex: 0 0 3px; align-self: stretch; background: #00b894; }
.cover-style3-accent { flex: 0 0 3px; align-self: stretch; background: #ff6b2b; }

.cover-style-text {
  flex: 1;
  color: #ffffff;
  font-weight: 700;
  line-height: 1.4;
  word-break: break-word;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  white-space: pre-wrap;
}

.cover-frame-section {
  display: grid;
  gap: 8px;
}

.cover-frame-controls {
  display: grid;
  gap: 8px;
}

.cover-timeline-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cover-timeline-time {
  margin-left: auto;
  color: #8a94a4;
  font-variant-numeric: tabular-nums;
}

.cover-capturing-hint {
  color: #f97316;
  font-size: 11px;
}

.cover-timeline {
  position: relative;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #e8edf4;
}

.cover-timeline.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cover-timeline:focus-visible {
  outline: 2px solid #2f6fed;
  outline-offset: 1px;
}

.cover-timeline-track {
  display: flex;
  height: 100%;
}

.cover-timeline-thumb {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.cover-timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  background: #2f6fed;
  box-shadow: 0 0 6px rgba(47, 111, 237, 0.6);
}

.cover-timeline-playhead-grip {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #2f6fed;
}

.cover-field { display: grid; gap: 6px; }

.cover-field-label {
  color: #4c5a6d;
  font-size: 12px;
  font-weight: 700;
}

.cover-font-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.cover-font-field {
  display: grid;
  gap: 6px;
}

.cover-font-size-val {
  color: #2f6fed;
}

.cover-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dbe2ec;
  border-radius: 8px;
  background: #ffffff;
  color: #121924;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}

.cover-input:focus {
  border-color: #2f6fed;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.12);
}

.cover-range-input { width: 100%; margin: 0; }

.cover-title-textarea {
  height: auto;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}

.cover-export-button {
  height: 40px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(180deg, #ff8a3d 0%, #f97316 100%);
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(249, 115, 22, 0.3);
}

.cover-export-button:hover:not(:disabled) {
  filter: brightness(1.05);
}

.cover-export-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
