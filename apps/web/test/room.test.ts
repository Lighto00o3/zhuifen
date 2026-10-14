import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, type PublicRoom, type ScoreEvent, type Session } from '@zhuifen/shared'
import { createApi, credentialGone, errorCode, errorStatus } from '../app/utils/api'
import { roomChanges } from '../app/utils/roomChanges'
import { addSession, forgetSessions, loadSessions, MAX_SESSIONS, pendingKey, SESSIONS_KEY } from '../app/utils/sessions'
import { withStorage } from '../app/utils/storage'
import { createSubscription, MAX_RETRY_DELAY, type SubscribeResponse } from '../app/utils/subscription'

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
  await assert.rejects(missing('/rooms/1'), (e: unknown) => (e as Error).message === '房间不存在' && errorStatus(e) === 404 && errorCode(e) === 'room_not_found' && credentialGone(e))
  const invalid = createApi('', respond(400, '{"message":["昵称太长","房间号不对"]}'))
  await assert.rejects(invalid('/rooms'), (e: unknown) => (e as Error).message === '昵称太长；房间号不对')
  const denied = createApi('', respond(403, '{"message":"无权访问这个房间","code":"access_denied"}'))
  await assert.rejects(denied('/rooms/1'), (e: unknown) => credentialGone(e) && errorStatus(e) === 403)
  const hostOnly = createApi('', respond(403, '{"message":"只有房主可以操作"}'))
  await assert.rejects(hostOnly('/rooms/1'), (e: unknown) => !credentialGone(e))
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

test('api：超时和断网时给出中文提示，并且没有状态码（可以重试）', async () => {
  const hang = createApi('', (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')))), 30)
  await assert.rejects(hang('/rooms'), (e: unknown) => (e as Error).message === '网络超时，请稍后重试' && errorStatus(e) === undefined)
  // 单次请求可以放宽超时：60 毫秒后才返回的请求在 100 毫秒的限制内能成功。
  const slow = createApi('', () => new Promise(resolve => setTimeout(() => resolve(new Response('{"ok":true}')), 60)), 30)
  await assert.rejects(slow('/rooms'), /网络超时/)
  assert.deepEqual(await slow('/rooms', undefined, undefined, 100), { ok: true })
  const offline = createApi('', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(offline('/rooms'), (e: unknown) => (e as Error).message === '网络连接失败，请检查网络后重试' && errorStatus(e) === undefined)
})

test('subscription：订阅失败按退避间隔重试，成功后重置；凭证无效时不再重试', () => {
  const timers: { run: () => void; delay: number }[] = []
  const answers: (SubscribeResponse | 'timeout')[] = []
  const rooms: string[] = []
  const denied: string[] = []
  let active = true
  const subscription = createSubscription({
    emit: done => { const answer = answers.shift()!; answer === 'timeout' ? done(new Error('operation has timed out')) : done(null, answer) },
    active: () => active,
    onRoom: room => rooms.push(room.code),
    onDenied: message => denied.push(message),
    schedule: (run, delay) => { timers.push({ run, delay }); return timers.length },
    cancel: () => {},
  })
  const room = { code: '123456' } as PublicRoom
  answers.push('timeout', { ok: false, code: 'unavailable' }, 'timeout', { ok: true, room })
  subscription.start()
  for (let i = 0; i < 3; i++) timers.at(-1)!.run()
  assert.deepEqual(timers.map(t => t.delay), [1000, 2000, 4000])
  assert.deepEqual(rooms, ['123456'])
  // 退避间隔最多 15 秒。
  answers.push(...Array(8).fill('timeout'))
  subscription.start()
  for (let i = 0; i < 7; i++) timers.at(-1)!.run()
  assert.deepEqual(timers.slice(3).map(t => t.delay), [1000, 2000, 4000, 8000, MAX_RETRY_DELAY, MAX_RETRY_DELAY, MAX_RETRY_DELAY, MAX_RETRY_DELAY])
  // 凭证无效、房间不存在：提示一次，不再重试。
  const scheduled = timers.length
  answers.push({ ok: false, code: 'denied', message: '无法连接房间，请检查加入凭证' })
  subscription.start()
  assert.equal(timers.length, scheduled)
  assert.deepEqual(denied, ['无法连接房间，请检查加入凭证'])
  // socket 已断开或换成了新连接：迟到的回调直接忽略。
  active = false
  answers.push({ ok: true, room })
  subscription.start()
  assert.deepEqual(rooms, ['123456'])
  assert.equal(timers.length, scheduled)
})

test('withStorage：存储被禁用或写满时不抛异常', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
    assert.equal(withStorage(storage => storage.getItem('x')), undefined)
    const full = { setItem() { throw new DOMException('full', 'QuotaExceededError') }, getItem: () => '1' }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: full })
    assert.equal(withStorage(storage => storage.setItem('x', 'y')), undefined)
    assert.equal(withStorage(storage => storage.getItem('x')), '1')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})
