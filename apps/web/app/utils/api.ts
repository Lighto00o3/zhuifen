export interface ApiError extends Error { status?: number; code?: string }

function failure(message: string, status?: number, code?: string): ApiError {
  return Object.assign(new Error(message), { status, code })
}

export function errorStatus(error: unknown) { return (error as ApiError | undefined)?.status }
export function errorCode(error: unknown) { return (error as ApiError | undefined)?.code }
// 房间已被清理，或凭证不属于这个房间（房间号被新房间重新使用）：这份凭证再也用不了，可以删掉。
export function credentialGone(error: unknown) { return ['room_not_found', 'access_denied'].includes(errorCode(error) ?? '') }

// 普通请求的超时时间。进入房间时服务可能正在冷启动（Render 免费实例休眠后要半分钟以上），调用方会单独放宽。
export const REQUEST_TIMEOUT = 20_000
export const WAKE_TIMEOUT = 90_000

export function createApi(origin: string, request: typeof fetch = (...args) => fetch(...args), defaultTimeout = REQUEST_TIMEOUT) {
  return async function api<T>(path: string, body?: unknown, token?: string, timeout = defaultTimeout): Promise<T> {
    // 用 AbortController 加定时器实现超时，旧版 iOS Safari 没有 AbortSignal.timeout。
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      let response: Response
      try {
        response = await request(`${origin}/api${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch {
        // 浏览器给出的是 Failed to fetch、signal is aborted 之类的英文，换成能看懂的提示。
        throw failure(controller.signal.aborted ? '网络超时，请稍后重试' : '网络连接失败，请检查网络后重试')
      }
      // 网关超时等情况会返回 HTML，不能直接按 JSON 解析。
      const result = await response.json().catch(() => null) as { message?: string | string[]; code?: string } | null
      if (controller.signal.aborted) throw failure('网络超时，请稍后重试')
      if (!result) throw response.ok ? failure('服务返回异常，请稍后重试') : failure('服务暂时不可用，请稍后重试', response.status)
      if (!response.ok) throw failure(Array.isArray(result.message) ? result.message.join('；') : result.message ?? '操作失败', response.status, result.code)
      return result as T
    } finally { clearTimeout(timer) }
  }
}
