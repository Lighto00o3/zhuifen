import type { Session } from '@zhuifen/shared'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>

export const SESSIONS_KEY = 'zhuifen:sessions'
export const MAX_SESSIONS = 12
export const pendingKey = (code: string) => `zhuifen:pending:${code}`

// 本机保存的房间凭证；损坏或格式不对的条目直接忽略。
export function loadSessions(storage: ReadStorage): Session[] {
  try {
    const value = JSON.parse(storage.getItem(SESSIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(s => typeof s?.code === 'string' && typeof s?.token === 'string' && typeof s?.playerId === 'string') : []
  } catch { return [] }
}
export function storeSessions(storage: WriteStorage, sessions: Session[]) {
  storage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}
// 刚进入的房间排在最前，同一房间只保留一份。
export function addSession(sessions: Session[], value: Session) {
  return [value, ...sessions.filter(s => s.code !== value.code)].slice(0, MAX_SESSIONS)
}
// 服务端会清理长期未使用的房间，房间不存在后不再保留它的凭证和未完成的操作。
export function forgetSessions(storage: WriteStorage, sessions: Session[], codes: Iterable<string>) {
  const expired = new Set(codes)
  const rest = sessions.filter(s => !expired.has(s.code))
  storeSessions(storage, rest)
  expired.forEach(code => storage.removeItem(pendingKey(code)))
  return rest
}
