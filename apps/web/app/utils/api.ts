export interface ApiError extends Error { status?: number; code?: string }

function failure(message: string, status?: number, code?: string): ApiError {
  return Object.assign(new Error(message), { status, code })
}

export function errorStatus(error: unknown) { return (error as ApiError | undefined)?.status }
export function errorCode(error: unknown) { return (error as ApiError | undefined)?.code }

export function createApi(origin: string, request: typeof fetch = (...args) => fetch(...args)) {
  return async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
    const response = await request(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // 网关超时等情况会返回 HTML，不能直接按 JSON 解析。
    const result = await response.json().catch(() => null) as { message?: string | string[]; code?: string } | null
    if (!result) throw response.ok ? failure('服务返回异常，请稍后重试') : failure('服务暂时不可用，请稍后重试', response.status)
    if (!response.ok) throw failure(Array.isArray(result.message) ? result.message.join('；') : result.message ?? '操作失败', response.status, result.code)
    return result as T
  }
}
