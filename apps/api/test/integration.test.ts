import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import { createApp } from '../src/main';
import { Database } from '../src/database';
import type { PublicRoom, Session } from '../src/model';
import { DEFAULT_RULES } from '../src/model';

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
    await Promise.all([cmd(b, { type: 'score', kind: 'foul', requestId: concurrentIds[0] }), cmd(c, { type: 'score', kind: 'normal', requestId: concurrentIds[1] })]);
    const concurrent = await request(`/rooms/${code}`, undefined, a, 200);
    assert.deepEqual(concurrent.members.map((p: any) => p.score), [101, 95, 104]);
    assert.equal(concurrent.members.reduce((sum: number, p: any) => sum + p.score, 0), 300);
    await cmd(a, { type: 'undo', eventId: scoreId }, 409);
    clients[2]!.socket.disconnect();
    await cmd(b, { type: 'score', kind: 'dajin' });
    const reconnected = await subscribe(c);
    assert.deepEqual(reconnected.state.members.map(p => p.score), [91, 115, 94]);
    await cmd(a, { type: 'end' });
    await cmd(b, { type: 'score', kind: 'foul' }, 409);
    sockets.forEach(socket => socket.disconnect());
    await app.close();
    app = await createApp();
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    const restored = await request(`/rooms/${code}`, undefined, a, 200);
    assert.equal(restored.status, 'ended');
    assert.equal(restored.roomName, '周末球友局');
    assert.deepEqual(restored.members.map((p: any) => p.score), [91, 115, 94]);
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
    const dajin = randomUUID();
    const scored = await command(b, { type: 'score', kind: 'dajin', requestId: dajin });
    assert.deepEqual(scored.members.map((member: any) => member.score), [91, 109]);
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
