<script setup lang="ts">
import { gsap } from 'gsap'

useHead({ title: '追分 · 设计体验', meta: [{ name: 'robots', content: 'noindex' }] })
const route = useRoute()
const night = ref(route.query.theme === 'night')
const players = reactive([{ id: 'lin', name: '小林', score: 94 }, { id: 'chen', name: '小陈', score: 94 }, { id: 'me', name: '我', score: 112 }])
const values = [{ value: 1, label: '犯规' }, { value: 4, label: '普胜' }, { value: 7, label: '小金' }, { value: 10, label: '大金' }]
const mine = computed(() => players[2]!)
const selected = ref(4)
const sheet = ref<HTMLDialogElement | null>(null)
const busy = ref(false)
const flight = ref<HTMLDivElement | null>(null)
const flightValue = ref(7)
const feedback = ref('点一张牌，试着给球友分')
const received = ref(false)
const records = ref<{ id: number; from: string; to: string; value: number; text: string }[]>([])
const historyOpen = ref(false)
let sequence = 0
let animation: gsap.core.Timeline | undefined
let trigger: HTMLElement | null = null
function theme(value: boolean) {
  night.value = value
  const url = new URL(window.location.href)
  url.searchParams.set('theme', value ? 'night' : 'light')
  window.history.replaceState(window.history.state, '', url)
}
function choose(value: number) {
  if (busy.value) return
  if (value === 1) { void transfer('me', 'lin', 1); return }
  selected.value = value
  trigger = document.activeElement as HTMLElement
  sheet.value?.showModal()
}
function closeSheet() { sheet.value?.close() }
function sheetClosed() { trigger?.focus() }
function target(id: string) { return document.querySelector<HTMLElement>(`[data-preview-player="${id}"]`) }
function clearAnimation() { animation?.revert(); animation = undefined; busy.value = false }
function settle(from: string, to: string, value: number, undo: boolean) {
  players.find(p => p.id === from)!.score -= value
  players.find(p => p.id === to)!.score += value
  received.value = to === 'me'
  const fromName = from === 'me' ? '你' : players.find(p => p.id === from)!.name
  const toName = to === 'me' ? '你' : players.find(p => p.id === to)!.name
  feedback.value = undo ? '上一笔已撤销，积分已还原' : to === 'me' ? `${fromName}给了你 ${value} 分，好球！` : `已给${toName} ${value} 分，下一杆继续`
  if (!undo) records.value.unshift({ id: ++sequence, from, to, value, text: `${fromName}给${toName} ${value} 分` })
  records.value = records.value.slice(0, 20)
}
async function transfer(from: string, to: string, value: number, undo = false) {
  if (busy.value) return
  closeSheet()
  busy.value = true
  received.value = false
  flightValue.value = value
  await nextTick()
  const source = target(from), destination = target(to)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!source || !destination || !flight.value || reduced) { settle(from, to, value, undo); busy.value = false; return }
  const a = source.getBoundingClientRect(), b = destination.getBoundingClientRect()
  const x1 = a.x + a.width / 2 - 35, y1 = a.y + a.height / 2 - 48
  const x2 = b.x + b.width / 2 - 35, y2 = b.y + b.height / 2 - 48
  const node = flight.value
  animation = gsap.timeline({ onComplete: clearAnimation })
  animation.fromTo(node, { x: x1, y: y1, rotation: -14, rotationY: -45, scale: .7, opacity: 0 }, { opacity: 1, rotationY: 0, scale: 1, y: y1 - 25, duration: .22, ease: 'power2.out' })
    .to(source, { scale: .97, duration: .15, repeat: 1, yoyo: true }, 0)
    .to(node, { x: (x1 + x2) / 2 + 28, y: Math.min(y1, y2) - 30, rotation: 9, duration: .38, ease: 'power1.out' }, .22)
    .to(node, { x: x2, y: y2, rotation: 0, scale: .85, duration: .35, ease: 'power2.inOut' }, .6)
    .call(() => settle(from, to, value, undo), [], .95)
    .to(node, { opacity: 0, scale: .4, duration: .2 }, .95)
    .to(destination, { scale: 1.04, duration: .2, repeat: 1, yoyo: true, ease: 'power2.out' }, .95)
}
function pay(id: string) { void transfer('me', id, selected.value) }
function undo() {
  if (busy.value) return
  const last = records.value.shift()
  if (last) void transfer(last.to, last.from, last.value, true)
}
function reset() {
  if (busy.value) return
  players.forEach((p, index) => p.score = index === 2 ? 112 : 94)
  records.value = []; received.value = false; feedback.value = '点一张牌，试着给球友分'
}
// Finish the simulated transaction when the tab is hidden, rather than leaving a half-played deal.
function visibility() { if (document.hidden && animation) animation.progress(1) }
onMounted(() => document.addEventListener('visibilitychange', visibility))
onBeforeUnmount(() => { clearAnimation(); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <div class="design-preview" :class="{ night }">
    <header class="preview-header"><NuxtLink to="/" aria-label="返回正式追分页面"><span class="brand-ball" aria-hidden="true"><span>9</span></span><b>追分</b></NuxtLink><span>模拟体验</span><NuxtLink to="/" class="return-link">返回正式版 ↗</NuxtLink></header>
    <main class="preview-layout">
      <section class="design-intro">
        <span class="preview-label">换个感觉，打下一杆。</span>
        <h1>{{ night ? '球桌亮着。\n今晚，继续。' : '一桌球友。\n一场好球。' }}</h1>
        <p>{{ night ? '收起多余的光，把注意力留在球桌。\n墨绿桌面、温润金色，收分的那一刻亮起来。' : '清爽的白，熟悉的球桌绿。\n看清自己的比分，轻轻递出下一张牌。' }}</p>
        <div class="theme-switch" role="group" aria-label="选择设计风格"><button :aria-pressed="!night" :class="{ selected: !night }" @click="theme(false)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>清爽球房</button><button :aria-pressed="night" :class="{ selected: night }" @click="theme(true)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>夜场球桌</button></div>
        <div class="desktop-note"><span>亲手试一局</span><p>点分数牌给分，或点击「试试收分」。<br>切换风格会保留比分，方便你比较手感。</p><span class="note-foot">模拟体验，不会影响真实房间。</span></div>
      </section>

      <section class="experience" aria-label="追分交互预览">
        <div class="room-top"><div><span class="room-tag">朋友的球局</span><h2>周末球友局</h2></div><span class="table-mode"><span class="live-dot"/>三人追分</span></div>
        <div class="table-scene">
          <div class="opponents"><div v-for="(player, index) in players.slice(0, 2)" :key="player.id" class="opponent" :data-preview-player="player.id"><div class="opponent-name"><span class="friend-avatar">{{ player.name.slice(1) }}</span><span>{{ player.name }}<small>{{ index === 0 ? '我的上家' : '我的下家' }}</small></span></div><strong>{{ player.score }}<small>分</small></strong></div></div>
          <div class="my-score" data-preview-player="me" :class="{ celebrating: received }"><span class="my-label">我的积分</span><div class="score-display">{{ mine.score }}<small>分</small></div><span class="session-gain">本场 {{ mine.score - 100 >= 0 ? '+' : '' }}{{ mine.score - 100 }}</span><span v-if="received" class="receive-glow" aria-hidden="true" /></div>
          <div class="deal-status" role="status" aria-live="polite">{{ busy ? '这张牌，递给你。' : feedback }}</div>
          <div class="hand-heading"><h3>我来给分</h3><span>选一张牌，再选球友</span></div>
          <div class="hand"><button v-for="(card, index) in values" :key="card.value" class="hand-choice" :disabled="busy" :style="{ '--tilt': `${(index - 1.5) * 4}deg` }" :aria-label="`${card.label}，给 ${card.value} 分`" @click="choose(card.value)"><span class="hand-card"><PreviewPlayingCard :value="card.value" /></span><span class="hand-label">{{ card.label }}<small>{{ card.value }} 分</small></span></button></div>
        </div>
        <div class="activity"><button class="activity-toggle" :aria-expanded="historyOpen" aria-controls="preview-history" @click="historyOpen = !historyOpen"><span>本场记录 <small>{{ records.length }} 笔</small></span><svg viewBox="0 0 24 24" :class="{ expanded: historyOpen }" fill="none" aria-hidden="true"><path d="m8 10 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><p v-if="!historyOpen" class="latest-event">{{ records[0]?.text ?? '还没给过分，试着递出第一张牌。' }}</p><div id="preview-history" class="preview-history" :class="{ expanded: historyOpen }" :inert="!historyOpen" :aria-hidden="!historyOpen"><div><ol v-if="records.length"><li v-for="record in records" :key="record.id"><span>{{ record.text }}</span><b :class="{ incoming: record.to === 'me' }">{{ record.to === 'me' ? '+' : '−' }}{{ record.value }}</b></li></ol><p v-else class="latest-event">每一次给分，都会留在这里。</p><button class="undo-button" :disabled="busy || !records.length" @click="undo">↶ 撤销上一笔</button></div></div></div>
        <div class="try-actions"><button class="receive-button" :disabled="busy" @click="transfer('lin', 'me', 7)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 16v4h14v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>试试收分 <b>+7</b></button><button class="reset-button" :disabled="busy" @click="reset">重置体验</button></div>
        <p class="demo-caption">仅供体验 · 没有真实给分</p>
      </section>
    </main>
    <div ref="flight" class="preview-flight" aria-hidden="true"><PreviewPlayingCard :value="flightValue" /></div>
    <dialog ref="sheet" class="recipient-sheet" aria-labelledby="recipient-title" @close="sheetClosed" @click="($event.target === sheet) && closeSheet()">
      <div class="sheet-content"><span class="sheet-handle" aria-hidden="true"/><button class="sheet-close" aria-label="关闭球友选择" @click="closeSheet">×</button><span class="sheet-eyebrow">从你的积分中给出</span><h2 id="recipient-title">这 {{ selected }} 分，给谁？</h2><p>选好球友，就把牌递过去。</p><div class="recipient-list"><button v-for="player in players.slice(0,2)" :key="player.id" :disabled="busy" @click="pay(player.id)"><span class="friend-avatar">{{ player.name.slice(1) }}</span><span>{{ player.name }}<small>当前 {{ player.score }} 分</small></span><b>给 {{ selected }} 分 ↗</b></button></div></div>
    </dialog>
  </div>
</template>

<style scoped>
.design-preview { --page: #f4f5f4; --surface: #fff; --ink: #202722; --muted: #727a74; --accent: #28654c; --soft: #edf2ee; --rule: #e9ede9; --gold: #d7b76d; min-height: 100dvh; color: var(--ink); background: var(--page); font-family: -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif; transition: background .3s,color .3s; padding: 0 32px 40px; }
.design-preview.night { color-scheme: dark; --page: #202421; --surface: #28352d; --ink: #f4f3eb; --muted: #b0bcb3; --accent: #b8d4be; --soft: #34433a; --rule: #ffffff12; }
.preview-header { max-width: 1120px; height: 88px; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }.preview-header > a:first-child { display: flex; align-items: center; gap: 10px; font-size: 23px; letter-spacing: -1px; }.preview-header > span { color: var(--muted); font-size: 12px; }.return-link { display: flex; align-items: center; min-height: 44px; font-size: 13px; color: var(--accent); }
.preview-layout { max-width: 1060px; margin: 42px auto 0; display: grid; grid-template-columns: 1fr 430px; gap: 100px; align-items: center; }.preview-label { font-size: 14px; color: var(--accent); }.design-intro h1 { font-size: clamp(36px,4.3vw,58px); letter-spacing: -2px; font-weight: 650; line-height: 1.3; white-space: pre-line; margin: 24px 0; }.design-intro > p { font-size: 15px; line-height: 1.9; white-space: pre-line; color: var(--muted); }
.theme-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-radius: 18px; padding: 5px; background: #e7ebe7; max-width: 340px; margin-top: 34px; }.night .theme-switch { background: #151c17; }.theme-switch button { display: flex; align-items: center; justify-content: center; gap: 9px; background: transparent; color: var(--muted); min-height: 48px; border-radius: 14px; font-size: 14px; }.theme-switch button.selected { color: var(--ink); background: var(--surface); box-shadow: 0 2px 8px #00000009; font-weight: 600; }.theme-switch svg { width: 19px; height: 19px; }.desktop-note { margin-top: 50px; }.desktop-note > span:first-child { font-size: 15px; font-weight: 600; }.desktop-note p { font-size: 13px; line-height: 1.9; color: var(--muted); margin: 10px 0 22px; }.note-foot { font-size: 11px; color: var(--muted); }
.experience { background: var(--surface); border-radius: 32px; padding: 26px 24px 20px; box-shadow: 0 24px 70px #21352a09; min-width: 0; }.night .experience { background: linear-gradient(160deg,#2e5743,#253e30 48%,#29382e); box-shadow: 0 24px 80px #00000025; }.room-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 27px; }.room-tag { font-size: 10px; color: var(--muted); }.room-top h2 { font-size: 20px; font-weight: 650; margin-top: 6px; letter-spacing: -.5px; }.table-mode { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }.live-dot { width: 5px; height: 5px; background: var(--accent); border-radius: 50%; }
.opponents { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }.opponent { padding: 10px 12px; border-radius: 14px; background: var(--soft); }.night .opponent { background: #ffffff08; }.opponent-name { display: flex; align-items: center; gap: 9px; font-size: 13px; }.friend-avatar { width: 32px; height: 32px; flex-shrink: 0; display: grid; place-items: center; background: #dce9df; color: #36573f; border-radius: 50%; font-size: 13px; }.night .friend-avatar { background: #d7b76d; color: #3a3525; }.opponent-name small { display: block; color: var(--muted); font-size: 9px; margin-top: 3px; }.opponent strong { display: block; font-size: 32px; font-weight: 550; letter-spacing: -1px; margin: 7px 0 0 41px; font-variant-numeric: tabular-nums; }.opponent strong small { font-size: 10px; font-weight: 400; color: var(--muted); margin-left: 5px; }
.my-score { position: relative; isolation: isolate; text-align: center; padding: 26px 0 12px; border-radius: 30px; }.my-label { font-size: 12px; color: var(--muted); letter-spacing: 1px; }.score-display { font-size: 80px; font-weight: 550; line-height: 1.18; letter-spacing: -5px; font-variant-numeric: tabular-nums; margin-top: 5px; }.score-display small { display: inline-block; width: 0; position: relative; left: 9px; bottom: 7px; font-size: 12px; letter-spacing: 0; font-weight: 400; color: var(--muted); }.session-gain { color: var(--accent); font-size: 12px; }.receive-glow { position: absolute; z-index: -1; inset: 0; border-radius: inherit; background: radial-gradient(ellipse at center,#d7b76d25,transparent 70%); }.celebrating .score-display { color: var(--accent); }.night .celebrating .score-display { color: var(--gold); }
.deal-status { min-height: 31px; text-align: center; font-size: 11px; line-height: 1.6; padding: 4px 0 10px; color: var(--muted); }.hand-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 21px; }.hand-heading h3 { font-size: 14px; font-weight: 600; }.hand-heading > span { font-size: 10px; color: var(--muted); }.hand { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 13px; padding: 0 5px; }.hand-choice { background: transparent; padding: 0; border-radius: 10px; min-width: 0; color: var(--ink); }.hand-card { display: block; width: 100%; aspect-ratio: 70 / 102; transform: rotate(var(--tilt)); transform-origin: center bottom; transition: transform .24s cubic-bezier(.2,.8,.2,1); }.hand-choice:active:not(:disabled) .hand-card { transform: translateY(-10px) rotate(0deg); }.hand-label { display: block; margin-top: 17px; font-size: 12px; font-weight: 550; }.hand-label small { display: block; font-size: 10px; color: var(--muted); font-weight: 400; margin-top: 4px; }
.activity { margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--rule); }.activity-toggle { display: flex; align-items: center; justify-content: space-between; min-height: 44px; width: 100%; padding: 0; color: var(--ink); background: transparent; text-align: left; font-size: 12px; }.activity-toggle small { color: var(--muted); margin-left: 7px; font-size: 10px; }.activity-toggle svg { width: 24px; height: 24px; color: var(--muted); transition: transform .25s; }.activity-toggle svg.expanded { transform: rotate(180deg); }.latest-event { color: var(--muted); font-size: 11px; line-height: 1.7; }.preview-history { display: grid; grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows .25s, visibility .25s; }.preview-history.expanded { grid-template-rows: 1fr; visibility: visible; }.preview-history > div { overflow: hidden; min-height: 0; }.preview-history ol { list-style: none; max-height: 170px; overflow: auto; margin: 0; padding: 0; }.preview-history li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; font-size: 12px; color: var(--muted); }.preview-history li b { color: #b87465; }.preview-history li b.incoming { color: var(--accent); }.undo-button { min-height: 44px; background: transparent; padding: 8px 0; font-size: 12px; color: var(--accent); }
.try-actions { display: flex; align-items: center; gap: 12px; padding-top: 18px; }.receive-button { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; min-height: 50px; border-radius: 16px; background: #28654c; color: white; font-size: 13px; }.receive-button svg { width: 19px; height: 19px; }.receive-button b { font-weight: 500; opacity: .75; }.night .receive-button { background: #d7b76d; color: #2d382c; }.reset-button { min-height: 48px; padding: 8px; background: transparent; color: var(--muted); font-size: 12px; }.demo-caption { text-align: center; color: var(--muted); font-size: 10px; margin-top: 15px; }
.preview-flight { width: 70px; height: 102px; position: fixed; top: 0; left: 0; z-index: 100; opacity: 0; pointer-events: none; will-change: transform; }
.recipient-sheet { border: 0; padding: 0; width: min(420px,calc(100% - 32px)); border-radius: 28px; background: var(--surface); color: var(--ink); box-shadow: 0 24px 80px #00000025; }.recipient-sheet::backdrop { background: #101a1655; backdrop-filter: blur(7px); }.sheet-content { padding: 28px 24px max(28px,env(safe-area-inset-bottom)); position: relative; }.sheet-handle { display: block; width: 32px; height: 4px; margin: -14px auto 26px; border-radius: 9px; background: var(--rule); }.sheet-close { position: absolute; top: 12px; right: 12px; width: 44px; height: 44px; background: transparent; color: var(--muted); border-radius: 50%; font-size: 25px; }.sheet-eyebrow { font-size: 11px; color: var(--muted); }.sheet-content h2 { margin: 10px 0; font-size: 26px; font-weight: 600; letter-spacing: -.5px; }.sheet-content > p { color: var(--muted); font-size: 13px; }.recipient-list { display: grid; gap: 10px; margin-top: 26px; }.recipient-list button { display: flex; align-items: center; gap: 12px; text-align: left; min-height: 76px; padding: 14px; border-radius: 18px; background: var(--soft); color: var(--ink); font-size: 14px; }.recipient-list small { display: block; font-size: 10px; color: var(--muted); margin-top: 5px; }.recipient-list b { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--accent); }
@media (hover:hover) { .hand-choice:hover:not(:disabled) .hand-card { transform: translateY(-9px) rotate(0deg); } }
@media (max-width:850px) { .design-preview { padding: 0 20px 24px; }.preview-header { height: 66px; }.preview-header > span { font-size: 10px; }.preview-header > a:first-child { font-size: 20px; }.preview-header .brand-ball { width: 30px; height: 30px; }.return-link { font-size: 11px; }.preview-layout { display: block; margin: 8px auto 0; max-width: 430px; }.preview-label,.design-intro h1,.design-intro > p,.desktop-note { display: none; }.theme-switch { max-width: none; margin: 8px 0 20px; border-radius: 16px; }.theme-switch button { min-height: 44px; }.experience { padding: 22px 20px 18px; border-radius: 26px; }.room-top { margin-bottom: 20px; }.room-top h2 { font-size: 19px; }.opponents { gap: 18px; }.opponent { padding: 10px; }.my-score { padding-top: 22px; }.score-display { font-size: 76px; }.hand { gap: 12px; }.hand-heading { margin-top: 12px; }.recipient-sheet { margin: auto auto 0; width: 100%; max-width: 500px; border-radius: 28px 28px 0 0; } }
@media (max-width:360px) { .design-preview { padding: 0 12px 20px; }.experience { padding: 20px 16px; }.opponents { gap: 12px; }.opponent-name { gap: 6px; }.opponent strong { margin-left: 0; text-align: center; }.hand { gap: 9px; padding: 0; }.hand-heading > span { font-size: 9px; }.my-score { padding-top: 20px; }.score-display { font-size: 68px; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { transition: none !important; } }
</style>
