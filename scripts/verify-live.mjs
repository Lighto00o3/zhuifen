import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const origin = process.argv[2];
assert.ok(origin?.startsWith('https://'), '请传入线上 API 的 HTTPS 地址');
const playerCount = Number(process.argv[3] ?? 3);
assert.ok(playerCount === 2 || playerCount === 3, '追分人数只能是 2 或 3');
const expectedScores = playerCount === 2 ? [101, 99] : [101, 99, 100];
const sockets = [];
let host;
async function request(path, body, session) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  assert.ok(response.ok, `请求失败：${response.status} ${path}`);
  return response.json();
}
const command = (session, body) => request(`/rooms/${session.code}/commands`, { requestId: randomUUID(), ...body }, session);
try {
  await request('/health');
  const created = await request('/rooms', { name: '上线验证甲', initialScore: 100, playerCount });
  assert.equal(created.room.playerCount, playerCount);
  host = created.session;
  const sessions = [host];
  for (const name of ['上线验证乙', '上线验证丙'].slice(0, playerCount - 1)) {
    const joined = await request(`/rooms/${host.code}/join`, { name, token: randomBytes(32).toString('hex'), requestId: randomUUID() });
    sessions.push(joined.session);
  }
  for (const session of sessions) {
    const socket = io(origin, { transports: ['websocket'], forceNew: true, timeout: 30000 });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const result = await new Promise((resolve, reject) => socket.timeout(30000).emit('room:subscribe', session, (error, state) => error ? reject(error) : resolve(state)));
    assert.equal(result.ok, true);
  }
  const started = await command(host, { type: 'start' });
  const changes = sockets.map(socket => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('room:state', listener); reject(new Error('线上实时同步超时')); }, 30000);
    function listener(state) {
      if (state.version <= started.version) return;
      clearTimeout(timeout); socket.off('room:state', listener); resolve(state);
    }
    socket.on('room:state', listener);
  }));
  await command(sessions[1], { type: 'score', kind: 'foul' });
  for (const state of await Promise.all(changes)) assert.deepEqual(state.members.map(member => member.score), expectedScores);
  console.log(`线上检查通过：API、${playerCount} 人加入、WebSocket、犯规后全部客户端实时显示 ${expectedScores.join(' / ')}。`);
} finally {
  sockets.forEach(socket => socket.disconnect());
  if (host) await command(host, { type: 'end' });
}
