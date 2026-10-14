const pad = (value: number) => String(value).padStart(2, '0')
// 已结束的局按结束时间计算用时，进行中的局按当前时间计算。
export function formatElapsed(startedAt?: string, endedAt?: string) {
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor(((endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(startedAt)) / 1000))
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}
export function clockTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
