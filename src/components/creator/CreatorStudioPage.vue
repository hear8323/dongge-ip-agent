<script setup lang="ts">
/**
 * 创作台（整页版）
 *
 * 版式照「东哥智能体」的自动成片工作台：三段式
 *   左 2fr = 创作文案（输入 + 动作 + 创作类型）
 *   中 280px = 创作设置（时长 / 画像 / 模型 / 生成）
 *   右 1fr = 产出预览 + 下一步（送进配音）
 *
 * 只留纯文本创作动作（对话 / 分析 / 热点那几类按老板要求砍掉），
 * 落地的音视频活儿交给「工作流」页，不在这里重复造。
 *
 * 模型走配置中心里同一份模力方舟账户（Qwen3-32B），流式出字。
 */
import { computed, ref } from 'vue'
import { useCreatorAgent } from '@/composables/useCreatorAgent'
import { useAppPage } from '@/composables/useAppPage'

const {
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
} = useCreatorAgent()

const { setPage } = useAppPage()

/** 账号画像展开面板：没写过就默认展开（第一次进来先把画像填了，产出才不是通用货） */
const profileOpen = ref(!profile.value.trim())
const profileDraft = ref(profile.value)

const durationOptions = [30, 45, 60, 90]
const hasProfile = computed(() => !!profile.value.trim())
const profilePeek = computed(() => {
  const text = profile.value.trim().replace(/\s+/g, ' ')
  if (!text) return '还没写 —— 写一次，之后每个动作都自动带上'
  return text.length > 46 ? `${text.slice(0, 46)}…` : text
})

const statusText = computed(() => {
  if (isRunning.value) {
    return `正在写作… ${elapsedText.value} · 已出 ${outputText.value.length} 字`
  }
  if (finishedMs.value !== null && outputText.value.trim()) {
    return `完成 · ${outputText.value.length} 字 · 耗时 ${(finishedMs.value / 1000).toFixed(1)} 秒`
  }
  return '就绪：填主题或粘原文 → 点「✨ 生成」'
})

function pickAction(id: string): void {
  if (isRunning.value) return
  selectAction(id)
}

/** 快捷选题：点一下直接填进输入框 */
function applyQuick(text: string): void {
  if (isRunning.value) return
  inputText.value = text
}

/** 橙色那个：切到「一键成片」再跑，等于一步出全套 */
function runPipeline(): void {
  selectAction('pipeline')
  void run()
}

function openProfile(): void {
  profileDraft.value = profile.value
  profileOpen.value = true
}

function handleSaveProfile(): void {
  saveProfile(profileDraft.value)
  profileOpen.value = false
}

function goWorkflow(): void {
  setPage('workflow')
}
</script>

