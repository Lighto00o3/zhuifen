import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, Player, scoreDeltas, ScoreKind } from '../src/model';
const players: Player[] = [{ id: 'a', name: '甲', score: 100 }, { id: 'b', name: '乙', score: 100 }, { id: 'c', name: '丙', score: 100 }];
test('犯规扣自己的分，自动给上家，包括首位的环形座位', () => {
  assert.deepEqual(scoreDeltas(players, 'b', 'foul', DEFAULT_RULES), { a: 1, b: -1, c: 0 });
  assert.deepEqual(scoreDeltas(players, 'a', 'foul', DEFAULT_RULES), { a: -1, b: 0, c: 1 });
});
test('所有座位、类型和自定义分值：只能扣自己，给另一位球友加分，总分守恒', () => {
  for (const members of [players.slice(0, 2), players]) for (const payer of members) for (const recipient of members.filter(p => p.id !== payer.id)) for (const kind of Object.keys(DEFAULT_RULES) as ScoreKind[]) for (const value of [1, 5, 100]) {
    const delta = scoreDeltas(members, payer.id, kind, { ...DEFAULT_RULES, [kind]: value }, recipient.id);
    assert.equal(delta[payer.id], -value);
    assert.equal(Object.values(delta).reduce((a, b) => a + b, 0), 0);
    if (kind !== 'foul') {
      assert.equal(delta[recipient.id], value);
      for (const player of members.filter(p => p.id !== payer.id && p.id !== recipient.id)) assert.equal(delta[player.id], 0);
    }
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
