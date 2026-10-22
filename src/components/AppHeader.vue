<script setup lang="ts">
import { Setting } from '@element-plus/icons-vue'
import { useMoarkAccount } from '@/composables/useMoarkAccount'
import { useAppPage } from '@/composables/useAppPage'
import ConfigCenterModal from '@/components/ConfigCenterModal.vue'
import logoUrl from '@/assets/logo-dong-128.png'

const { isReady, openConfigCenter } = useMoarkAccount()
const { currentPage, setPage } = useAppPage()
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <img class="brand-logo" :src="logoUrl" alt="logo" />
      <div class="brand-text">
        <div class="brand-name">东哥IP智能体</div>
        <div class="brand-sub">AI 内容生产</div>
      </div>
    </div>

    <nav class="tabs">
      <button :class="['tab', { active: currentPage === 'workflow' }]" @click="setPage('workflow')">工作流</button>
      <button :class="['tab', { active: currentPage === 'auto' }]" @click="setPage('auto')">自动成片</button>
    </nav>

    <button class="config-btn" :class="{ ready: isReady }" @click="openConfigCenter">
      <Setting />
      <span>配置</span>
      <span class="dot" :class="{ ok: isReady }"></span>
    </button>

    <ConfigCenterModal />
  </header>
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 70px;
  border-bottom: 1px solid #E0E0E6;
  background: #FFFFFF;
}

.brand { display: flex; align-items: center; gap: 10px; }

.brand-logo {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid #3D3C52;
}

.brand-name { font-size: 16px; font-weight: 700; color: #1A1A2E; }
.brand-sub { font-size: 11px; color: #9898A8; margin-top: 2px; }

.tabs {
  display: flex; gap: 4px;
  background: #F5F5F7; padding: 4px; border-radius: 8px;
}

.tab {
  height: 32px; padding: 0 16px;
  border: none; border-radius: 6px;
  background: transparent; color: #6B6B80;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 150ms;
}
.tab:hover { color: #1A1A2E; background: #F0EFF5; }
.tab.active { background: #2563EB; color: #fff; }

.config-btn {
  display: flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px;
  border: 1px solid #E0E0E6; border-radius: 6px;
  background: #F5F5F7; color: #6B6B80;
  font-size: 13px; cursor: pointer; transition: all 150ms;
}
.config-btn:hover { border-color: #C8C8D0; color: #1A1A2E; }
.config-btn.ready { border-color: #EA580C; color: #EA580C; }

.dot { width: 6px; height: 6px; border-radius: 50%; background: #F59E0B; }
.dot.ok { background: #22C55E; }

@media (max-width: 640px) {
  .brand-sub { display: none; }
}
</style>
