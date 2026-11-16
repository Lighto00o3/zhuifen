import type { ScoreKind } from '@zhuifen/shared'
import { createScoreVoicePlayer, SCORE_AUDIO, type VoiceNotice } from '../utils/scoreVoice'
import { loadPrefs, savePrefs } from '../utils/prefs'
import { withStorage } from '../utils/storage'

export function useScoreVoice() {
  const supported = ref(false)
  const enabled = ref(false)
  const ready = ref(false)
  const error = ref('')
  let context: AudioContext | undefined
  let player: ReturnType<typeof createScoreVoicePlayer> | undefined
  const buffers = new Map<ScoreKind, Promise<AudioBuffer>>()
  let activation = 0
  function clear() { activation++; player?.clear() }
  function failed() { ready.value = false; error.value = '语音未能播放，请点击试听重试，并检查网络和手机音量。' }
  function load(kind: ScoreKind): Promise<AudioBuffer> {
    let pending = buffers.get(kind)
    if (!pending) {
      pending = fetch(SCORE_AUDIO[kind]).then(response => {
        if (!response.ok) throw new Error('音频加载失败')
        return response.arrayBuffer()
      }).then(data => context!.decodeAudioData(data)).catch(error => { buffers.delete(kind); throw error })
      buffers.set(kind, pending)
    }
    return pending
  }
  function test() {
    if (!supported.value) return
    clear(); error.value = ''; enabled.value = true; ready.value = false
    const token = activation
    withStorage(storage => savePrefs(storage, { scoreVoice: true }))
    try {
      // 在点击的同步调用内创建并恢复音频上下文，手机上远端收分时也能直接播放。
      context ??= new AudioContext()
      player ??= createScoreVoicePlayer(context, load, failed)
      void context.resume().then(() => {
        if (token !== activation) return
        ready.value = true
        player!.enqueue({ id: 'preview', kind: 'xiaojin' })
      }).catch(() => { if (token === activation) failed() })
      // 五条短音频提前加载、解码，后续收分无需等待下载。
      void Promise.allSettled((Object.keys(SCORE_AUDIO) as ScoreKind[]).map(load))
    } catch { failed() }
  }
  function toggle() {
    if (!enabled.value || !ready.value) { test(); return }
    enabled.value = false; ready.value = false; error.value = ''; clear()
    withStorage(storage => savePrefs(storage, { scoreVoice: false }))
  }
  function enqueue(notice: VoiceNotice) {
    if (enabled.value && ready.value && document.visibilityState === 'visible') player?.enqueue(notice)
  }
  function visibility() { if (document.visibilityState !== 'visible') clear() }
  onMounted(() => {
    supported.value = 'AudioContext' in window
    enabled.value = withStorage(loadPrefs)?.scoreVoice ?? false
    document.addEventListener('visibilitychange', visibility)
  })
  onBeforeUnmount(() => {
    clear(); buffers.clear()
    void context?.close().catch(() => {})
    document.removeEventListener('visibilitychange', visibility)
  })
  return { supported, enabled, ready, error, toggle, test, enqueue, revoke: (id: string) => player?.revoke(id), clear }
}
