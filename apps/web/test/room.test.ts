import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, type PublicRoom, type ScoreEvent, type Session } from '@zhuifen/shared'
import { createApi, errorCode, errorStatus } from '../app/utils/api'
import { roomChanges } from '../app/utils/roomChanges'
import { addSession, forgetSessions, loadSessions, MAX_SESSIONS, pendingKey, SESSIONS_KEY } from '../app/utils/sessions'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
function respond(status: number, body: string, type = 'application/json') {
  return async () => new Response(body, { status, headers: { 'Content-Type': type } })
}

test('api：正常返回 JSON，并带上凭证和请求体', async () => {
  let seen: { url: string; init?: RequestInit } | undefined
  const api = createApi('https://api.example.com', async (url, init) => { seen = { url: String(url), init }; return new Response('{"ok":true}', { status: 200 }) })
  assert.deepEqual(await api('/rooms', { name: 'A' }, 'token'), { ok: true })
  assert.equal(seen?.url, 'https://api.example.com/api/rooms')
  assert.equal(seen?.init?.method, 'POST')
  assert.equal(seen?.init?.body, '{"name":"A"}')
  assert.equal((seen?.init?.headers as Record<string, string>).Authorization, 'Bearer token')
  await api('/rooms/123456')
  assert.equal(seen?.init?.method, 'GET')
  assert.equal((seen?.init?.headers as Record<string, string>).Authorization, undefined)
})

test('api：网关返回 HTML 时给出可读的提示', async () => {
  const gateway = createApi('', respond(502, '<html>Bad Gateway</html>', 'text/html'))
  await assert.rejects(gateway('/rooms'), (e: unknown) => (e as Error).message === '服务暂时不可用，请稍后重试' && errorStatus(e) === 502)
  const broken = createApi('', respond(200, 'not json', 'text/plain'))
  await assert.rejects(broken('/rooms'), (e: unknown) => (e as Error).message === '服务返回异常，请稍后重试' && errorStatus(e) === undefined)
})

test('api：业务错误保留状态码和错误码', async () => {
  const missing = createApi('', respond(404, '{"message":"房间不存在","code":"room_not_found"}'))
  await assert.rejects(missing('/rooms/1'), (e: unknown) => (e as Error).message === '房间不存在' && errorStatus(e) === 404 && errorCode(e) === 'room_not_found')
  const invalid = createApi('', respond(400, '{"message":["昵称太长","房间号不对"]}'))
  await assert.rejects(invalid('/rooms'), (e: unknown) => (e as Error).message === '昵称太长；房间号不对')
  const empty = createApi('', respond(500, '{}'))
  await assert.rejects(empty('/rooms'), (e: unknown) => (e as Error).message === '操作失败' && errorStatus(e) === 500)
})

const members = [
  { id: 'a', name: '阿明', score: 100, online: true },
  { id: 'b', name: '小红', score: 100, online: true },
  { id: 'c', name: '老王', score: 100, online: true },
]
function event(id: string, deltas: Record<string, number>, extra: Partial<ScoreEvent> = {}): ScoreEvent {
  return { id, kind: 'normal', actorId: Object.keys(deltas).find(key => deltas[key]! < 0) ?? 'a', label: '普胜', deltas, createdAt: '2026-01-01T00:00:00Z', ...extra }
}
function room(events: ScoreEvent[], extra: Partial<PublicRoom> = {}): PublicRoom {
  return { code: '123456', hostId: 'a', status: 'playing', version: events.length + 1, playerCount: 3, initialScore: 100, rules: DEFAULT_RULES, members, events, roundId: 'r1', createdAt: '2026-01-01T00:00:00Z', ...extra }
}

test('roomChanges：首次进入、换局时不回放已有记分', () => {
  const state = room([event('e1', { a: -4, b: 4, c: 0 })])
  assert.deepEqual(roomChanges(null, state, 'a'), { transfers: [], notices: [] })
  assert.deepEqual(roomChanges(room([], { roundId: 'r0' }), state, 'a'), { transfers: [], notices: [] })
  assert.deepEqual(roomChanges(room([], { code: '654321' }), state, 'a'), { transfers: [], notices: [] })
  assert.deepEqual(roomChanges(room([]), state, undefined), { transfers: [], notices: [] })
})

