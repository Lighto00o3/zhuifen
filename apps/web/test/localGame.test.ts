import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES } from '@zhuifen/shared'
import { createLocalGame, giveLocal, undoLocal, readLocalGame } from '../app/utils/localGame'

test('三人犯规给选中的球友，黄金9两位输家分别给分，撤销保持总分', () => {
  const original = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  const [a, b, c] = original.members.map(p => p.id)
  assert.throws(() => giveLocal(original, a!, 'foul'), /请选择其他球友/)
  assert.deepEqual(giveLocal(original, a!, 'foul', b!).members.map(p => p.score), [99, 101, 100])
  const foul = giveLocal(original, a!, 'foul', c!)
  assert.deepEqual(foul.members.map(p => p.score), [99, 100, 101])
  const restored = undoLocal(foul)
  const first = giveLocal(restored, a!, 'golden9', b!)
  const second = giveLocal(first, c!, 'golden9', b!)
  assert.deepEqual(second.members.map(p => p.score), [96, 108, 96])
  assert.deepEqual(undoLocal(second).members.map(p => p.score), [96, 104, 100])
  assert.deepEqual(original.members.map(p => p.score), [100, 100, 100])
  assert.deepEqual(readLocalGame(JSON.stringify(second)), second)
})

test('三人局大金、黄金9：记完一位输家后提示另一位也给，两笔记全或换了别的操作后不再提示', async () => {
  const { pendingPair } = await import('../app/utils/localGame')
  const start = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  const [a, b, c] = start.members.map(p => p.id)
  assert.equal(pendingPair(start), undefined)
  const first = giveLocal(start, b!, 'dajin', a!)
  assert.deepEqual({ ...pendingPair(first), eventId: undefined }, { eventId: undefined, payerId: c, recipientId: a, kind: 'dajin', points: 10 })
  const both = giveLocal(first, c!, 'dajin', a!)
  assert.equal(pendingPair(both), undefined)
  // 撤销第二笔后又只剩一笔，继续提示
  assert.equal(pendingPair(undoLocal(both))?.payerId, c)
  // 接着又来一次大金（同一个人又输了）：这是新的一对，提示另一位
  const again = giveLocal(both, c!, 'dajin', a!)
  assert.equal(pendingPair(again)?.payerId, b)
  // 普胜、犯规不提示；双人局不提示；结束后不提示
  assert.equal(pendingPair(giveLocal(first, c!, 'normal', a!)), undefined)
  assert.equal(pendingPair(giveLocal(start, b!, 'golden9', c!))?.recipientId, c)
  const duel = createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)
  assert.equal(pendingPair(giveLocal(duel, duel.members[0]!.id, 'dajin', duel.members[1]!.id)), undefined)
  assert.equal(pendingPair({ ...first, endedAt: new Date().toISOString() }), undefined)
})

test('双人允许负分、自定义规则；结束后不能记分或撤销', () => {
  const game = createLocalGame(['甲', '乙'], '练球', 1, { ...DEFAULT_RULES, dajin: 21 })
  const scored = giveLocal(game, game.members[0]!.id, 'dajin', game.members[1]!.id)
  assert.deepEqual(scored.members.map(p => p.score), [-20, 22])
  const ended = { ...scored, endedAt: new Date().toISOString() }
  assert.throws(() => giveLocal(ended, game.members[0]!.id, 'foul'))
  assert.throws(() => undoLocal(ended))
  assert.throws(() => giveLocal(game, game.members[0]!.id, 'normal', game.members[0]!.id))
})

test('昵称可以不填：依次叫球友甲、乙、丙，跳过已经填了的；重开时沿用', async () => {
  const names = (list: string[]) => createLocalGame(list, '', 100, DEFAULT_RULES).members.map(p => p.name)
  assert.deepEqual(names(['', '', '']), ['球友甲', '球友乙', '球友丙'])
  assert.deepEqual(names(['', ' ']), ['球友甲', '球友乙'])
  assert.deepEqual(names(['', '老王', '']), ['球友甲', '老王', '球友乙'])
  assert.deepEqual(names(['', '球友甲', '']), ['球友乙', '球友甲', '球友丙'])
  const { rematchLocal } = await import('../app/utils/localGame')
  const game = { ...createLocalGame(['', ''], '', 100, DEFAULT_RULES), endedAt: new Date().toISOString() }
  assert.deepEqual(rematchLocal(game, false).members.map(p => p.name), ['球友甲', '球友乙'])
  assert.deepEqual(readLocalGame(JSON.stringify(game)), game)
})

test('拒绝重复昵称、非法分值和损坏的本机记录', () => {
  assert.throws(() => createLocalGame(['甲', ' 甲 '], '', 100, DEFAULT_RULES))
  assert.throws(() => createLocalGame(['甲', '名'.repeat(13)], '', 100, DEFAULT_RULES))
  assert.throws(() => createLocalGame(['甲', '乙'], '', 0, DEFAULT_RULES))
  assert.throws(() => createLocalGame(['甲', '乙'], '', 100, { ...DEFAULT_RULES, golden9: 1.5 }))
  assert.throws(() => readLocalGame('{}'))
  const game = createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)
  game.members[0]!.score++
  assert.throws(() => readLocalGame(JSON.stringify(game)))
})

