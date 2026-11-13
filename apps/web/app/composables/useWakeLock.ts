import type { Ref } from 'vue'

// 对局进行中保持屏幕常亮：手机放在球台边当记分牌时不会自己熄屏。
// 只在 HTTPS 下可用，浏览器不支持或系统拒绝（比如省电模式）时什么都不做。
export function useWakeLock(active: Ref<boolean>) {
  let lock: WakeLockSentinel | undefined
  async function acquire() {
    if (lock || !active.value || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
    try {
      const current = await navigator.wakeLock.request('screen')
      lock = current
      current.addEventListener('release', () => { if (lock === current) lock = undefined })
      // 申请的过程中对局已经结束了，就马上放掉
      if (!active.value) release()
    } catch { /* 系统拒绝时不影响记分 */ }
  }
  function release() {
    void lock?.release().catch(() => {})
    lock = undefined
  }
  // 切到后台时系统会自动释放，回到页面要重新申请
  const visible = () => { void acquire() }
  onMounted(() => {
    document.addEventListener('visibilitychange', visible)
    watch(active, value => { value ? void acquire() : release() }, { immediate: true })
  })
  onUnmounted(() => { document.removeEventListener('visibilitychange', visible); release() })
}
