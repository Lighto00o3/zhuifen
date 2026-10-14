import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import { Pool } from 'pg';
import { createApp } from '../src/main';
import { Database } from '../src/database';
import { Rooms } from '../src/rooms';
import type { PublicRoom, Session } from '@zhuifen/shared';
import { DEFAULT_RULES } from '@zhuifen/shared';

test('三人真实数据库与实时同步：鉴权、并发、去重、撤销、重连、重启恢复', { timeout: 60000 }, async () => {
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let origin = await app.getUrl();
  const sockets: Socket[] = [];
  let code: string | undefined;
  async function request(path: string, body?: unknown, session?: Session, status = 201): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  async function subscribe(session: Session) {
    const socket = io(origin, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('连接超时')), 5000);
      socket.once('connect_error', reject);
      socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    });
    const result = await new Promise<{ ok: boolean; room: PublicRoom }>((resolve, reject) => {
      socket.timeout(5000).emit('room:subscribe', session, (err: Error | null, result: { ok: boolean; room: PublicRoom }) => err ? reject(err) : resolve(result));
    });
    assert.equal(result.ok, true);
    return { socket, state: result.room };
  }
  async function cmd(session: Session, data: Record<string, unknown>, status = 201) {
    return request(`/rooms/${session.code}/commands`, { requestId: randomUUID(), ...data }, session, status);
  }
  const updated = (socket: Socket, minVersion: number) => new Promise<PublicRoom>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('room:state', listener); reject(new Error('未收到实时比分')); }, 5000);
    function listener(state: PublicRoom) { if (state.version >= minVersion) { clearTimeout(timeout); socket.off('room:state', listener); resolve(state); } }
    socket.on('room:state', listener);
  });
  try {
    await request('/rooms', { name: '', initialScore: 100 }, undefined, 400);
    for (const roomName of [null, 123, '名'.repeat(25)]) await request('/rooms', { name: '甲', roomName }, undefined, 400);
    const created = await request('/rooms', { name: '甲', initialScore: 100 });
    code = created.room.code;
    const a: Session = created.session;
    assert.equal(created.room.playerCount, 3);
    assert.equal(created.room.roomName, undefined);
    // 模拟升级前创建的房间：JSONB 中没有人数字段。
    await app.get(Database).pool.query("UPDATE rooms SET state=state-'playerCount' WHERE code=$1", [code]);
    assert.equal((await request(`/rooms/${code}`, undefined, a, 200)).playerCount, 3);
    assert.equal(JSON.stringify(created.room).includes('tokenHash'), false);
    await request(`/rooms/${code}`, undefined, undefined, 403);
    await cmd(a, { type: 'start' }, 409);
    const joinBody = { name: '乙', token: randomBytes(32).toString('hex'), requestId: randomUUID() };
    const joinedB = await request(`/rooms/${code}/join`, joinBody);
    const b: Session = joinedB.session;
    const retryJoin = await request(`/rooms/${code}/join`, joinBody);
    assert.equal(retryJoin.session.playerId, b.playerId);
    assert.equal(retryJoin.room.members.length, 2);
    const joinedC = await request(`/rooms/${code}/join`, { name: '丙', token: randomBytes(32).toString('hex'), requestId: randomUUID() });
    const c: Session = joinedC.session;
    await request(`/rooms/${code}/join`, { name: '丁', token: randomBytes(32).toString('hex'), requestId: randomUUID() }, undefined, 409);
    await cmd(b, { type: 'start' }, 403);
    const clients = await Promise.all([a, b, c].map(subscribe));
    const config = { type: 'configure', rules: DEFAULT_RULES, initialScore: 100, order: [a.playerId, b.playerId, c.playerId] };
    await cmd(b, { ...config, roomName: '非房主改名' }, 403);
    await cmd(a, { ...config, roomName: '名'.repeat(25) }, 400);
    const nameBroadcast = updated(clients[1]!.socket, clients[1]!.state.version + 1);
    const named = await cmd(a, { ...config, roomName: '  周末球友局  ' });
    assert.equal(named.roomName, '周末球友局');
    assert.equal((await nameBroadcast).roomName, '周末球友局');
    assert.equal((await cmd(a, config)).roomName, '周末球友局');
    assert.equal((await cmd(a, { ...config, roomName: '   ' })).roomName, undefined);
    await cmd(a, { ...config, roomName: '周末球友局' });
    const started = await cmd(a, { type: 'start' });
    await cmd(a, { ...config, roomName: '开局后改名' }, 409);
    const broadcasts = clients.map(client => updated(client.socket, started.version + 1));
    const scoreId = randomUUID();
    const scored = await cmd(b, { type: 'score', kind: 'foul', requestId: scoreId });
    for (const state of await Promise.all(broadcasts)) {
      assert.deepEqual(state.members.map(p => p.score), [101, 99, 100]);
      assert.equal(JSON.stringify(state).includes('tokenHash'), false);
    }
    const duplicate = await cmd(b, { type: 'score', kind: 'foul', requestId: scoreId });
    assert.equal(duplicate.version, scored.version);
    assert.equal(duplicate.events.length, 1);
    await cmd(b, { type: 'score', kind: 'dajin', requestId: scoreId }, 409);
    await cmd(c, { type: 'undo', eventId: scoreId }, 403);
    const undoId = randomUUID();
    const undone = await cmd(b, { type: 'undo', eventId: scoreId, requestId: undoId });
    assert.deepEqual(undone.members.map((p: any) => p.score), [100, 100, 100]);
    await cmd(b, { type: 'undo', eventId: scoreId, requestId: undoId });
    const concurrentIds = [randomUUID(), randomUUID()];
    await Promise.all([cmd(b, { type: 'score', kind: 'foul', requestId: concurrentIds[0] }), cmd(c, { type: 'score', kind: 'normal', recipientId: b.playerId, requestId: concurrentIds[1] })]);
    const concurrent = await request(`/rooms/${code}`, undefined, a, 200);
    assert.deepEqual(concurrent.members.map((p: any) => p.score), [101, 103, 96]);
    assert.equal(concurrent.members.reduce((sum: number, p: any) => sum + p.score, 0), 300);
    await cmd(a, { type: 'undo', eventId: scoreId }, 409);
    clients[2]!.socket.disconnect();
    await cmd(b, { type: 'score', kind: 'dajin', recipientId: a.playerId });
    const reconnected = await subscribe(c);
    assert.deepEqual(reconnected.state.members.map(p => p.score), [111, 93, 96]);
    await cmd(a, { type: 'end' });
    await cmd(b, { type: 'score', kind: 'foul' }, 409);
    sockets.forEach(socket => socket.disconnect());
    await app.close();
    app = await createApp();
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    const restored = await request(`/rooms/${code}`, undefined, a, 200);
    assert.equal(restored.status, 'ended');
    assert.equal(restored.roomName, '周末球友局');
    assert.deepEqual(restored.members.map((p: any) => p.score), [111, 93, 96]);
    assert.equal(restored.events.length, 4);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if (code) await app.get(Database).pool.query('DELETE FROM rooms WHERE code=$1', [code]);
    await app.close();
  }
});

