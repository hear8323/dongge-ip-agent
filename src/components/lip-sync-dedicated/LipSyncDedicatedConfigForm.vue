<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useLipSyncDedicated } from '@/composables/lip-sync-dedicated/useLipSyncDedicated'

const { config: dedicatedConfig, refreshConfig: refreshDedicatedConfig } = useLipSyncDedicated()

// 代理配置（Kling AI 等第三方 API）
const proxyConfig = ref({
  baseUrl: 'http://127.0.0.1:8899',
  providerMode: 'kling' as 'dedicated' | 'kling',
  klingApiKey: '',
  klingSessionId: '',
  klingBaseUrl: 'https://api-beijing.klingai.com',
})

async function loadProxyConfig() {
  try {
    const result = await window.desktopApi.loadLipSyncProxyConfig()
    if (result) {
      proxyConfig.value = { ...proxyConfig.value, ...result }
    }
  } catch (e) {
    console.error('加载代理配置失败:', e)
  }
}

async function saveProxyConfig() {
  try {
    await window.desktopApi.saveLipSyncProxyConfig(proxyConfig.value)
    // 切换模式时更新 baseUrl
    if (proxyConfig.value.providerMode === 'kling') {
      dedicatedConfig.baseUrl = proxyConfig.value.baseUrl
    } else {
      dedicatedConfig.baseUrl = ''
    }
    await refreshDedicatedConfig()
    alert('配置已保存，代理服务将在重启后生效')
  } catch (e) {
    console.error('保存代理配置失败:', e)
    alert('保存失败，请查看控制台日志')
  }
}

const isKling = computed(() => proxyConfig.value.providerMode === 'kling')

// 提示 Kling AI 获取方式
const klingHelp = `1. 登录 https://app.klingai.com/ 获取 API Key
2. 登录后从浏览器 localStorage 获取 session_id（按 F12 → Application → Local Storage）`

loadProxyConfig()
</script>

<template>
  <div class="dedicated-config-form">
    <!-- 模式选择 -->
    <div class="config-tip">
      <p class="config-tip-lead">
        请选择数字人服务模式：
      </p>
      <select v-model="proxyConfig.providerMode" class="mode-select">
        <option value="kling">🎬 Kling AI（免费，每日166积分）</option>
        <option value="dedicated">⚙️ 自建 duix（需云卡/Docker）</option>
      </select>
    </div>

    <!-- Kling AI 配置 -->
    <template v-if="isKling">
      <div class="config-tip">
        <p class="config-tip-lead">
          🎬 <strong>Kling AI 对口型</strong> — 免费额度每日 166 积分（约 30 分钟视频），国内可用，无需租卡
        </p>
        <p style="color:#64748b;font-size:11px;margin-top:6px;">{{ klingHelp }}</p>
      </div>

      <label class="config-field">
        <span>API Key *</span>
        <input
          v-model="proxyConfig.klingApiKey"
          type="password"
          placeholder="sk-xxxxxxxxxxxx"
        />
      </label>

      <label class="config-field">
        <span>Session ID *</span>
        <input
          v-model="proxyConfig.klingSessionId"
          type="text"
          placeholder="从浏览器 localStorage 获取"
        />
      </label>

      <label class="config-field">
        <span>API 地址</span>
        <input
          v-model="proxyConfig.klingBaseUrl"
          type="text"
          placeholder="https://api-beijing.klingai.com"
        />
      </label>

      <label class="config-field">
        <span>代理地址（通常不变）</span>
        <input
          v-model="proxyConfig.baseUrl"
          type="text"
          disabled
          placeholder="http://127.0.0.1:8899"
        />
      </label>
    </template>

    <!-- 自建 duix 配置 -->
    <template v-else>
      <div class="config-tip">
        <p class="config-tip-lead">
          使用自建 duix 服务：
        </p>
        <ol class="config-tip-list">
          <li>本地电脑部署模型，显存推荐 <strong>6G</strong> 及以上（永久免费）</li>
          <li>租云主机部署模型，市场价约 <span class="highlight-red">¥1~3/小时</span></li>
        </ol>
        <p class="config-tip-foot">
          模型部署教程详见：<a href="https://my.feishu.cn/wiki/JvemwfL2aiW5trklsFUceDGhnvf" target="_blank" rel="noreferrer">独享算力部署指南</a>
        </p>
      </div>
      <label class="config-field">
        <span>服务地址</span>
        <input
          v-model="dedicatedConfig.baseUrl"
          type="text"
          placeholder="例如：http://127.0.0.1:8383"
        />
      </label>
    </template>

    <button class="save-btn" @click="saveProxyConfig">保存配置</button>
  </div>
</template>

<style scoped>
.dedicated-config-form {
  display: grid;
  gap: 12px;
}

.config-tip {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #e3ebf3;
  border-radius: 8px;
  background: #f7fafc;
  color: #60728a;
  font-size: 12px;
  line-height: 1.6;
}

.config-tip-lead {
  margin: 0 0 6px 0;
}

.config-tip-list {
  margin: 6px 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
  color: #334155;
}

.config-tip-list strong {
  color: #172033;
}

.config-tip-foot {
  margin: 0;
}

.config-tip a {
  color: #1d6fad;
  font-weight: 700;
  text-decoration: underline;
}

.config-tip a:hover {
  color: #155a8a;
}

.config-tip .highlight-red {
  color: #e53e3e;
  font-weight: 700;
}

.config-field {
  display: grid;
  gap: 6px;
}

.config-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.config-field input,
.config-field select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  outline: none;
}

.config-field input:focus,
.config-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.config-field input:disabled {
  background: #f1f5f9;
  color: #94a3b8;
}

.mode-select {
  height: 36px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  font-size: 13px;
  cursor: pointer;
}

.save-btn {
  height: 36px;
  padding: 0 16px;
  background: #2a6f97;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
}

.save-btn:hover {
  background: #1d5a7a;
}
</style>
