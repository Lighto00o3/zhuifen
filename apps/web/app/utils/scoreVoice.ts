import type { PublicRoom, ScoreEvent, ScoreKind } from '@zhuifen/shared'

export const SCORE_AUDIO: Record<ScoreKind, string> = {
  foul: '/audio/score/v1/foul.mp3',
  normal: '/audio/score/v1/normal.mp3',
  xiaojin: '/audio/score/v1/xiaojin.mp3',
  dajin: '/audio/score/v1/dajin.mp3',
  golden9: '/audio/score/v1/golden9.mp3',
}
export interface VoiceNotice { id: string; kind: ScoreKind }

// 联机只播自己收到的分；单机不传 playerId，播报整桌。
export function scoreVoiceNotice(event: ScoreEvent, playerId?: string): VoiceNotice | undefined {
  if (event.undoneAt || !(playerId ? (event.deltas[playerId] ?? 0) > 0 : Object.values(event.deltas).some(delta => delta > 0))) return
  return { id: event.id, kind: event.kind }
}

export function scoreVoiceChanges(before: PublicRoom | null, state: PublicRoom, playerId?: string) {
  const notices: VoiceNotice[] = []
  const revoked: string[] = []
  if (!before || !playerId || before.code !== state.code || before.roundId !== state.roundId || state.status !== 'playing') return { notices, revoked }
  const oldEvents = new Map(before.events.map(event => [event.id, event]))
  for (const event of state.events) {
    const old = oldEvents.get(event.id)
    if (old && !old.undoneAt && event.undoneAt) revoked.push(event.id)
    if (old || Date.now() - Date.parse(event.createdAt) > 10_000) continue
    const notice = scoreVoiceNotice(event, playerId)
    if (notice) notices.push(notice)
  }
  return { notices, revoked }
}

// 自己维护短队列，撤销、关闭或离开页面时，连正在加载的音频也一起取消。
export function createScoreVoicePlayer(context: AudioContext, load: (kind: ScoreKind) => Promise<AudioBuffer>, onError: () => void) {
  let queue: (VoiceNotice & { queuedAt: number })[] = []
  let current: VoiceNotice | undefined
  let source: AudioBufferSourceNode | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  function stop() {
    generation++
    current = undefined
    clearTimeout(timer)
    if (source) {
      source.onended = null
      try { source.stop() } catch { /* 尚未开始播放的节点不需要停止 */ }
      source.disconnect()
      source = undefined
    }
  }
  function clear() { queue = []; stop() }
  async function next() {
    if (current) return
    const item = queue.shift()
    if (!item) return
    if (Date.now() - item.queuedAt > 10_000) { void next(); return }
    current = item
    const token = ++generation
    const fail = () => {
      if (token !== generation) return
      clear(); onError()
    }
    timer = setTimeout(fail, 8000)
    try {
      const buffer = await load(item.kind)
      if (token !== generation) return
      if (Date.now() - item.queuedAt > 10_000) { stop(); void next(); return }
      if (context.state !== 'running') { fail(); return }
      const node = context.createBufferSource()
      node.buffer = buffer
      node.connect(context.destination)
      node.onended = () => {
        if (token !== generation) return
        clearTimeout(timer)
        node.disconnect(); source = undefined; current = undefined
        void next()
      }
      source = node
      node.start()
    } catch { fail() }
  }
  return {
    enqueue(notice: VoiceNotice) {
      if (current?.id === notice.id || queue.some(item => item.id === notice.id)) return
      queue.push({ ...notice, queuedAt: Date.now() })
      void next()
    },
    revoke(id: string) {
      queue = queue.filter(item => item.id !== id)
      if (current?.id === id) { stop(); void next() }
    },
    clear,
  }
}