test('双人房间：人数校验、满员限制、两人开局、实时转分、撤销及重启恢复', { timeout: 60000 }, async () => {
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let origin = await app.getUrl();
  const sockets: Socket[] = [];
  let code: string | undefined;
  async function request(path: string, body?: unknown, session?: Session, status = 201): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  const command = (session: Session, body: Record<string, unknown>, status = 201) => request(`/rooms/${session.code}/commands`, { requestId: randomUUID(), ...body }, session, status);
  try {
    for (const playerCount of [1, 4, '2', null]) await request('/rooms', { name: '甲', playerCount }, undefined, 400);
    const created = await request('/rooms', { name: '甲', playerCount: 2, roomName: '  双人练球  ' });
    code = created.room.code;
    const a: Session = created.session;
    assert.equal(created.room.playerCount, 2);
    assert.equal(created.room.roomName, '双人练球');
    await command(a, { type: 'start' }, 409);
    const join = { name: '乙', token: randomBytes(32).toString('hex'), requestId: randomUUID() };
    const b: Session = (await request(`/rooms/${code}/join`, join)).session;
    const retry = await request(`/rooms/${code}/join`, join);
    assert.equal(retry.room.members.length, 2);
    assert.equal(retry.room.roomName, '双人练球');
    assert.equal(retry.session.playerId, b.playerId);
    await request(`/rooms/${code}/join`, { name: '丙', token: randomBytes(32).toString('hex'), requestId: randomUUID() }, undefined, 409);
    await command(a, { type: 'configure', initialScore: 100, rules: DEFAULT_RULES, order: [a.playerId, b.playerId] });
    for (const session of [a, b]) {
      const socket = io(origin, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      const subscribed = await new Promise<{ ok: boolean; room: PublicRoom }>((resolve, reject) => socket.timeout(5000).emit('room:subscribe', session, (error: Error | null, result: { ok: boolean; room: PublicRoom }) => error ? reject(error) : resolve(result)));
      assert.equal(subscribed.ok, true);
      assert.equal(subscribed.room.playerCount, 2);
    }
    const started = await command(a, { type: 'start' });
    await command(a, { type: 'close' }, 409);
    const updates = sockets.map(socket => new Promise<PublicRoom>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('room:state', listener); reject(new Error('双人实时同步超时')); }, 5000);
      function listener(state: PublicRoom) {
        if (state.version <= started.version) return;
        clearTimeout(timeout); socket.off('room:state', listener); resolve(state);
      }
      socket.on('room:state', listener);
    }));
    const requestId = randomUUID();
    const foul = await command(b, { type: 'score', kind: 'foul', requestId });
    for (const state of await Promise.all(updates)) assert.deepEqual(state.members.map(member => member.score), [101, 99]);
    assert.equal((await command(b, { type: 'score', kind: 'foul', requestId })).version, foul.version);
    for (const recipientId of [undefined, b.playerId, randomUUID()]) await command(b, { type: 'score', kind: 'dajin', ...(recipientId ? { recipientId } : {}) }, 400);
    assert.equal((await request(`/rooms/${code}`, undefined, b, 200)).version, foul.version);
    const dajin = randomUUID();
    const scored = await command(b, { type: 'score', kind: 'dajin', recipientId: a.playerId, requestId: dajin });
    assert.deepEqual(scored.members.map((member: any) => member.score), [111, 89]);
    const undone = await command(b, { type: 'undo', eventId: dajin });
    assert.deepEqual(undone.members.map((member: any) => member.score), [101, 99]);
    await command(a, { type: 'end' });
    sockets.forEach(socket => socket.disconnect());
    await app.close();
    app = await createApp(); await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    const restored = await request(`/rooms/${code}`, undefined, a, 200);
    assert.equal(restored.playerCount, 2);
    assert.equal(restored.status, 'ended');
    assert.deepEqual(restored.members.map((member: any) => member.score), [101, 99]);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if (code) await app.get(Database).pool.query('DELETE FROM rooms WHERE code=$1', [code]);
    await app.close();
  }
});

