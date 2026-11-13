import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES } from '@zhuifen/shared'
import { createLocalGame, giveLocal, undoLocal } from '../app/utils/localGame'
import { avatarText, dayKey, dayLabel, describeEvent, durationText, headline, resultStats, shortDay, signed, standings, transferOf, winners } from '../app/utils/result'

function game() {
  let g = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  const [a, b, c] = g.members.map(p => p.id)
  g = giveLocal(g, b!, 'dajin', a!)   // 甲 +10
  g = giveLocal(g, c!, 'normal', a!)  // 甲 +4
  g = giveLocal(g, a!, 'foul', c!)    // 甲 -1，丙 +1
  return { g, a: a!, b: b!, c: c! }
}

test('名次：按本场输赢排序，座位号用来保持头像颜色；并列名次相同', () => {
  const { g } = game()
  assert.deepEqual(standings(g).map(s => [s.player.name, s.delta, s.rank, s.seat]), [['甲', 13, 1, 0], ['丙', -3, 2, 2], ['乙', -10, 3, 1]])
  const tie = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  assert.deepEqual(standings(tie).map(s => s.rank), [1, 1, 1])
  const [a, b, c] = tie.members.map(p => p.id)
  const shared = giveLocal(giveLocal(tie, c!, 'normal', a!), c!, 'normal', b!)
  assert.deepEqual(standings(shared).map(s => [s.player.name, s.rank]), [['甲', 1], ['乙', 1], ['丙', 3]])
})

test('赢家和一句话结论：有人赢、并列赢、打平', () => {
  const { g } = game()
  assert.deepEqual(winners(g).map(s => s.player.name), ['甲'])
  assert.equal(headline(g), '甲赢了 13 分')
  const tie = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  assert.deepEqual(winners(tie), [])
  assert.equal(headline(tie), '这一场，打平了')
  const [a, b, c] = tie.members.map(p => p.id)
  assert.equal(headline(giveLocal(giveLocal(tie, c!, 'normal', a!), c!, 'normal', b!)), '甲、乙并列赢了 4 分')
})

test('输赢按本局开局积分计算（接着上一场的积分再开一局）', () => {
  const { g, a, b } = game()
  const carried = { ...g, startingScores: Object.fromEntries(g.members.map(p => [p.id, p.score])), events: [] }
  assert.equal(headline(carried), '这一场，打平了')
  const next = giveLocal(carried, a, 'xiaojin', b)
  assert.equal(headline(next), '乙赢了 7 分')
})

test('统计：撤销的不算，最大一笔带上类型', () => {
  const { g } = game()
  assert.deepEqual({ ...resultStats({ ...g, endedAt: new Date(Date.parse(g.startedAt) + 65 * 60000).toISOString() }) }, { count: 3, duration: '1 小时 5 分', biggest: { label: '大金', points: 10 } })
  const undone = undoLocal(g)
  assert.equal(resultStats(undone).count, 2)
  assert.equal(resultStats(createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)).biggest, undefined)
})

test('头像文字：默认取第一个字，同桌首字相同时取最后一个字', () => {
  const table = [{ name: '球友甲' }, { name: '球友乙' }, { name: '老王' }]
  assert.deepEqual(table.map(p => avatarText(p.name, table)), ['甲', '乙', '老'])
  assert.equal(avatarText('阿杰', [{ name: '阿杰' }, { name: '小林' }]), '阿')
  assert.equal(avatarText('😀笑', [{ name: '😀笑' }, { name: '😀哭' }]), '笑')
})

test('用时文字', () => {
  const at = (minutes: number) => durationText('2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + minutes * 60000).toISOString())
  assert.deepEqual([0.5, 1, 59, 60, 61, 125].map(at), ['1 分钟内', '1 分钟', '59 分钟', '1 小时', '1 小时 1 分', '2 小时 5 分'])
})

test('一笔记分是谁给谁；旧记录里多人加减分时返回 undefined', () => {
  const { g, a, b } = game()
  assert.deepEqual(transferOf(g.events[0]!), { from: b, to: a, points: 10 })
  assert.equal(transferOf({ ...g.events[0]!, deltas: { x: 8, y: -4, z: -4 } }), undefined)
  assert.equal(transferOf({ ...g.events[0]!, deltas: { x: 0, y: 0 } }), undefined)
  assert.equal(describeEvent(g.events[0]!, g.members), '乙 给 甲 10 分（大金）')
  assert.equal(describeEvent({ ...g.events[0]!, deltas: { x: 8, y: -4, z: -4 } }, g.members), '乙的大金')
  assert.equal(signed(5), '+5'); assert.equal(signed(0), '0'); assert.equal(signed(-3), '-3')
})

test('日期：按本地时区分组，标题显示今天、昨天、几月几日周几，跨年带年份', () => {
  const now = new Date(2026, 10, 14, 9, 0)
  assert.equal(dayKey(new Date(2026, 10, 14, 0, 5)), '2026-11-14')
  assert.equal(dayKey(new Date(2026, 0, 3, 23, 59)), '2026-01-03')
  assert.equal(dayLabel('2026-11-14', now), '今天')
  assert.equal(dayLabel('2026-11-13', now), '昨天')
  assert.equal(dayLabel('2026-11-05', now), '11月5日 周四')
  assert.equal(dayLabel('2025-12-31', now), '2025年12月31日 周三')
  assert.equal(shortDay('2026-11-05', now), '11月5日')
  assert.equal(shortDay('2025-12-31', now), '2025年12月31日')
})
