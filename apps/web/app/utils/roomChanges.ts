import type { PublicRoom } from '@zhuifen/shared'
import type { Transfer } from '../components/CardTransfer.vue'
import { CARD_SUITS } from './pointCards'

export interface ScoreNotice { text: string; positive: boolean }

// 比较前后两份房间状态，找出新记的分和刚撤销的分，用于播放动画和提示。
// 首次进入、换房间或换局时只恢复比分，不回放历史。
export function roomChanges(before: PublicRoom | null, state: PublicRoom, playerId?: string) {
  const transfers: Transfer[] = []
  const notices: ScoreNotice[] = []
  if (!before || !playerId || before.code !== state.code || before.roundId !== state.roundId) return { transfers, notices }
  const name = (id: string) => state.members.find(p => p.id === id)?.name ?? '球友'
  const oldEvents = new Map(before.events.map(event => [event.id, event]))
  for (const event of state.events) {
    const old = oldEvents.get(event.id)
    const undone = !!old && !old.undoneAt && !!event.undoneAt
    if (!(!old && !event.undoneAt) && !undone) continue
    const entries = Object.entries(event.deltas).map(([id, delta]) => [id, delta * (undone ? -1 : 1)] as const)
    const payer = entries.find(([, delta]) => delta < 0)
    const receiver = entries.find(([, delta]) => delta > 0)
    if (payer && receiver) {
      transfers.push({ id: `${event.id}-${undone}`, from: payer[0], to: receiver[0], fromName: name(payer[0]), toName: name(receiver[0]),
        points: receiver[1], mine: playerId, undo: undone, suit: CARD_SUITS[event.kind] })
      continue
    }
    const delta = (event.deltas[playerId] ?? 0) * (undone ? -1 : 1)
    if (!delta) continue
    const actor = event.actorId === playerId ? '你' : name(event.actorId)
    const action = undone ? `已撤销${actor}的${event.label}` : `${actor}${event.label}`
    notices.push({ text: `${action}，你${delta > 0 ? '加' : '扣'}了 ${Math.abs(delta)} 分`, positive: delta > 0 })
  }
  return { transfers, notices }
}
