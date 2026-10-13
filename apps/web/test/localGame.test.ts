import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES } from '../../api/src/model'
import { createLocalGame, giveLocal, undoLocal, readLocalGame } from '../app/utils/localGame'

test('三人犯规给上家，黄金9两位输家分别给分，撤销保持总分', () => {
  const original = createLocalGame(['甲', '乙', '丙'], '', 100, DEFAULT_RULES)
  const [a, b, c] = original.members.map(p => p.id)
  const foul = giveLocal(original, a!, 'foul')
  assert.deepEqual(foul.members.map(p => p.score), [99, 100, 101])
  const restored = undoLocal(foul)
  const first = giveLocal(restored, a!, 'golden9', b!)
  const second = giveLocal(first, c!, 'golden9', b!)
  assert.deepEqual(second.members.map(p => p.score), [96, 108, 96])
  assert.deepEqual(undoLocal(second).members.map(p => p.score), [96, 104, 100])
  assert.deepEqual(original.members.map(p => p.score), [100, 100, 100])
  assert.deepEqual(readLocalGame(JSON.stringify(second)), second)
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

test('拒绝重复昵称、非法分值和损坏的本机记录', () => {
  assert.throws(() => createLocalGame(['甲', ' 甲 '], '', 100, DEFAULT_RULES))
  assert.throws(() => createLocalGame(['甲', '乙'], '', 0, DEFAULT_RULES))
  assert.throws(() => createLocalGame(['甲', '乙'], '', 100, { ...DEFAULT_RULES, golden9: 1.5 }))
  assert.throws(() => readLocalGame('{}'))
  const game = createLocalGame(['甲', '乙'], '', 100, DEFAULT_RULES)
  game.members[0]!.score++
  assert.throws(() => readLocalGame(JSON.stringify(game)))
})