test('roomChanges：新记分播放转分动画', () => {
  const { transfers, notices } = roomChanges(room([]), room([event('e1', { a: -4, b: 4, c: 0 })]), 'c')
  assert.deepEqual(notices, [])
  assert.equal(transfers.length, 1)
  assert.deepEqual(transfers[0], { id: 'e1-false', from: 'a', to: 'b', fromName: '阿明', toName: '小红', points: 4, mine: 'c', undo: false, suit: '♠' })
})

test('roomChanges：撤销时反向播放，已处理过的记分不重复', () => {
  const scored = event('e1', { a: -4, b: 4, c: 0 })
  const before = room([scored])
  const undone = room([{ ...scored, undoneAt: '2026-01-01T00:01:00Z' }])
  const { transfers } = roomChanges(before, undone, 'b')
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0]!.id, 'e1-true')
  assert.equal(transfers[0]!.from, 'b')
  assert.equal(transfers[0]!.to, 'a')
  assert.equal(transfers[0]!.undo, true)
  // 同一份状态再收到一次（例如重连快照），不应再提示。
  assert.deepEqual(roomChanges(undone, undone, 'b'), { transfers: [], notices: [] })
  // 加入时就已撤销的记分也不播放。
  assert.deepEqual(roomChanges(room([]), undone, 'b'), { transfers: [], notices: [] })
})

test('roomChanges：没有明确付款方和收款方时，只提示自己的积分变化', () => {
  const odd = event('e1', { a: 0, b: 3, c: 0 }, { actorId: 'a', label: '调整' })
  assert.deepEqual(roomChanges(room([]), room([odd]), 'b').notices, [{ text: '阿明调整，你加了 3 分', positive: true }])
  assert.deepEqual(roomChanges(room([]), room([odd]), 'c'), { transfers: [], notices: [] })
  const self = event('e2', { a: -2, b: 0, c: 0 }, { actorId: 'a', label: '罚分' })
  assert.deepEqual(roomChanges(room([]), room([self]), 'a').notices, [{ text: '你罚分，你扣了 2 分', positive: false }])
  const revoked = roomChanges(room([self]), room([{ ...self, undoneAt: '2026-01-01T00:01:00Z' }]), 'a')
  assert.deepEqual(revoked.notices, [{ text: '已撤销你的罚分，你加了 2 分', positive: true }])
})

const session = (code: string): Session => ({ code, playerId: `p${code}`, token: `t${code}` })

test('sessions：读取时忽略损坏的数据', () => {
  assert.deepEqual(loadSessions(memoryStorage()), [])
  assert.deepEqual(loadSessions(memoryStorage({ [SESSIONS_KEY]: '{broken' })), [])
  assert.deepEqual(loadSessions(memoryStorage({ [SESSIONS_KEY]: '{"code":"1"}' })), [])
  const stored = JSON.stringify([session('111111'), { code: '222222' }, null, 'x'])
  assert.deepEqual(loadSessions(memoryStorage({ [SESSIONS_KEY]: stored })), [session('111111')])
})

test('sessions：最近进入的排最前，同一房间只留一份，最多 12 个', () => {
  let list: Session[] = []
  for (let i = 0; i < MAX_SESSIONS + 3; i++) list = addSession(list, session(String(100000 + i)))
  assert.equal(list.length, MAX_SESSIONS)
  assert.equal(list[0]!.code, String(100000 + MAX_SESSIONS + 2))
  list = addSession(list, { ...session(list[5]!.code), roomName: '周末局' })
  assert.equal(list.length, MAX_SESSIONS)
  assert.equal(list[0]!.roomName, '周末局')
  assert.equal(list.filter(s => s.code === list[0]!.code).length, 1)
})

test('sessions：删除过期房间的凭证和未完成的操作', () => {
  const storage = memoryStorage({ [pendingKey('111111')]: '{}', [pendingKey('222222')]: '{}' })
  const rest = forgetSessions(storage, [session('111111'), session('222222')], ['111111'])
  assert.deepEqual(rest, [session('222222')])
  assert.deepEqual(JSON.parse(storage.data.get(SESSIONS_KEY)!), [session('222222')])
  assert.equal(storage.data.has(pendingKey('111111')), false)
  assert.equal(storage.data.has(pendingKey('222222')), true)
})