test('房主关闭未开局房间：实时通知、权限、重试、拒绝加入与重启恢复', { timeout: 60000 }, async () => {
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let origin = await app.getUrl();
  const codes: string[] = [];
  const sockets: Socket[] = [];
  async function request(path: string, body?: unknown, session?: Session, status = 201): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  const command = (session: Session, body: Record<string, unknown>, status = 201) => request(`/rooms/${session.code}/commands`, { requestId: randomUUID(), ...body }, session, status);
  try {
    const alone = await request('/rooms', { name: '单人房主', playerCount: 2, roomName: '   ' });
    codes.push(alone.room.code);
    assert.equal(alone.room.roomName, undefined);
    assert.equal((await command(alone.session, { type: 'close' })).status, 'closed');

    const created = await request('/rooms', { name: '甲', playerCount: 3 });
    const a: Session = created.session;
    codes.push(a.code);
    const b: Session = (await request(`/rooms/${a.code}/join`, { name: '乙', token: randomBytes(32).toString('hex'), requestId: randomUUID() })).session;
    await command(b, { type: 'close' }, 403);
    for (const session of [a, b]) {
      const socket = io(origin, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      const result = await new Promise<{ ok: boolean }>((resolve, reject) => socket.timeout(5000).emit('room:subscribe', session, (error: Error | null, result: { ok: boolean }) => error ? reject(error) : resolve(result)));
      assert.equal(result.ok, true);
    }
    const broadcasts = sockets.map(socket => new Promise<PublicRoom>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('room:state', listener); reject(new Error('未收到关闭通知')); }, 5000);
      function listener(state: PublicRoom) {
        if (state.status !== 'closed') return;
        clearTimeout(timeout); socket.off('room:state', listener); resolve(state);
      }
      socket.on('room:state', listener);
    }));
    const requestId = randomUUID();
    const closed = await command(a, { type: 'close', requestId });
    for (const state of await Promise.all(broadcasts)) {
      assert.equal(state.status, 'closed');
      assert.ok(state.closedAt);
      assert.deepEqual(state.members.map(member => member.score), [100, 100]);
    }
    assert.equal((await command(a, { type: 'close', requestId })).version, closed.version);
    await request(`/rooms/${a.code}/join`, { name: '丙', token: randomBytes(32).toString('hex'), requestId: randomUUID() }, undefined, 409);
    await command(a, { type: 'start' }, 409);
    await command(b, { type: 'score', kind: 'foul' }, 409);
    await command(a, { type: 'configure', initialScore: 100, rules: DEFAULT_RULES, order: [a.playerId, b.playerId] }, 409);
    sockets.forEach(socket => socket.disconnect());
    await app.close();
    app = await createApp(); await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    const restored = await request(`/rooms/${a.code}`, undefined, b, 200);
    assert.equal(restored.status, 'closed');
    assert.equal(restored.closedAt, closed.closedAt);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    for (const code of codes) await app.get(Database).pool.query('DELETE FROM rooms WHERE code=$1', [code]);
    await app.close();
  }
});