<template>
  <div class="creator-page">
    <!-- ===== 页头：图标 + 标题 + 说明 ===== -->
    <header class="creator-head">
      <div class="head-icon">
        <span class="hi-emoji">✍️</span>
        <span class="hi-label">创作</span>
      </div>

      <div class="head-copy">
        <h1 class="head-title">创作台</h1>
        <p class="head-desc">{{ activeAction.desc }}</p>
      </div>

      <div class="head-right">
        <span class="pill" :class="{ 'is-ok': hasProfile }">
          {{ hasProfile ? '画像已设置' : '画像未设置' }}
        </span>
        <span class="pill is-model">Qwen3-32B · 模力方舟</span>
      </div>
    </header>

    <!-- ===== 三段式工作台 ===== -->
    <div class="creator-card">
      <div class="creator-cols">
        <!-- ───────── 左：创作文案 ───────── -->
        <section class="col col-main">
          <div class="col-h">
            <span class="col-name">创作文案</span>
            <span class="col-meta">{{ inputText.length }} 字</span>
            <button class="mini" type="button" :disabled="!outputText.trim()" @click="copyOutput">
              📋 复制结果
            </button>
            <button class="mini" type="button" @click="clearAll">🧹 清空</button>
          </div>

          <textarea
            v-model="inputText"
            class="main-input"
            :placeholder="activeAction.ph"
            spellcheck="false"
          />

          <div class="btn-row">
            <button
              v-if="!isRunning"
              class="btn primary"
              type="button"
              :disabled="!inputText.trim()"
              title="按右侧「创作类型」生成；出字是流式的"
              @click="run"
            >
              ✨ 生成
            </button>
            <button v-else class="btn ghost-danger" type="button" @click="stop">
              ■ 停止（{{ elapsedText }}）
            </button>
            <button class="btn ghost" type="button" @click="clearAll">🧹 清空</button>
            <button
              class="btn orange"
              type="button"
              :disabled="isRunning || !inputText.trim()"
              title="一步出全套：选题 + 标题 + 钩子 + 口播 + 分镜 + 三件套"
              @click="runPipeline"
            >
              ⚡ 一键成片
            </button>
          </div>

          <!-- 创作类型（等同原版「素材画面类型」那一排 chips） -->
          <div class="terms">
            <span class="terms-label">创作类型（点一个，右侧参数跟着变）</span>
            <div class="terms-wrap">
              <button
                v-for="item in actions"
                :key="item.id"
                class="term"
                :class="{ 'is-on': item.id === activeActionId }"
                type="button"
                :title="item.desc"
                :disabled="isRunning"
                @click="pickAction(item.id)"
              >
                {{ item.ico }} {{ item.name }}
              </button>
            </div>
          </div>

          <div class="status" :class="{ 'is-busy': isRunning }">{{ statusText }}</div>

          <div v-if="activeAction.quick?.length" class="quick">
            <span class="terms-label">试试这个选题</span>
            <div class="terms-wrap">
              <button
                v-for="q in activeAction.quick"
                :key="q"
                class="term is-quick"
                type="button"
                :disabled="isRunning"
                @click="applyQuick(q)"
              >
                {{ q }}
              </button>
            </div>
          </div>

          <div v-if="!hasProfile" class="warn">
            <span>⚠️ 账号画像没写 —— 出来的东西是通用货</span>
            <button class="link" type="button" @click="openProfile">◎ 去写</button>
          </div>
          <div v-else class="tip">
            ✅ 已带上账号画像 · 目标 {{ seconds }} 秒，约 {{ maxCharsHint }} 字
          </div>
        </section>

        <!-- ───────── 中：创作设置 ───────── -->
        <section class="col col-set">
          <div class="col-h"><span class="col-name">创作设置</span></div>

          <div class="set">
            <span class="set-label">目标时长</span>
            <select v-model.number="seconds" class="set-select">
              <option v-for="sec in durationOptions" :key="sec" :value="sec">
                {{ sec }} 秒
              </option>
            </select>
            <p class="set-hint">约 {{ maxCharsHint }} 字（口语 4.2 字/秒估）</p>
          </div>

          <div class="set">
            <div class="set-row">
              <span class="set-label">账号画像</span>
              <button class="mini" type="button" @click="profileOpen = !profileOpen">
                {{ profileOpen ? '收起' : '展开' }}
              </button>
            </div>
            <p v-if="!profileOpen" class="set-hint">{{ profilePeek }}</p>
            <div v-else class="set-panel">
              <textarea
                v-model="profileDraft"
                class="set-textarea"
                rows="8"
                placeholder="我是谁 / 给谁看 / 讲什么 / 什么调子 / 不做什么"
              />
              <button class="btn primary block" type="button" @click="handleSaveProfile">
                💾 保存画像
              </button>
            </div>
          </div>

          <div class="set">
            <span class="set-label">模型</span>
            <div class="readonly">Qwen3-32B · 模力方舟</div>
            <p class="set-hint">跟工作流共用同一份账户，不额外存 Key</p>
          </div>

          <div class="set-actions">
            <button
              v-if="!isRunning"
              class="btn primary block big"
              type="button"
              :disabled="!inputText.trim()"
              @click="run"
            >
              🚀 开始生成
            </button>
            <button v-else class="btn danger block big" type="button" @click="stop">
              ■ 停止（{{ elapsedText }}）
            </button>
          </div>

          <div class="set-foot">当前动作：{{ activeAction.ico }} {{ activeAction.name }}</div>
        </section>

        <!-- ───────── 右：产出预览 + 下一步 ───────── -->
        <section class="col col-out">
          <div class="col-h">
            <span class="col-name">产出预览</span>
            <button class="mini" type="button" :disabled="!outputText.trim()" @click="copyOutput">
              📋 复制
            </button>
          </div>

          <div class="out-body">
            <pre v-if="outputText.trim()" class="out-text">{{ outputText }}</pre>
            <p v-else class="out-ph">
              生成的内容会显示在这里<br />
              填好左边，点「🚀 开始生成」
            </p>
          </div>

          <div class="next-box">
            <div class="next-title">下一步</div>
            <button
              class="btn primary block"
              type="button"
              :disabled="!outputText.trim()"
              title="写进工作流第三步的文案，直接合成配音"
              @click="sendToVoice"
            >
              📤 送进配音
            </button>
            <button class="btn ghost block" type="button" @click="goWorkflow">
              → 去工作流干活
            </button>
            <p class="next-hint">送进配音后，工作流第三步直接读到这段文案</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.creator-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
}

/* ── 页头 ── */
.creator-head {
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
  font-size: 20px;
  line-height: 1;
}

