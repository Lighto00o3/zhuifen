// 页面完成水合（Vue 接管预渲染的 HTML）后在 <html> 上打标记，并补上水合之前点过的按钮（由 public/hydration-guard.js 记下）。
// 每补一次都等界面更新完再点下一个，例如先选「双人追分」再点「创建房间」，结果和当时的操作一致。
// 端到端测试也靠这个标记等页面可以操作。
export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
    document.documentElement.dataset.hydrated = 'true'
    const queue = (window as { __pendingClicks?: HTMLButtonElement[] }).__pendingClicks ?? []
    void (async () => {
      for (const button of queue.splice(0)) {
        await nextTick()
        if (button.isConnected && !button.disabled) button.click()
      }
    })()
  })
})
