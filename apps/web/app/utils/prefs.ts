type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>

// 记住上次填的内容，下次打开不用重填。只存在这台设备的浏览器里。
export interface Prefs {
  // 联机时自己填的昵称（没填就不记）
  nickname?: string
  // 上次建房间选的人数
  playerCount?: 2 | 3
  // 单机模式上次填的球友昵称，按座位顺序；没填的座位是空串
  localNames?: string[]
}
export const PREFS_KEY = 'zhuifen:prefs:v1'

const validName = (value: unknown): value is string => typeof value === 'string' && value.length <= 12

// 读不出来或格式不对的内容直接忽略。
export function loadPrefs(storage: ReadStorage): Prefs {
  try {
    const value = JSON.parse(storage.getItem(PREFS_KEY) ?? '{}')
    if (!value || typeof value !== 'object') return {}
    const prefs: Prefs = {}
    if (validName(value.nickname) && value.nickname) prefs.nickname = value.nickname
    if (value.playerCount === 2 || value.playerCount === 3) prefs.playerCount = value.playerCount
    if (Array.isArray(value.localNames) && [2, 3].includes(value.localNames.length) && value.localNames.every(validName) && value.localNames.some(Boolean)) prefs.localNames = value.localNames
    return prefs
  } catch { return {} }
}
// 只更新传进来的几项，其余保持不变。
export function savePrefs(storage: WriteStorage, patch: Prefs): void {
  storage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(storage), ...patch }))
}
