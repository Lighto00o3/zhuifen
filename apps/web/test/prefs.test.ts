import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadPrefs, PREFS_KEY, savePrefs } from '../app/utils/prefs'

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[PREFS_KEY, initial]])
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}

test('记住上次填的内容：逐项更新，其余保持不变', () => {
  const storage = memory()
  assert.deepEqual(loadPrefs(storage), {})
  savePrefs(storage, { nickname: '老王', playerCount: 2 })
  savePrefs(storage, { localNames: ['老王', '', '小林'] })
  assert.deepEqual(loadPrefs(storage), { nickname: '老王', playerCount: 2, localNames: ['老王', '', '小林'] })
  // 这次没填昵称：不再记住之前的
  savePrefs(storage, { nickname: '' })
  assert.deepEqual(loadPrefs(storage), { playerCount: 2, localNames: ['老王', '', '小林'] })
})

test('损坏或格式不对的内容直接忽略', () => {
  assert.deepEqual(loadPrefs(memory('{oops')), {})
  assert.deepEqual(loadPrefs(memory('null')), {})
  assert.deepEqual(loadPrefs(memory(JSON.stringify({ nickname: '名'.repeat(13), playerCount: 4, localNames: ['', ''] }))), {})
  assert.deepEqual(loadPrefs(memory(JSON.stringify({ nickname: 123, localNames: ['甲', 5] }))), {})
  assert.deepEqual(loadPrefs(memory(JSON.stringify({ localNames: ['甲'] }))), {})
})
