import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, type PublicRoom, type ScoreEvent, type ScoreKind } from '@zhuifen/shared'
import { createScoreVoicePlayer, SCORE_AUDIO, scoreVoiceChanges, scoreVoiceNotice } from '../app/utils/scoreVoice'
import { loadPrefs, savePrefs, PREFS_KEY } from '../app/utils/prefs'

function event(extra: Partial<ScoreEvent> = {}): ScoreEvent {
  return { id: 'e1', actorId: 'payer', kind: 'xiaojin', label: '小金', deltas: { payer: -4, winner: 4, other: 0 }, createdAt: new Date().toISOString(), ...extra }
}
function room(events: ScoreEvent[], extra: Partial<PublicRoom> = {}): PublicRoom {
  return { code: '123456', hostId: 'payer', status: 'playing', version: 1, playerCount: 3, initialScore: 100, rules: DEFAULT_RULES, members: [], events, roundId: 'r1', createdAt: '', ...extra }
}

test('只在收分玩家的设备播类型；分值自定义不影响类型，单机不读昵称', () => {
  assert.deepEqual(scoreVoiceNotice(event(), 'winner'), { id: 'e1', kind: 'xiaojin' })
  assert.equal(scoreVoiceNotice(event(), 'payer'), undefined)
  assert.equal(scoreVoiceNotice(event(), 'other'), undefined)
  assert.deepEqual(scoreVoiceNotice(event()), { id: 'e1', kind: 'xiaojin' })
  assert.equal(scoreVoiceNotice(event({ undoneAt: new Date().toISOString() })), undefined)
  for (const kind of Object.keys(DEFAULT_RULES) as ScoreKind[]) {
    assert.equal(scoreVoiceNotice(event({ kind }))?.kind, kind)
    assert.equal(SCORE_AUDIO[kind], `/audio/score/v1/${kind}.mp3`)
  }
})

test('首次进入、换房换局、结束、重复快照和过期记分都不播报', () => {
  const state = room([event()])
  for (const before of [null, room([], { code: '654321' }), room([], { roundId: 'r0' }), state]) {
    assert.deepEqual(scoreVoiceChanges(before, state, 'winner').notices, [])
  }
  assert.deepEqual(scoreVoiceChanges(room([]), room([event({ createdAt: new Date(Date.now() - 60_000).toISOString() })]), 'winner').notices, [])
  assert.deepEqual(scoreVoiceChanges(room([]), room([event()], { status: 'ended' }), 'winner').notices, [])
  assert.deepEqual(scoreVoiceChanges(room([]), state).notices, [])
  assert.deepEqual(scoreVoiceChanges(room([]), state, 'payer').notices, [])
  assert.deepEqual(scoreVoiceChanges(room([]), state, 'winner').notices, [{ id: 'e1', kind: 'xiaojin' }])
})

test('撤销返回原事件ID，不会将退还的分数当成新的得分', () => {
  const scored = event()
  const undone = { ...scored, undoneAt: new Date().toISOString() }
  assert.deepEqual(scoreVoiceChanges(room([scored]), room([undone]), 'payer'), { notices: [], revoked: ['e1'] })
  assert.deepEqual(scoreVoiceChanges(room([]), room([undone]), 'winner'), { notices: [], revoked: [] })
})

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function playback(load?: (kind: ScoreKind) => Promise<AudioBuffer>) {
  const played: { kind: ScoreKind; end: () => void; stopped: boolean; connected: boolean }[] = []
  let errors = 0
  const context = {
    state: 'running', destination: {},
    createBufferSource() {
      const node = {
        buffer: null as unknown as AudioBuffer, onended: null as (() => void) | null,
        connect() {}, disconnect() { if (item) item.connected = false },
        start() {
          item = { kind: (node.buffer as unknown as { kind: ScoreKind }).kind, end: () => node.onended?.(), stopped: false, connected: true }
          played.push(item)
        },
        stop() { if (item) item.stopped = true },
      }
      let item: (typeof played)[number] | undefined
      return node
    },
  } as unknown as AudioContext
  const player = createScoreVoicePlayer(context, load ?? (async kind => ({ kind }) as unknown as AudioBuffer), () => { errors++ })
  return { player, played, context, errors: () => errors }
}

