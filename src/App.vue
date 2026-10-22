<script setup lang="ts">
import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
import AutoVideoPage from '@/components/auto/AutoVideoPage.vue'
import DouyinExtractionColumn from '@/components/DouyinExtractionColumn.vue'
import ExportColumn from '@/components/ExportColumn.vue'
import SubtitleRecognitionColumn from '@/components/SubtitleRecognitionColumn.vue'
import VoiceCloneColumn from '@/components/VoiceCloneColumn.vue'
import { useAppPage } from '@/composables/useAppPage'

// 两个页面：workflow = 四列流水线；auto = 自动成片
const { currentPage } = useAppPage()
</script>

<template>
  <div class="app-frame">
    <AppHeader />

    <main class="app-content" :class="{ 'app-content--plain': currentPage !== 'workflow' }">
      <section
        v-if="currentPage === 'workflow'"
        class="column-board"
        aria-label="功能模块区域"
      >
        <DouyinExtractionColumn />
        <VoiceCloneColumn />
        <SubtitleRecognitionColumn />
        <ExportColumn />
      </section>

      <AutoVideoPage v-else />
    </main>

    <AppFooter />
  </div>
</template>
