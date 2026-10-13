import { DEFAULT_RULES, LABELS, scoreDeltas, type Player, type Rules, type ScoreEvent, type ScoreKind } from '../../../api/src/model'

export interface LocalGame {
  id: string
  name: string
  initialScore: number
  rules: Rules
  members: Player[]
  events: ScoreEvent[]
  startedAt: string
  endedAt?: string
}
export const LOCAL_GAME_KEY = 'zhuifen:local-game:v1'
export function createLocalGame(names: string[], name: string, initialScore: number, rules: Rules): LocalGame {
  const cleaned = names.map(n => n.trim())
  if (![2, 3].includes(cleaned.length) || cleaned.some(n => !n || n.length > 12) || new Set(cleaned).size !== cleaned.length) throw new Error('请填写不同的球友昵称，每个最多 12 个字。')
  if (!Number.isInteger(initialScore) || initialScore < 1 || initialScore > 10000) throw new Error('初始积分需要在 1–10000 之间。')
  if (Object.keys(DEFAULT_RULES).some(k => !Number.isInteger(rules[k as ScoreKind]) || rules[k as ScoreKind] < 1 || rules[k as ScoreKind] > 100)) throw new Error('各项分值需要在 1–100 之间。')
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 24), initialScore, rules: { ...rules }, members: cleaned.map(name => ({ id: crypto.randomUUID(), name, score: initialScore })), events: [], startedAt: new Date().toISOString() }
}
export function giveLocal(game: LocalGame, actorId: string, kind: ScoreKind, recipientId?: string): LocalGame {
  if (game.endedAt) throw new Error('本场已经结束。')
  const deltas = scoreDeltas(game.members, actorId, kind, game.rules, recipientId)
  const event: ScoreEvent = { id: crypto.randomUUID(), kind, actorId, label: LABELS[kind], deltas, createdAt: new Date().toISOString() }
  return { ...game, members: game.members.map(p => ({ ...p, score: p.score + (deltas[p.id] ?? 0) })), events: [...game.events, event] }
}
export function undoLocal(game: LocalGame): LocalGame {
  if (game.endedAt) throw new Error('本场已经结束。')
  const event = game.events.findLast(e => !e.undoneAt)
  if (!event) throw new Error('还没有可以撤销的记分。')
  return { ...game, members: game.members.map(p => ({ ...p, score: p.score - (event.deltas[p.id] ?? 0) })), events: game.events.map(e => e.id === event.id ? { ...e, undoneAt: new Date().toISOString() } : e) }
}
export function readLocalGame(raw: string): LocalGame {
  const g = JSON.parse(raw) as LocalGame
  if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || !Number.isFinite(Date.parse(g.startedAt)) || (g.endedAt !== undefined && !Number.isFinite(Date.parse(g.endedAt))) || !Array.isArray(g.members) || !Array.isArray(g.events)) throw new Error('本机记录无法读取。')
  createLocalGame(g.members.map(p => p.name), g.name, g.initialScore, g.rules)
  const ids = new Set(g.members.map(p => p.id))
  if (ids.size !== g.members.length || g.members.some(p => typeof p.id !== 'string' || !Number.isSafeInteger(p.score))) throw new Error('本机比分无法读取。')
  if (g.events.some(e => !e || typeof e.id !== 'string' || !ids.has(e.actorId) || !(e.kind in DEFAULT_RULES) || !Number.isFinite(Date.parse(e.createdAt)) || !e.deltas || Object.entries(e.deltas).some(([id, d]) => !ids.has(id) || !Number.isSafeInteger(d)) || Object.values(e.deltas).reduce((a, b) => a + b, 0) !== 0)) throw new Error('本机记分记录无法读取。')
  if (g.members.some(p => p.score !== g.initialScore + g.events.filter(e => !e.undoneAt).reduce((sum, e) => sum + (e.deltas[p.id] ?? 0), 0))) throw new Error('本机比分与记录不一致。')
  return g
}