test('重开保留球友规则；继承积分后本场从零计算；历史原子存储与旧数据迁移', async () => {
  const { rematchLocal, loadLocalGames, storeLocalGame, LOCAL_GAME_KEY, LOCAL_GAMES_KEY } = await import('../app/utils/localGame')
  const memory = new Map<string, string>()
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
  let first = createLocalGame(['甲', '乙'], '朋友局', 100, DEFAULT_RULES)
  first = { ...giveLocal(first, first.members[0]!.id, 'normal', first.members[1]!.id), endedAt: new Date().toISOString() }
  storage.setItem(LOCAL_GAME_KEY, JSON.stringify(first))
  assert.equal(loadLocalGames(storage).games.length, 1)
  const carry = rematchLocal(first, true)
  assert.deepEqual(carry.members.map(p => p.score), [96, 104])
  assert.ok(carry.members.every(p => p.score === carry.startingScores![p.id]))
  assert.deepEqual(readLocalGame(JSON.stringify(carry)), carry)
  storeLocalGame(storage, carry)
  const store = loadLocalGames(storage)
  assert.equal(store.currentId, carry.id)
  assert.equal(store.games.length, 2)
  assert.deepEqual(store.games[0], first)
  assert.deepEqual(rematchLocal(first, false).members.map(p => p.score), [100, 100])
  assert.throws(() => rematchLocal(carry, false))
  const before = storage.getItem(LOCAL_GAMES_KEY)
  assert.throws(() => storeLocalGame({ ...storage, setItem: () => { throw new Error('full') } }, rematchLocal(first, false)))
  assert.equal(storage.getItem(LOCAL_GAMES_KEY), before)
})

test('删除单机记录：只删指定的一场，删的是当前这一场时不再有当前场', async () => {
  const { removeLocalGame, loadLocalGames, storeLocalGame } = await import('../app/utils/localGame')
  const memory = new Map<string, string>()
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
  const first = createLocalGame(['甲', '乙'], '第一场', 100, DEFAULT_RULES)
  const second = createLocalGame(['甲', '乙'], '第二场', 100, DEFAULT_RULES)
  storeLocalGame(storage, first); storeLocalGame(storage, second)
  removeLocalGame(storage, first.id)
  assert.deepEqual(loadLocalGames(storage), { currentId: second.id, games: [second] })
  removeLocalGame(storage, 'not-exist')
  assert.equal(loadLocalGames(storage).games.length, 1)
  removeLocalGame(storage, second.id)
  assert.deepEqual(loadLocalGames(storage), { games: [] })
})

test('没有 crypto.randomUUID（局域网 HTTP）时也能开局', async () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  try {
    const game = createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)
    const scored = giveLocal(game, game.members[0]!.id, 'normal', game.members[1]!.id)
    assert.match(scored.events[0]!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.deepEqual(readLocalGame(JSON.stringify(scored)), scored)
  } finally { Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true }) }
})

test('本机与联机历史只保留最近的场次', async () => {
  const { storeLocalGame, loadLocalGames, MAX_LOCAL_GAMES } = await import('../app/utils/localGame')
  const { cacheOnlineGames, ONLINE_HISTORY_KEY, MAX_ONLINE_GAMES } = await import('../app/utils/gameHistory')
  const memory = new Map<string, string>()
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
  const ids: string[] = []
  for (let i = 0; i < MAX_LOCAL_GAMES + 5; i++) {
    const game = createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)
    ids.push(game.id); storeLocalGame(storage, game)
  }
  const store = loadLocalGames(storage)
  assert.equal(store.games.length, MAX_LOCAL_GAMES)
  assert.equal(store.currentId, ids.at(-1))
  assert.deepEqual(store.games.map(g => g.id), ids.slice(-MAX_LOCAL_GAMES))

  const base = Date.parse('2026-01-01T00:00:00Z')
  for (let i = 0; i < MAX_ONLINE_GAMES + 5; i++) {
    const startedAt = new Date(base + i * 60_000).toISOString(), endedAt = new Date(base + i * 60_000 + 1000).toISOString()
    cacheOnlineGames(storage, { code: String(100000 + i), hostId: 'h', status: 'ended', version: 1, playerCount: 2, initialScore: 100, rules: DEFAULT_RULES,
      members: [], events: [], createdAt: startedAt, startedAt, endedAt })
  }
  const online = JSON.parse(storage.getItem(ONLINE_HISTORY_KEY)!) as { code: string }[]
  assert.equal(online.length, MAX_ONLINE_GAMES)
  assert.equal(online[0]!.code, String(100000 + MAX_ONLINE_GAMES + 4))
})