test('连续收分顺序播放对应音频，队列中的重复事件只播一次', async () => {
  const { player, played } = playback()
  try {
    player.enqueue({ id: '1', kind: 'xiaojin' })
    player.enqueue({ id: '1', kind: 'xiaojin' })
    player.enqueue({ id: '2', kind: 'dajin' })
    player.enqueue({ id: '2', kind: 'dajin' })
    await flush()
    assert.deepEqual(played.map(item => item.kind), ['xiaojin'])
    played[0]!.end(); await flush()
    assert.deepEqual(played.map(item => item.kind), ['xiaojin', 'dajin'])
    assert.equal(played[0]!.connected, false)
    played[1]!.end(); await flush()
    assert.equal(played.length, 2)
  } finally { player.clear() }
})

test('撤销待播或正在播的事件，迟到回调不影响后续音频', async () => {
  const { player, played } = playback()
  try {
    player.enqueue({ id: '1', kind: 'xiaojin' })
    player.enqueue({ id: '2', kind: 'dajin' })
    player.enqueue({ id: '3', kind: 'normal' })
    await flush()
    const late = played[0]!.end
    player.revoke('2'); player.revoke('1'); await flush()
    assert.equal(played[0]!.stopped, true)
    assert.deepEqual(played.map(item => item.kind), ['xiaojin', 'normal'])
    late()
    player.enqueue({ id: '4', kind: 'golden9' })
    await flush(); assert.equal(played.length, 2)
    played[1]!.end(); await flush()
    assert.equal(played[2]!.kind, 'golden9')
  } finally { player.clear() }
})

test('撤销或关闭时正在下载的音频，下载完成后也不会突然播放', async () => {
  let resolve!: (buffer: AudioBuffer) => void
  const pending = new Promise<AudioBuffer>(done => { resolve = done })
  const { player, played } = playback(() => pending)
  player.enqueue({ id: '1', kind: 'dajin' })
  player.revoke('1')
  resolve({} as AudioBuffer); await flush()
  assert.equal(played.length, 0)
  player.enqueue({ id: '2', kind: 'normal' })
  player.clear(); await flush()
  assert.equal(played.length, 0)
})

test('下载失败或浏览器暂停音频时清空队列，提示重试', async () => {
  const failed = playback(async () => { throw new Error('音频加载失败') })
  failed.player.enqueue({ id: '1', kind: 'dajin' })
  failed.player.enqueue({ id: '2', kind: 'xiaojin' })
  await flush()
  assert.equal(failed.errors(), 1)
  assert.equal(failed.played.length, 0)
  const suspended = playback()
  Object.defineProperty(suspended.context, 'state', { value: 'suspended' })
  suspended.player.enqueue({ id: '1', kind: 'normal' })
  await flush()
  assert.equal(suspended.errors(), 1)
  assert.equal(suspended.played.length, 0)
})

test('保存语音开关不覆盖昵称和人数，损坏的设置被忽略', () => {
  let value = JSON.stringify({ nickname: '阿杰', playerCount: 3 })
  const storage = { getItem: (key: string) => key === PREFS_KEY ? value : null, setItem: (_key: string, next: string) => { value = next } }
  savePrefs(storage, { scoreVoice: true })
  assert.deepEqual(loadPrefs(storage), { nickname: '阿杰', playerCount: 3, scoreVoice: true })
  savePrefs(storage, { nickname: '球友' })
  assert.equal(loadPrefs(storage).scoreVoice, true)
  value = '{"scoreVoice":"true"}'
  assert.deepEqual(loadPrefs(storage), {})
})