.hi-label {
  color: #5a6b82;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
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
  min-width: 0;
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
  align-items: center;
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

.pill.is-model {
  border-color: #cddcf5;
  color: #2f6fed;
  background: #f2f6ff;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-weight: 600;
}

/* ── 三段式卡片 ── */
.creator-card {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  border: 1px solid #dfe5ee;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(22, 34, 52, 0.06);
  overflow: hidden;
}

.creator-cols {
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

/* 列头（对应原版 parse-h） */
.col-h {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
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
.col-main {
  padding-bottom: 8px;
}

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
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  border: 1px solid transparent;
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

.btn.danger {
  color: #ffffff;
  background: #e04b47;
  border-color: #e04b47;
}

.btn.danger:hover:not(:disabled) {
  background: #c93c38;
}

.btn.ghost-danger {
  color: #d0453f;
  background: #ffffff;
  border-color: #f0bcb9;
}

.btn.ghost-danger:hover:not(:disabled) {
  background: #fdf3f2;
}

.btn.block {
  width: 100%;
}

.btn.big {
  height: 36px;
  font-size: 13px;
}

/* 创作类型 chips */
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
  gap: 4px;
}

.term {
  padding: 2px 9px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #5d6b7e;
  background: #ffffff;
  font-size: 11.5px;
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
  box-shadow: 0 2px 6px rgba(47, 111, 237, 0.24);
}

.term:disabled {
  opacity: 0.55;
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

.quick {
  flex: 0 0 auto;
  margin: 7px 12px 0;
}

.term.is-quick {
  border-style: dashed;
  color: #4a5f78;
  background: #fbfcfe;
}

.term.is-quick:hover:not(:disabled) {
  border-color: #2f6fed;
  color: #2f6fed;
  background: #f5f8ff;
}

.warn {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 12px 0;
  padding: 5px 9px;
  border: 1px solid #f6dfb8;
  border-radius: 6px;
  color: #a35f10;
  background: #fffaf0;
  font-size: 11.5px;
}

.link {
  margin-left: auto;
  padding: 0;
  border: none;
  color: #2f6fed;
  background: transparent;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}

.link:hover {
  text-decoration: underline;
}

.tip {
  flex: 0 0 auto;
  margin: 6px 12px 0;
  color: #9aa5b5;
  font-size: 11.5px;
}

/* ── 中列：设置 ── */
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

.set-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.set-row .set-label {
  margin-bottom: 0;
}

.set-row .mini {
  margin-left: auto;
}

.set-select {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #dfe5ee;
  border-radius: 7px;
  color: #22303f;
  background: #ffffff;
  font-size: 12.5px;
  outline: none;
  cursor: pointer;
}

.set-select:focus {
  border-color: #2f6fed;
}

.set-hint {
  margin: 4px 0 0;
  color: #9aa5b5;
  font-size: 11px;
  line-height: 1.5;
}

.set-panel {
  display: grid;
  gap: 6px;
  margin-top: 5px;
}

.set-textarea {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #dfe5ee;
  border-radius: 7px;
  color: #22303f;
  background: #fdfefe;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.set-textarea:focus {
  border-color: #2f6fed;
}

.readonly {
  padding: 6px 8px;
  border: 1px dashed #d6dfec;
  border-radius: 7px;
  color: #5d6b7e;
  background: #f8fafd;
  font-size: 12px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
}

.set-actions {
  margin: 10px 12px 0;
  padding-top: 8px;
  border-top: 1px dashed #e3e8f0;
}

.set-foot {
  margin: 8px 12px 0;
  color: #9aa5b5;
  font-size: 11px;
  line-height: 1.5;
}

/* ── 右列：产出 ── */
.out-body {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
  background: #fcfdfe;
  scrollbar-width: thin;
}

.out-text {
  margin: 0;
  color: #22303f;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.out-ph {
  height: 100%;
  display: grid;
  place-content: center;
  margin: 0;
  color: #aab4c2;
  font-size: 12px;
  line-height: 1.8;
  text-align: center;
}

.next-box {
  flex: 0 0 auto;
  display: grid;
  gap: 6px;
  margin: 0 12px 10px;
  padding: 9px;
  border: 1px solid #e6ebf3;
  border-radius: 9px;
  background: #fafbfe;
}

.next-title {
  color: #2b3a4d;
  font-size: 12px;
  font-weight: 800;
}

.next-hint {
  margin: 0;
  color: #9aa5b5;
  font-size: 10.5px;
  line-height: 1.5;
}

/* 窄窗口退化成单栏，别硬挤 */
@media (max-width: 1140px) {
  .creator-cols {
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

  .out-body {
    min-height: 200px;
  }
}
</style>
