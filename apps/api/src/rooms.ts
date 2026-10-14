import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Database } from './database';
import type { PoolClient } from 'pg';
import { DEFAULT_RULES, LABELS, Member, PlayerCount, RoomState, RoundRecord, Rules, ScoreKind, scoreDeltas } from '@zhuifen/shared';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求格式不正确');
  return value as Record<string, unknown>;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 12) throw new BadRequestException('昵称需要 1–12 个字');
  return value.trim();
}
function roomName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length > 24) throw new BadRequestException('房间名最多 24 个字');
  return value.trim() || undefined;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new BadRequestException(`分值需要是 ${min}–${max} 的整数`);
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('操作编号不正确');
  return value;
}
// 前端据此判断房间已被清理，与未知路由等其他 404 区分开。
export const ROOM_NOT_FOUND = 'room_not_found';
// 凭证不对（不是这个房间的成员），与「只有房主可以操作」等业务上的 403 区分开。
export const ACCESS_DENIED = 'access_denied';
// 每局记分和每个房间的局数设上限，防止房间状态无限增长；正常使用远远达不到。
export const MAX_EVENTS_PER_ROUND = 2000;
export const MAX_ROUNDS_PER_ROOM = 500;
// 各命令允许的字段，其他字段一律拒绝，避免把无关数据写进命令记录。
const COMMAND_FIELDS: Record<string, readonly string[]> = {
  close: [], start: [], end: [], score: ['kind', 'recipientId'], undo: ['eventId'], restart: ['carry'],
  configure: ['roomName', 'initialScore', 'rules', 'order'],
};
const COMMON_FIELDS = ['type', 'requestId', 'roundId'];
function commandFields(data: Record<string, unknown>) {
  const type = String(data.type);
  if (!Object.hasOwn(COMMAND_FIELDS, type)) throw new BadRequestException('不支持的操作');
  const allowed = COMMAND_FIELDS[type]!;
  if (Object.keys(data).some(key => !COMMON_FIELDS.includes(key) && !allowed.includes(key))) throw new BadRequestException('请求格式不正确');
  for (const key of ['roundId', 'recipientId', 'eventId']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || (data[key] as string).length > 64)) throw new BadRequestException('请求格式不正确');
  }
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function playerCount(value: unknown): PlayerCount {
  if (value === undefined) return 3;
  if (value !== 2 && value !== 3) throw new BadRequestException('追分人数只能选择 2 人或 3 人');
  return value;
}
// 已有房间没有人数字段，继续按原来的三人模式读取与处理。
function restoreState(value: RoomState): RoomState {
  return { ...value, playerCount: value.playerCount ?? 3 };
}
function member(nickname: unknown): { member: Member; token: string } {
  const token = randomBytes(32).toString('hex');
  return { member: { id: randomUUID(), name: name(nickname), tokenHash: hash(token), score: 0 }, token };
}
export function authenticate(state: RoomState, token: unknown): Member {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ForbiddenException({ message: '请重新加入房间', code: ACCESS_DENIED });
  const found = state.members.find(item => item.tokenHash === hash(token));
  if (!found) throw new ForbiddenException({ message: '无权访问这个房间', code: ACCESS_DENIED });
  return found;
}
function settings(data: Record<string, unknown>): { rules: Rules; initialScore: number } {
  const input: Record<string, unknown> = data.rules === undefined ? DEFAULT_RULES : object(data.rules);
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_RULES, key))) throw new BadRequestException('分值设置不正确');
  const rules = Object.fromEntries(Object.keys(DEFAULT_RULES).map(key => [key, integer(input[key], 1, 100)])) as Rules;
  return { rules, initialScore: integer(data.initialScore ?? 100, 1, 10000) };
}

