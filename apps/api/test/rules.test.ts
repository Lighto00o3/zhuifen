import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, Player, scoreDeltas, ScoreKind } from '../src/model';
const players: Player[] = [{ id: 'a', name: '甲', score: 100 }, { id: 'b', name: '乙', score: 100 }, { id: 'c', name: '丙', score: 100 }];
test('乙犯规扣 1 分，甲作为上家加 1 分，丙不变', () => {
  assert.deepEqual(scoreDeltas(players, 'b', 'foul', DEFAULT_RULES), { a: 1, b: -1, c: 0 });
});
test('首位玩家的上家是最后一位，正确处理环形座位', () => {
  assert.deepEqual(scoreDeltas(players, 'a', 'foul', DEFAULT_RULES), { a: -1, b: 0, c: 1 });
});
test('普胜和小金从上家转分，大金与黄金九从另外两家转分', () => {
  assert.deepEqual(scoreDeltas(players, 'b', 'normal', DEFAULT_RULES), { a: -4, b: 4, c: 0 });
  assert.deepEqual(scoreDeltas(players, 'b', 'xiaojin', DEFAULT_RULES), { a: -7, b: 7, c: 0 });
  assert.deepEqual(scoreDeltas(players, 'b', 'dajin', DEFAULT_RULES), { a: -10, b: 20, c: -10 });
  assert.deepEqual(scoreDeltas(players, 'b', 'golden9', DEFAULT_RULES), { a: -4, b: 8, c: -4 });
});
test('所有类型、座位及自定义分值的积分总和都保持不变', () => {
  for (const members of [players.slice(0, 2), players]) for (const player of members) for (const kind of Object.keys(DEFAULT_RULES) as ScoreKind[]) for (const value of [1, 5, 100]) {
    const delta = scoreDeltas(members, player.id, kind, { ...DEFAULT_RULES, [kind]: value });
    assert.equal(Object.values(delta).reduce((a, b) => a + b, 0), 0);
  }
});
test('双人局各类型仅与唯一对手转分，大金与黄金九不重复收分', () => {
  const duel = players.slice(0, 2);
  for (const kind of Object.keys(DEFAULT_RULES) as ScoreKind[]) {
    const value = DEFAULT_RULES[kind];
    const gain = kind === 'foul' ? -value : value;
    assert.deepEqual(scoreDeltas(duel, 'a', kind, DEFAULT_RULES), { a: gain, b: -gain });
    assert.deepEqual(scoreDeltas(duel, 'b', kind, DEFAULT_RULES), { a: -gain, b: gain });
  }
});