test('同桌重开：权限、继承与重置、历史快照、重试去重以及过期操作隔离', { timeout: 60000 }, async () => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl(); let code: string | undefined;
  async function req(path: string, data?: unknown, session?: Session, status = 201): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  }
  const cmd = (s: Session, data: Record<string, unknown>, status = 201) => req(`/rooms/${s.code}/commands`, { requestId: randomUUID(), ...data }, s, status);
  try {
    const created = await req('/rooms', { name: '甲', playerCount: 2, roomName: '朋友局' });
    const a: Session = created.session; code = a.code;
    const b: Session = (await req(`/rooms/${code}/join`, { name: '乙', token: randomBytes(32).toString('hex'), requestId: randomUUID() })).session;
    await cmd(a, { type: 'restart', carry: false }, 409);
    await cmd(a, { type: 'start' });
    await cmd(b, { type: 'score', kind: 'normal', recipientId: a.playerId });
    const ended = await cmd(a, { type: 'end' });
    await cmd(b, { type: 'restart', carry: true }, 403);
    await cmd(a, { type: 'restart', carry: 'yes' }, 400);
    const restartId = randomUUID();
    const next = await cmd(a, { type: 'restart', carry: true, requestId: restartId });
    assert.equal(next.roundCount, 1); assert.equal(next.events.length, 0);
    assert.equal('rounds' in next, false);
    assert.deepEqual(next.members.map((p: any) => p.score), [104, 96]);
    assert.deepEqual(next.startingScores, { [a.playerId]: 104, [b.playerId]: 96 });
    const archived = await req(`/rooms/${code}/rounds`, undefined, b, 200);
    assert.equal(archived.length, 1);
    assert.deepEqual(archived[0].events, ended.events);
    assert.deepEqual(archived[0].members.map((p: any) => p.score), [104, 96]);
    await req(`/rooms/${code}/rounds`, undefined, undefined, 403);
    assert.equal(JSON.stringify(next).includes('tokenHash'), false);
    assert.equal((await cmd(a, { type: 'restart', carry: true, requestId: restartId })).version, next.version);
    await cmd(b, { type: 'score', kind: 'foul' }, 409);
    await cmd(a, { type: 'end' }, 409);
    const score = await cmd(b, { type: 'score', kind: 'foul', roundId: restartId });
    assert.deepEqual(score.members.map((p: any) => p.score), [105, 95]);
    await cmd(a, { type: 'end', roundId: restartId });
    await cmd(a, { type: 'restart', carry: false }, 409);
    const reset = await cmd(a, { type: 'restart', carry: false, roundId: restartId });
    assert.equal(reset.roundCount, 2);
    assert.deepEqual(reset.members.map((p: any) => p.score), [100, 100]);
    const rounds = await req(`/rooms/${code}/rounds`, undefined, a, 200);
    assert.deepEqual(rounds.map((r: any) => r.id), [ended.startedAt, restartId]);
    assert.deepEqual(rounds[0].events, ended.events);
    await cmd(b, { type: 'score', kind: 'foul', roundId: restartId }, 409);
    const restored = await req(`/rooms/${code}`, undefined, b, 200);
    assert.equal(restored.roundCount, 2); assert.deepEqual(restored.members.map((p: any) => p.score), [100, 100]);
    // 部署期间旧实例仍可能把历史局写进状态的 rounds 数组，新代码读取时会搬到 room_rounds 表。
    const legacy = { ...rounds[1], id: 'legacy-round' };
    await app.get(Database).pool.query("UPDATE rooms SET state=jsonb_set(state,'{rounds}',$2::jsonb) WHERE code=$1", [code, JSON.stringify([legacy])]);
    const absorbed = await req(`/rooms/${code}`, undefined, a, 200);
    assert.equal(absorbed.roundCount, 3); assert.equal('rounds' in absorbed, false);
    assert.ok(absorbed.version > restored.version);
    assert.deepEqual((await req(`/rooms/${code}/rounds`, undefined, a, 200)).map((r: any) => r.id), [ended.startedAt, restartId, 'legacy-round']);
    const raw = await app.get(Database).pool.query("SELECT state ? 'rounds' AS has FROM rooms WHERE code=$1", [code]);
    assert.equal(raw.rows[0].has, false);
  } finally { if (code) await app.get(Database).pool.query('DELETE FROM rooms WHERE code=$1', [code]); await app.close(); }
});

