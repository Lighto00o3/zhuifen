// 页面完成水合（Vue 接管服务端渲染的 HTML）后在 <html> 上打标记。
// 水合之前按钮还没有绑定事件，点了没有反应；端到端测试据此等页面可以操作后再点。
export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.hooks.hookOnce('app:suspense:resolve', () => { document.documentElement.dataset.hydrated = 'true' })
})
