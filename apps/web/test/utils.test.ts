import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, type PublicRoom } from '../../api/src/model'
import { formatElapsed } from '../app/utils/format'
import { pointCards } from '../app/utils/pointCards'
import { gameDelta, onlineGames } from '../app/utils/gameHistory'

test('用时按结束时间计算，未开局显示 00:00', () => {
  assert.equal(formatElapsed(), '00:00')
  assert.equal(formatElapsed('2026-01-01T00:00:00Z', '2026-01-01T01:05:09Z'), '65:09')
  assert.equal(formatElapsed('2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z'), '00:00')
})

test('扑克牌面额拆分', () => {
  assert.deepEqual(pointCards(1), [{ rank: 'A', value: 1 }])
  assert.deepEqual(pointCards(20).map(c => c.value), [15, 5])
  assert.deepEqual(pointCards(45).map(c => c.rank), ['J', 'Q', 'K'])
  assert.equal(pointCards(100).reduce((sum, c) => sum + c.value, 0), 100)
  assert.deepEqual(pointCards(0), [])
  assert.deepEqual(pointCards(101), [])
  assert.deepEqual(pointCards(1.5), [])
})

test('联机历史：只收录已结束的局，输赢按本局开局积分计算', () => {
  const member = (id: string, score: number) => ({ id, name: id, score, online: false })
  const base = { code: '123456', hostId: 'a', version: 3, playerCount: 2 as const, initialScore: 100, rules: DEFAULT_RULES, events: [], createdAt: '2026-01-01T00:00:00Z' }
  const playing: PublicRoom = { ...base, status: 'playing', members: [member('a', 104), member('b', 96)], startedAt: '2026-01-01T00:01:00Z' }
  assert.deepEqual(onlineGames(playing), [])
  const ended: PublicRoom = { ...playing, status: 'ended', endedAt: '2026-01-01T00:30:00Z', roundId: 'r2', startingScores: { a: 110, b: 90 },
    rounds: [{ id: 'r1', initialScore: 100, rules: DEFAULT_RULES, members: [member('a', 110), member('b', 90)], events: [], startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:30Z' }] }
  const games = onlineGames(ended)
  assert.deepEqual(games.map(g => g.id), ['123456:r1', '123456:r2'])
  assert.ok(games.every(g => g.mode === 'online' && g.members.every(p => !('online' in p))))
  assert.equal(gameDelta(games[0]!, 'a'), 10)
  assert.equal(gameDelta(games[1]!, 'a'), -6)
})
