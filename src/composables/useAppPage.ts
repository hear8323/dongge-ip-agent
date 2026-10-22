/**
 * 主页面切换：工作流（原来的四列流水线）/ 自动成片
 *
 * 用模块级 ref 做全局单例，header 上的切换按钮和 App.vue 都读同一份状态。
 * 「创作台」已从导航里去掉（页面文件留在 components/creator/ 下，需要时可随时恢复）。
 */
import { ref } from 'vue'

export type AppPage = 'workflow' | 'auto'

const currentPage = ref<AppPage>('workflow')

export function useAppPage() {
  function setPage(page: AppPage): void {
    currentPage.value = page
  }

  return {
    currentPage,
    setPage,
  }
}
