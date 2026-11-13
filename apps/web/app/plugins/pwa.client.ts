// 注册 public/sw.js，让网站可以添加到主屏幕、没网时也能打开。开发时不注册，免得缓存干扰热更新和端到端测试。
export default defineNuxtPlugin(() => {
  listenInstallPrompt()
  if (import.meta.dev || !('serviceWorker' in navigator)) return
  const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) }
  if (document.readyState === 'complete') register()
  else addEventListener('load', register, { once: true })
})
