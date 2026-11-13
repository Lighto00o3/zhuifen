import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, defaultName, Player, scoreDeltas, ScoreKind } from '../src/index';
const players: Player[] = [{ id: 'a', name: '甲', score: 100 }, { id: 'b', name: '乙', score: 100 }, { id: 'c', name: '丙', score: 100 }];
test('三人犯规扣自己的分，给选中的球友，不再默认给上家；不选收分人会被拒绝', () => {
  assert.deepEqual(scoreDeltas(players, 'b', 'foul', DEFAULT_RULES, 'a'), { a: 1, b: -1, c: 0 });
  assert.deepEqual(scoreDeltas(players, 'b', 'foul', DEFAULT_RULES, 'c'), { a: 0, b: -1, c: 1 });
  for (const recipient of [undefined, 'b', 'outsider']) assert.throws(() => scoreDeltas(players, 'b', 'foul', DEFAULT_RULES, recipient), /请选择其他球友/);
});
test('双人犯规可以不选收分人，直接给对手', () => {
  const duel = players.slice(0, 2);
  assert.deepEqual(scoreDeltas(duel, 'a', 'foul', DEFAULT_RULES), { a: -1, b: 1 });
  assert.deepEqual(scoreDeltas(duel, 'b', 'foul', DEFAULT_RULES), { a: 1, b: -1 });
  assert.deepEqual(scoreDeltas(duel, 'b', 'foul', DEFAULT_RULES, 'a'), { a: 1, b: -1 });
  assert.throws(() => scoreDeltas(duel, 'b', 'foul', DEFAULT_RULES, 'b'), /请选择其他球友/);
});
test('默认昵称：依次用球友甲、乙、丙，跳过已经有人用的', () => {
  assert.equal(defaultName([]), '球友甲');
  assert.equal(defaultName(['球友甲']), '球友乙');
  assert.equal(defaultName(['老王', '球友甲']), '球友乙');
  assert.equal(defaultName(['球友乙', '球友甲']), '球友丙');
  assert.equal(defaultName(['球友乙']), '球友甲');
});
test('所有座位、类型和自定义分值：只能扣自己，给另一位球友加分，总分守恒', () => {
  for (const members of [players.slice(0, 2), players]) for (const payer of members) for (const recipient of members.filter(p => p.id !== payer.id)) for (const kind of Object.keys(DEFAULT_RULES) as ScoreKind[]) for (const value of [1, 5, 100]) {
    const delta = scoreDeltas(members, payer.id, kind, { ...DEFAULT_RULES, [kind]: value }, recipient.id);
    assert.equal(delta[payer.id], -value);
    assert.equal(Object.values(delta).reduce((a, b) => a + b, 0), 0);
    assert.equal(delta[recipient.id], value);
    for (const player of members.filter(p => p.id !== payer.id && p.id !== recipient.id)) assert.equal(delta[player.id], 0);
  }
});
test('不能给自己加分，也不能省略收分人或给房间外的人', () => {
  for (const recipient of [undefined, 'b', 'outsider']) assert.throws(() => scoreDeltas(players, 'b', 'normal', DEFAULT_RULES, recipient), /请选择其他球友/);
});
test('三人大金由两位输家分别给赢家 10 分，单笔不会扣另一位输家的分', () => {
  const first = scoreDeltas(players, 'b', 'dajin', DEFAULT_RULES, 'a');
  const second = scoreDeltas(players, 'c', 'dajin', DEFAULT_RULES, 'a');
  assert.deepEqual(first, { a: 10, b: -10, c: 0 });
  assert.deepEqual(second, { a: 10, b: 0, c: -10 });
  assert.equal(first.a! + second.a!, 20);
});
test('黄金9默认上下家各给4分，赢家合计得8分；双人只给一份4分', () => {
  const first = scoreDeltas(players, 'b', 'golden9', DEFAULT_RULES, 'a');
  const second = scoreDeltas(players, 'c', 'golden9', DEFAULT_RULES, 'a');
  assert.deepEqual(first, { a: 4, b: -4, c: 0 });
  assert.deepEqual(second, { a: 4, b: 0, c: -4 });
  assert.equal(first.a! + second.a!, 8);
  assert.deepEqual(scoreDeltas(players.slice(0, 2), 'b', 'golden9', DEFAULT_RULES, 'a'), { a: 4, b: -4 });
});
