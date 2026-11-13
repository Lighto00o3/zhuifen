import { LABELS, type Player, type ScoreEvent } from '@zhuifen/shared'
import type { LocalGame } from './localGame'
import { gameDelta } from './gameHistory'

// 一场对局的结算信息：名次、赢家、统计数字。结束页、历史页和战绩海报共用。
export type ResultGame = Pick<LocalGame, 'initialScore' | 'startingScores' | 'members' | 'events' | 'startedAt' | 'endedAt'>

export interface Standing {
  player: Player
  // 在同桌比分里的位置，用来保持头像颜色一致
  seat: number
  delta: number
  // 并列时名次相同：1、1、3
  rank: number
}

// 按本场输赢从高到低排名；输赢相同的按座位顺序排，名次并列。
export function standings(game: ResultGame): Standing[] {
  const sorted = game.members
    .map((player, seat) => ({ player, seat, delta: gameDelta(game as LocalGame, player.id), rank: 0 }))
    .sort((a, b) => b.delta - a.delta || a.seat - b.seat)
  sorted.forEach((item, index) => { item.rank = index > 0 && sorted[index - 1]!.delta === item.delta ? sorted[index - 1]!.rank : index + 1 })
  return sorted
}

// 赢家：本场赢分最多的人。大家都没输赢（全是 0）时没有赢家。
export function winners(game: ResultGame): Standing[] {
  const list = standings(game)
  return list[0] && list[0].delta > 0 ? list.filter(item => item.rank === 1) : []
}

// 一句话结论，例如「老王赢了 11 分」。
export function headline(game: ResultGame): string {
  const top = winners(game)
  if (!top.length) return '这一场，打平了'
  return `${top.map(item => item.player.name).join('、')}${top.length > 1 ? '并列' : ''}赢了 ${top[0]!.delta} 分`
}

// 头像里的一个字：默认取昵称第一个字；同桌有人第一个字相同（比如球友甲、球友乙）就取最后一个字，方便区分。
export function avatarText(name: string, members: { name: string }[]): string {
  const first = [...name][0] ?? ''
  const clash = members.filter(member => [...member.name][0] === first).length > 1
  return clash ? [...name].at(-1) ?? first : first
}

export function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`
}

// 用时。不到一小时显示「12 分钟」，超过显示「1 小时 5 分」，不到一分钟显示「1 分钟内」。
export function durationText(startedAt: string, endedAt?: string): string {
  const minutes = Math.floor(Math.max(0, (endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(startedAt)) / 60000)
  if (minutes < 1) return '1 分钟内'
  if (minutes < 60) return `${minutes} 分钟`
  return minutes % 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${Math.floor(minutes / 60)} 小时`
}

// 一笔记分是谁给谁、多少分。升级前的旧记录可能一笔里有多人加减分，这时返回 undefined，界面改为逐人列出。
export function transferOf(event: ScoreEvent): { from: string; to: string; points: number } | undefined {
  const entries = Object.entries(event.deltas).filter(([, delta]) => delta !== 0)
  if (entries.length !== 2) return undefined
  const from = entries.find(([, delta]) => delta < 0), to = entries.find(([, delta]) => delta > 0)
  return from && to && from[1] + to[1] === 0 ? { from: from[0], to: to[0], points: to[1] } : undefined
}

// 一句话描述一笔记分，例如「小林 给 阿杰 10 分（大金）」。撤销前用来确认撤的是哪一笔。
export function describeEvent(event: ScoreEvent, members: { id: string; name: string }[]): string {
  const name = (id: string) => members.find(member => member.id === id)?.name ?? '球友'
  const transfer = transferOf(event)
  return transfer ? `${name(transfer.from)} 给 ${name(transfer.to)} ${transfer.points} 分（${LABELS[event.kind]}）` : `${name(event.actorId)}的${LABELS[event.kind]}`
}

export interface ResultStats {
  // 没被撤销的记分笔数
  count: number
  duration: string
  // 单笔最大的一次给分
  biggest?: { label: string; points: number }
}
export function resultStats(game: ResultGame): ResultStats {
  const active = game.events.filter(event => !event.undoneAt)
  let biggest: ResultStats['biggest']
  for (const event of active) {
    const points = Math.max(0, ...Object.values(event.deltas))
    if (points > (biggest?.points ?? 0)) biggest = { label: LABELS[event.kind], points }
  }
  return { count: active.length, duration: durationText(game.startedAt, game.endedAt), biggest }
}

const pad = (value: number) => String(value).padStart(2, '0')
// 本地时区的日期键，例如 2026-11-14，用来按天分组和筛选。
export function dayKey(value: string | Date): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// 日期分组的标题：今天、昨天、11月5日 周四；不是今年的带上年份。
export function dayLabel(key: string, now = new Date()): string {
  const [year, month, date] = key.split('-').map(Number) as [number, number, number]
  const day = new Date(year, month - 1, date)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${year === now.getFullYear() ? '' : `${year}年`}${month}月${date}日 ${WEEKDAYS[day.getDay()]}`
}
// 简短日期，例如 11月5日。
export function shortDay(key: string, now = new Date()): string {
  const [year, month, date] = key.split('-').map(Number) as [number, number, number]
  return `${year === now.getFullYear() ? '' : `${year}年`}${month}月${date}日`
}
