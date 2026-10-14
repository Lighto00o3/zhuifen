// 请求超过几秒还没回来时，提示服务可能正在冷启动（Render 免费实例休眠后，第一次请求要等半分钟以上）。
// 同时有多个请求时，全部结束后提示才消失。
export function useSlowHint(delay = 4000) {
  const slow = ref(false)
  let running = 0
  async function track<T>(run: () => Promise<T>): Promise<T> {
    running++
    const timer = setTimeout(() => { slow.value = true }, delay)
    try { return await run() }
    finally { clearTimeout(timer); if (--running === 0) slow.value = false }
  }
  return { slow, track }
}