test('限流：同一 IP 每分钟最多创建 5 个房间、加入 10 次；过期房间自动清理', { timeout: 60000 }, async () => {
  process.env.CLIENT_IP_HEADER = 'x-test-client-ip';
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl(); const codes: string[] = [];
  const post = (path: string, body: unknown, ip: string) => fetch(`${origin}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-client-ip': ip }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 5; i++) {
      const response = await post('/rooms', { name: '甲' }, '203.0.113.1');
      assert.equal(response.status, 201); codes.push((await response.json()).session.code);
    }
    const limited = await post('/rooms', { name: '甲' }, '203.0.113.1');
    assert.equal(limited.status, 429); assert.equal((await limited.json()).message, '操作太频繁，请稍后再试');
    const other = await post('/rooms', { name: '甲' }, '203.0.113.2');
    assert.equal(other.status, 201); codes.push((await other.json()).session.code);

    // 同一凭证重试加入也计入次数，避免靠重试绕过限制。
    const join = () => post(`/rooms/${codes[0]}/join`, { name: '乙', token: 'a'.repeat(64), requestId: randomUUID() }, '203.0.113.3');
    for (let i = 0; i < 10; i++) assert.equal((await join()).status, 201);
    assert.equal((await join()).status, 429);

    const db = app.get(Database);
    await db.pool.query("UPDATE rooms SET updated_at = now() - interval '8 days' WHERE code=$1", [codes[1]]);
    await db.purgeExpiredRooms();
    assert.equal((await db.pool.query('SELECT 1 FROM rooms WHERE code=$1', [codes[1]])).rowCount, 0);
    assert.equal((await db.pool.query('SELECT 1 FROM rooms WHERE code=$1', [codes[2]])).rowCount, 1);
    const missing = await fetch(`${origin}/api/rooms/${codes[1]}`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } });
    assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'room_not_found');
  } finally {
    delete process.env.CLIENT_IP_HEADER;
    await app.get(Database).pool.query('DELETE FROM rooms WHERE code = ANY($1)', [codes]); await app.close();
  }
});

test('数据库空闲连接被断开时服务不退出，下一次请求重新连接', { timeout: 30000 }, async () => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // 查询结束后连接回到池里处于空闲状态，从数据库端断开它，模拟 Neon 重启计算节点或网络中断。
    const pid = (await app.get(Database).pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await new Promise(resolve => setTimeout(resolve, 500));
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.notEqual((await app.get(Database).pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid);
  } finally { await admin.end(); await app.close(); }
});

test('命令校验与限流：请求体上限、字段白名单、每局与每房间上限、试探房间号限流', { timeout: 60000 }, async () => {
  process.env.CLIENT_IP_HEADER = 'x-test-client-ip';
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl(); let code: string | undefined;
  const db = app.get(Database).pool;
  async function send(path: string, body: unknown, ip: string, token?: string) {
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-client-ip': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const cmd = (s: Session, data: Record<string, unknown>, ip = '198.51.100.1') => send(`/rooms/${s.code}/commands`, { requestId: randomUUID(), ...data }, ip, s.token);
  try {
    // 分值设置里多出来的键在创建房间和修改设置时都会被拒绝。
    assert.equal((await send('/rooms', { name: '甲', rules: { ...DEFAULT_RULES, extra: 1 } }, '198.51.100.1')).status, 400);
    const created = await send('/rooms', { name: '甲', playerCount: 2 }, '198.51.100.1');
    const a: Session = created.body.session; code = a.code;
    const b: Session = (await send(`/rooms/${code}/join`, { name: '乙', token: randomBytes(32).toString('hex'), requestId: randomUUID() }, '198.51.100.1')).body.session;
    const order = [a.playerId, b.playerId];
    assert.equal((await cmd(a, { type: 'configure', initialScore: 100, rules: { ...DEFAULT_RULES, extra: 1 }, order })).status, 400);
    assert.equal((await cmd(a, { type: 'start' })).status, 201);

    // 请求体超过 16 KB 直接拒绝；多余字段、属于其他命令的字段、过长的字段都不会写进命令记录。
    const large = await cmd(b, { type: 'score', kind: 'foul', junk: randomBytes(10_000).toString('hex') });
    assert.equal(large.status, 413); assert.equal(large.body.message, '请求内容过大');
    for (const extra of [{ junk: 'x' }, { roomName: '名' }, { carry: true }, { recipientId: 'x'.repeat(65) }, { roundId: 1 }]) {
      const response = await cmd(b, { type: 'score', kind: 'foul', ...extra });
      assert.equal(response.status, 400, JSON.stringify(extra));
    }
    assert.equal((await cmd(b, { type: 'constructor' })).status, 400);
    const stored = await db.query('SELECT max(octet_length(payload::text)) AS size, count(*)::int AS n FROM room_commands WHERE room_code=$1', [code]);
    // 只有通过校验的 start 被记录，被拒绝的命令一条都没写进去。
    assert.ok(stored.rows[0].size < 1024); assert.equal(stored.rows[0].n, 1);

    // 同一 IP 每分钟最多 120 条命令，换一个 IP 不受影响。
    for (let i = 0; i < 120; i++) assert.equal((await cmd(b, { type: 'score', kind: 'foul' }, '198.51.100.2')).status, 201);
    const limited = await cmd(b, { type: 'score', kind: 'foul' }, '198.51.100.2');
    assert.equal(limited.status, 429); assert.equal(limited.body.message, '操作太频繁，请稍后再试');
    assert.equal((await cmd(b, { type: 'score', kind: 'foul' }, '198.51.100.3')).status, 201);

    // 每局最多 2000 笔记分。
    await db.query(`UPDATE rooms SET state=jsonb_set(state,'{events}',(SELECT jsonb_agg(jsonb_build_object('id', g::text, 'deltas', '{}'::jsonb)) FROM generate_series(1, 2000) g)) WHERE code=$1`, [code]);
    const full = await cmd(b, { type: 'score', kind: 'foul' });
    assert.equal(full.status, 409); assert.match(full.body.message, /记分次数已达上限/);
    // 每个房间最多 500 局。
    assert.equal((await cmd(a, { type: 'end' })).status, 201);
    await db.query(`UPDATE rooms SET state=jsonb_set(state,'{roundCount}','500') WHERE code=$1`, [code]);
    const tooMany = await cmd(a, { type: 'restart', carry: false });
    assert.equal(tooMany.status, 409); assert.match(tooMany.body.message, /局数已达上限/);

    // 业务上的 403（不是房主）不算试探。
    for (let i = 0; i < 25; i++) assert.equal((await cmd(b, { type: 'restart', carry: false }, '198.51.100.4')).status, 403);
    // 房间不存在、凭证不对：每个 IP 每分钟最多 20 次，超出后这个 IP 暂时不能查询任何房间。
    for (let i = 0; i < 10; i++) assert.ok([403, 404].includes((await send(`/rooms/${String(100000 + i)}`, undefined, '198.51.100.5', 'c'.repeat(64))).status));
    for (let i = 0; i < 10; i++) assert.equal((await send(`/rooms/${code}`, undefined, '198.51.100.5', 'c'.repeat(64))).status, 403);
    const probing = await send(`/rooms/${code}`, undefined, '198.51.100.5', a.token);
    assert.equal(probing.status, 429);
    assert.equal((await send(`/rooms/${code}/rounds`, undefined, '198.51.100.5', a.token)).status, 429);
    assert.equal((await send(`/rooms/${code}`, undefined, '198.51.100.6', a.token)).status, 200);
    const denied = await send(`/rooms/${code}`, undefined, '198.51.100.7', 'c'.repeat(64));
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'access_denied');
  } finally {
    delete process.env.CLIENT_IP_HEADER;
    if (code) await db.query('DELETE FROM rooms WHERE code=$1', [code]);
    await app.close();
  }
});

test('实时订阅失败：凭证无效时返回 denied（不再重试），数据库暂时出错时返回 unavailable（客户端稍后重试）', { timeout: 30000 }, async () => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl(); let code: string | undefined;
  const socket = io(origin, { transports: ['websocket'], forceNew: true });
  const subscribe = (body: unknown) => new Promise<{ ok: boolean; code?: string; message?: string; room?: PublicRoom }>((resolve, reject) =>
    socket.timeout(5000).emit('room:subscribe', body, (error: Error | null, result: { ok: boolean; code?: string }) => error ? reject(error) : resolve(result)));
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
    const created = await (await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '甲' }) })).json();
    const session: Session = created.session; code = session.code;
    // 房间不存在和凭证不对返回同样的结果，不能用来试探房间号。
    const wrongToken = await subscribe({ ...session, token: 'd'.repeat(64) });
    const missing = await subscribe({ ...session, code: code === '999999' ? '999998' : '999999' });
    for (const result of [wrongToken, missing, await subscribe({ code: 123 }), await subscribe('bad')]) {
      assert.equal(result.ok, false); assert.equal(result.code, 'denied');
    }
    assert.deepEqual(wrongToken, missing);
    // 数据库暂时不可用。
    const rooms = app.get(Rooms);
    const read = rooms.read.bind(rooms);
    rooms.read = async () => { throw new Error('connection terminated unexpectedly'); };
    const unavailable = await subscribe(session);
    assert.equal(unavailable.ok, false); assert.equal(unavailable.code, 'unavailable');
    rooms.read = read;
    const recovered = await subscribe(session);
    assert.equal(recovered.ok, true); assert.equal(recovered.room?.code, code);
  } finally {
    socket.disconnect();
    if (code) await app.get(Database).pool.query('DELETE FROM rooms WHERE code=$1', [code]);
    await app.close();
  }
});
