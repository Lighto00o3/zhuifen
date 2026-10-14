import type { PublicRoom } from '../../../api/src/model'
import type { LocalGame } from './localGame'
export interface HistoryGame extends LocalGame { mode: 'local' | 'online'; code?: string }
export const ONLINE_HISTORY_KEY = 'zhuifen:online-history:v1'
// 联机历史只是缓存，超出部分可以随时从服务端重新拉取。
export const MAX_ONLINE_GAMES = 50
export function onlineGames(room: PublicRoom): HistoryGame[] {
  const rounds = [...(room.rounds ?? [])]
  if (room.status === 'ended' && room.startedAt && room.endedAt) rounds.push({ id: room.roundId ?? room.startedAt, roomName: room.roomName, initialScore: room.initialScore, startingScores: room.startingScores, rules: room.rules, members: room.members, events: room.events, startedAt: room.startedAt, endedAt: room.endedAt })
  return rounds.map(r => ({ id: `${room.code}:${r.id}`, mode: 'online', code: room.code, name: r.roomName ?? '', initialScore: r.initialScore, startingScores: r.startingScores, rules: r.rules, members: r.members.map(({ id, name, score }) => ({ id, name, score })), events: r.events, startedAt: r.startedAt, endedAt: r.endedAt }))
}
export function cacheOnlineGames(storage: Pick<Storage, 'getItem' | 'setItem'>, room: PublicRoom) {
  const incoming = onlineGames(room)
  if (!incoming.length) return
  const previous = JSON.parse(storage.getItem(ONLINE_HISTORY_KEY) ?? '[]') as HistoryGame[]
  const merged = new Map(previous.map(g => [g.id, g]))
  incoming.forEach(g => merged.set(g.id, g))
  const games = [...merged.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, MAX_ONLINE_GAMES)
  storage.setItem(ONLINE_HISTORY_KEY, JSON.stringify(games))
}
export function gameDelta(game: LocalGame, id: string) {
  return (game.members.find(p => p.id === id)?.score ?? 0) - (game.startingScores?.[id] ?? game.initialScore)
}
