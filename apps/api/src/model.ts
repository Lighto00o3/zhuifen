export type ScoreKind = 'foul' | 'normal' | 'xiaojin' | 'dajin' | 'golden9';
export type PlayerCount = 2 | 3;
export type Rules = Record<ScoreKind, number>;
export const DEFAULT_RULES: Rules = { foul: 1, normal: 4, xiaojin: 7, dajin: 10, golden9: 4 };
export const LABELS: Record<ScoreKind, string> = { foul: '犯规', normal: '普胜', xiaojin: '小金', dajin: '大金', golden9: '黄金9' };
export interface Player { id: string; name: string; score: number }
export interface Member extends Player { tokenHash: string }
export interface ScoreEvent {
  id: string; kind: ScoreKind; actorId: string; label: string;
  deltas: Record<string, number>; createdAt: string; undoneAt?: string;
}
export interface RoundRecord {
  id: string; roomName?: string; initialScore: number; startingScores?: Record<string, number>;
  rules: Rules; members: Player[]; events: ScoreEvent[]; startedAt: string; endedAt: string;
}
export interface RoomState {
  code: string; roomName?: string; hostId: string; status: 'waiting' | 'playing' | 'ended' | 'closed';
  version: number; playerCount: PlayerCount; initialScore: number; rules: Rules; members: Member[];
  events: ScoreEvent[];
  // 已结束并归档到 room_rounds 表的局数；rounds 只出现在迁移前或旧版本代码写入的数据里。
  roundCount?: number; rounds?: RoundRecord[]; roundId?: string; startingScores?: Record<string, number>; createdAt: string; startedAt?: string; endedAt?: string; closedAt?: string;
}
export interface PublicRoom extends Omit<RoomState, 'members' | 'rounds'> {
  members: (Player & { online: boolean })[];
}
export interface Session { code: string; playerId: string; token: string; roomName?: string }

// 输家发起给分：犯规自动给上家，其余类型给指定的赢家，每次只支付一份分值。
export function scoreDeltas(members: Player[], actorId: string, kind: ScoreKind, rules: Rules, recipientId?: string): Record<string, number> {
  const index = members.findIndex(member => member.id === actorId);
  if ((members.length !== 2 && members.length !== 3) || index < 0) throw new Error('需要两名或三名有效玩家');
  const recipient = kind === 'foul' ? members[(index + members.length - 1) % members.length] : members.find(member => member.id === recipientId && member.id !== actorId);
  if (!recipient) throw new Error('请选择其他球友收分');
  const value = rules[kind];
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('分值需要在 1–100 之间');
  const deltas: Record<string, number> = Object.fromEntries(members.map(member => [member.id, 0]));
  deltas[actorId] = -value;
  deltas[recipient.id] = value;
  return deltas;
}
