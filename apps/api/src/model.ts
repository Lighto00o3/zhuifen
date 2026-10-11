export type ScoreKind = 'foul' | 'normal' | 'xiaojin' | 'dajin' | 'golden9';
export type PlayerCount = 2 | 3;
export type Rules = Record<ScoreKind, number>;
export const DEFAULT_RULES: Rules = { foul: 1, normal: 4, xiaojin: 7, dajin: 10, golden9: 4 };
export const LABELS: Record<ScoreKind, string> = { foul: '犯规', normal: '普胜', xiaojin: '小金', dajin: '大金', golden9: '黄金九' };
export interface Player { id: string; name: string; score: number }
export interface Member extends Player { tokenHash: string }
export interface ScoreEvent {
  id: string; kind: ScoreKind; actorId: string; label: string;
  deltas: Record<string, number>; createdAt: string; undoneAt?: string;
}
export interface RoomState {
  code: string; hostId: string; status: 'waiting' | 'playing' | 'ended';
  version: number; playerCount: PlayerCount; initialScore: number; rules: Rules; members: Member[];
  events: ScoreEvent[]; createdAt: string; startedAt?: string; endedAt?: string;
}
export interface PublicRoom extends Omit<RoomState, 'members'> {
  members: (Player & { online: boolean })[];
}
export interface Session { code: string; playerId: string; token: string }

// 座位顺序沿出杆方向排列：前一位是上家，后一位是下家。
// 默认：犯规给上家；普胜/小金收上家；大金/黄金九收其余玩家。双人局的上家就是对手。
export function scoreDeltas(members: Player[], actorId: string, kind: ScoreKind, rules: Rules): Record<string, number> {
  const index = members.findIndex(member => member.id === actorId);
  if ((members.length !== 2 && members.length !== 3) || index < 0) throw new Error('需要两名或三名有效玩家');
  const actor = members[index]!;
  const previous = members[(index + members.length - 1) % members.length]!;
  const deltas: Record<string, number> = Object.fromEntries(members.map(member => [member.id, 0]));
  const value = rules[kind];
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('分值需要在 1–100 之间');
  if (kind === 'foul') {
    deltas[actor.id] = -value;
    deltas[previous.id] = value;
  } else {
    const payers = kind === 'dajin' || kind === 'golden9' ? members.filter(member => member.id !== actorId) : [previous];
    for (const payer of payers) { deltas[payer.id] = -value; deltas[actor.id]! += value; }
  }
  return deltas;
}
