import type { PublicRoom } from '@zhuifen/shared'

export interface SubscribeResponse { ok: boolean; room?: PublicRoom; code?: string; message?: string }
type Done = (error: Error | null, response?: SubscribeResponse) => void

export const MAX_RETRY_DELAY = 15_000

// 订阅房间的重试逻辑。socket 连上后才订阅；订阅超时或服务端暂时出错时 socket 本身没断，不会再触发重连，
// 所以要自己按退避间隔重试。凭证无效或房间不存在（denied）时不再重试。
export function createSubscription(options: {
  emit: (done: Done) => void
  // 回调到达时这个 socket 是否还在用（已断开或已换成新连接时忽略结果）。
  active: () => boolean
  onRoom: (room: PublicRoom) => void
  onDenied: (message: string) => void
  schedule?: (run: () => void, delay: number) => unknown
  cancel?: (handle: unknown) => void
}) {
  const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay))
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let attempts = 0
  let timer: unknown
  function attempt() {
    timer = undefined
    options.emit((error, response) => {
      if (!options.active()) return
      if (!error && response?.ok && response.room) { attempts = 0; options.onRoom(response.room); return }
      if (response?.code === 'denied') { options.onDenied(response.message ?? '无法连接房间，请检查加入凭证'); return }
      timer = schedule(attempt, Math.min(1000 * 2 ** attempts++, MAX_RETRY_DELAY))
    })
  }
  function stop() { if (timer !== undefined) cancel(timer); timer = undefined }
  return {
    start() { stop(); attempts = 0; attempt() },
    stop,
  }
}