@Injectable()
export class Rooms {
  constructor(@Inject(Database) private readonly db: Database) {}
  validateCode(code: string) {
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('房间号需要是 6 位数字');
  }
  async read(code: string): Promise<RoomState> {
    this.validateCode(code);
    const result = await this.db.pool.query('SELECT state FROM rooms WHERE code=$1', [code]);
    if (!result.rows[0]) throw new NotFoundException({ message: '房间不存在，请检查房间号', code: ROOM_NOT_FOUND });
    const state = restoreState(result.rows[0].state);
    // 状态里还带着历史局（旧版本代码在迁移后写入的），先搬到 room_rounds 表再返回。
    return state.rounds ? this.transaction(code, async () => false) : state;
  }
  // 已结束的局按顺序返回，用于历史页补齐本机缺少的对局。
  async rounds(code: string, token: unknown): Promise<RoundRecord[]> {
    authenticate(await this.read(code), token);
    const result = await this.db.pool.query('SELECT record FROM room_rounds WHERE room_code=$1 ORDER BY seq', [code]);
    return result.rows.map(row => row.record);
  }
  private async archiveRound(client: PoolClient, state: RoomState, round: RoundRecord) {
    const seq = (state.roundCount ?? 0) + 1;
    await client.query('INSERT INTO room_rounds(room_code,round_id,seq,record) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [state.code, round.id, seq, round]);
    state.roundCount = seq;
  }
  // 部署新版本时旧实例可能还在运行，它会把历史局继续写进状态的 rounds 数组。
  private async absorbLegacyRounds(client: PoolClient, state: RoomState) {
    if (!state.rounds) return false;
    for (const round of state.rounds) await this.archiveRound(client, state, round);
    delete state.rounds;
    const count = await client.query('SELECT count(*)::int AS n FROM room_rounds WHERE room_code=$1', [state.code]);
    state.roundCount = count.rows[0].n;
    return true;
  }
  async create(body: unknown) {
    const data = object(body);
    const owner = member(data.name);
    const config = settings(data);
    const capacity = playerCount(data.playerCount);
    const title = roomName(data.roomName);
    owner.member.score = config.initialScore;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = String(randomInt(100000, 1000000));
      const state: RoomState = { code, roomName: title, hostId: owner.member.id, status: 'waiting', version: 1,
        ...config, playerCount: capacity, members: [owner.member], events: [], createdAt: new Date().toISOString() };
      const result = await this.db.pool.query('INSERT INTO rooms(code,state) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING code', [code, state]);
      if (result.rowCount) return { state, session: { code, playerId: owner.member.id, token: owner.token } };
    }
    throw new ConflictException('暂时无法创建房间，请重试');
  }
  async join(code: string, body: unknown) {
    this.validateCode(code);
    const data = object(body);
    const newcomer = member(data.name);
    const requestId = uuid(data.requestId);
    // 防止网络重试占用第二个座位：客户端为这次加入保留同一个随机 token。
    if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new BadRequestException('加入凭证不正确');
    newcomer.token = data.token;
    newcomer.member.tokenHash = hash(data.token);
    const state = await this.transaction(code, async state => {
      const existing = state.members.find(item => item.tokenHash === newcomer.member.tokenHash);
      if (existing) { newcomer.member = existing; return false; }
      if (state.status === 'closed') throw new ConflictException('房间已关闭，无法加入');
      if (state.status !== 'waiting') throw new ConflictException('比赛已开始，请使用原来的设备恢复');
      if (state.members.length >= state.playerCount) throw new ConflictException(`${state.playerCount === 2 ? '双人' : '三人'}房间已满`);
      if (state.members.some(item => item.name === newcomer.member.name)) throw new ConflictException('这个昵称已被使用，请换一个');
      newcomer.member.score = state.initialScore;
      state.members.push(newcomer.member);
      return true;
    });
    return { state, session: { code, playerId: newcomer.member.id, token: newcomer.token }, requestId };
  }
  private async transaction(code: string, update: (state: RoomState, client: PoolClient) => Promise<boolean>): Promise<RoomState> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT state FROM rooms WHERE code=$1 FOR UPDATE', [code]);
      if (!result.rows[0]) throw new NotFoundException({ message: '房间不存在', code: ROOM_NOT_FOUND });
      const state = restoreState(result.rows[0].state);
      const absorbed = await this.absorbLegacyRounds(client, state);
      if (await update(state, client) || absorbed) {
        state.version++;
        await client.query('UPDATE rooms SET state=$2,updated_at=now() WHERE code=$1', [code, state]);
      }
      await client.query('COMMIT');
      return state;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async command(code: string, token: string | undefined, body: unknown) {
    this.validateCode(code);
    const data = object(body);
    commandFields(data);
    const requestId = uuid(data.requestId);
    return this.transaction(code, async (state, client) => {
      const actor = authenticate(state, token);
      const prior = await client.query('SELECT actor_id,payload=$3::jsonb AS same FROM room_commands WHERE room_code=$1 AND request_id=$2', [code, requestId, data]);
      if (prior.rows[0]) {
        // 同一编号只能重试原来的操作，不能伪装成另一条命令。
        if (prior.rows[0].actor_id !== actor.id || !prior.rows[0].same) throw new ConflictException('操作编号已被使用');
        return false;
      }
      const hostOnly = () => { if (actor.id !== state.hostId) throw new ForbiddenException('只有房主可以操作'); };
      if (['score', 'undo', 'end', 'restart'].includes(String(data.type)) && state.roundId && data.roundId !== state.roundId) throw new ConflictException('已进入新一局，请查看最新比分后再操作');
      switch (data.type) {
        case 'close':
          hostOnly();
          if (state.status !== 'waiting') throw new ConflictException('只能关闭等待开局的房间，比赛开始后请结束本场');
          state.status = 'closed'; state.closedAt = new Date().toISOString();
          break;
        case 'start':
          hostOnly();
          if (state.status !== 'waiting' || state.members.length !== state.playerCount) throw new ConflictException(`需要 ${state.playerCount} 人加入后再开始`);
          state.status = 'playing'; state.startedAt = new Date().toISOString();
          break;
        case 'configure': {
          hostOnly();
          if (state.status !== 'waiting') throw new ConflictException('只能在开局前修改规则');
          const config = settings(data);
          if (Object.hasOwn(data, 'roomName')) state.roomName = roomName(data.roomName);
          const order = data.order;
          if (!Array.isArray(order) || order.length !== state.members.length || new Set(order).size !== order.length || order.some(id => !state.members.some(item => item.id === id))) throw new BadRequestException('玩家顺序不正确');
          state.members = order.map(id => state.members.find(item => item.id === id)!);
          Object.assign(state, config);
          state.members.forEach(item => { item.score = config.initialScore; });
          break;
        }
        case 'score': {
          if (state.status !== 'playing') throw new ConflictException('当前比赛不能记分');
          if (state.events.length >= MAX_EVENTS_PER_ROUND) throw new ConflictException('这一局的记分次数已达上限，请结束本场后再开一局');
          if (typeof data.kind !== 'string' || !Object.hasOwn(DEFAULT_RULES, data.kind)) throw new BadRequestException('计分类型不正确');
          const kind = data.kind as ScoreKind;
          if (kind !== 'foul' && (typeof data.recipientId !== 'string' || data.recipientId === actor.id || !state.members.some(item => item.id === data.recipientId))) throw new BadRequestException('请选择其他球友收分');
          const deltas = scoreDeltas(state.members, actor.id, kind, state.rules, data.recipientId as string | undefined);
          state.members.forEach(item => { item.score += deltas[item.id]!; });
          state.events.push({ id: requestId, kind, actorId: actor.id, label: kind === 'foul' ? LABELS[kind] : `给分（${LABELS[kind]}）`, deltas, createdAt: new Date().toISOString() });
          break;
        }
        case 'undo': {
          if (state.status !== 'playing') throw new ConflictException('当前比赛不能撤销');
          const event = state.events.findLast(item => !item.undoneAt);
          if (!event || event.id !== data.eventId) throw new ConflictException('记录已变化，请查看最新一条操作');
          if (actor.id !== event.actorId && actor.id !== state.hostId) throw new ForbiddenException('只能撤销自己的操作，或由房主撤销');
          state.members.forEach(item => { item.score -= event.deltas[item.id]!; });
          event.undoneAt = new Date().toISOString();
          break;
        }
        case 'restart': {
          hostOnly();
          if (state.status !== 'ended' || !state.startedAt || !state.endedAt) throw new ConflictException('请先结束本场，再开一局');
          if ((state.roundCount ?? 0) >= MAX_ROUNDS_PER_ROOM) throw new ConflictException('这个房间的局数已达上限，请新开一个房间');
          if (data.carry !== true && data.carry !== false) throw new BadRequestException('请选择重置积分或接着上一场');
          await this.archiveRound(client, state, { id: state.roundId ?? state.startedAt, roomName: state.roomName,
            initialScore: state.initialScore, startingScores: state.startingScores, rules: { ...state.rules },
            members: state.members.map(({ id, name, score }) => ({ id, name, score })),
            events: state.events, startedAt: state.startedAt, endedAt: state.endedAt });
          if (!data.carry) state.members.forEach(item => { item.score = state.initialScore; });
          state.startingScores = Object.fromEntries(state.members.map(item => [item.id, item.score]));
          state.roundId = requestId; state.events = []; state.status = 'playing';
          state.startedAt = new Date().toISOString(); delete state.endedAt;
          break;
        }
        case 'end':
          hostOnly();
          if (state.status !== 'playing') throw new ConflictException('比赛尚未开始或已经结束');
          state.status = 'ended'; state.endedAt = new Date().toISOString();
          break;
        default: throw new BadRequestException('不支持的操作');
      }
      await client.query('INSERT INTO room_commands(room_code,request_id,actor_id,payload) VALUES($1,$2,$3,$4)', [code, requestId, actor.id, data]);
      return true;
    });
  }
}
