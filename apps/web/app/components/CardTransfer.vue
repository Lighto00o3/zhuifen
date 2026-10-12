<script setup lang="ts">
import { gsap } from 'gsap'
import { pointCards } from '../utils/pointCards'

export interface Transfer {
  id: string; from: string; to: string; fromName: string; toName: string
  points: number; mine?: string; undo: boolean
}
const active = ref<Transfer | null>(null)
const layer = ref<HTMLElement | null>(null)
const cards = computed(() => pointCards(active.value?.points ?? 0))
const message = computed(() => {
  const t = active.value
  if (!t) return ''
  const action = t.undo ? '退回' : '给'
  return t.to === t.mine ? `${t.fromName}${t.undo ? '退回给你' : '给你'} ${t.points} 分` : `${t.from === t.mine ? '你' : t.fromName}${action} ${t.toName} ${t.points} 分`
})
const queue: Transfer[] = []
let timeline: gsap.core.Timeline | undefined
let disposed = false
let generation = 0
function anchor(id: string) {
  const el = Array.from(document.querySelectorAll<HTMLElement>('[data-player-id]')).find(node => node.dataset.playerId === id)
  const rect = el?.getBoundingClientRect()
  return { el, x: Math.max(48, Math.min(window.innerWidth - 48, rect ? rect.x + rect.width / 2 : window.innerWidth / 2)), y: Math.max(150, Math.min(window.innerHeight - 180, rect ? rect.y + rect.height * .7 : window.innerHeight * .4)) }
}
function reset() {
  generation++
  timeline?.revert()
  timeline = undefined
  queue.length = 0
  active.value = null
}
async function play() {
  if (disposed || active.value || !queue.length || document.hidden) return
  const version = generation
  active.value = queue.shift()!
  await nextTick()
  if (disposed || version !== generation || !active.value || !layer.value) return
  const t = active.value
  const from = anchor(t.from), to = anchor(t.to)
  const nodes = layer.value.querySelectorAll('.transfer-card')
  const caption = layer.value.querySelector('.transfer-caption')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  timeline = gsap.timeline({ onComplete: () => {
    timeline?.revert(); timeline = undefined
    active.value = null
    void nextTick().then(play)
  } })
  timeline.fromTo(caption, { opacity: 0, y: reduced ? 0 : 12 }, { opacity: 1, y: 0, duration: .2 })
  if (!reduced) {
    nodes.forEach((node, index) => {
      const offset = (index - (nodes.length - 1) / 2) * 13
      const at = .12 + index * .065
      timeline!.fromTo(node, { x: from.x - 36 + offset, y: from.y - 50, rotation: -12 + index * 5, rotationY: -65, scale: .55, opacity: 0 }, { opacity: 1, scale: 1, rotationY: 0, y: from.y - 115, duration: .26, ease: 'power2.out' }, at)
        .to(node, { x: (from.x + to.x) / 2 - 36 + offset, y: Math.min(from.y, to.y) - 135, rotation: 8 + index * 3, duration: .3, ease: 'power1.out' }, at + .26)
        .to(node, { x: to.x - 36 + offset, y: to.y - 50, rotation: index * 4, scale: .8, duration: .36, ease: 'power2.inOut' }, at + .56)
        .to(node, { opacity: 0, scale: .4, y: to.y - 30, duration: .22 }, at + .92)
    })
    if (from.el) timeline.to(from.el, { scale: .97, duration: .16, yoyo: true, repeat: 1 }, .15)
    if (to.el) timeline.to(to.el, { scale: 1.035, boxShadow: '0 0 0 4px rgba(192,138,48,.14)', duration: .22, yoyo: true, repeat: 1 }, 1)
  }
  timeline.to(caption, { opacity: 0, y: reduced ? 0 : -8, duration: .25 }, reduced ? 1.5 : 2)
}
function enqueue(t: Transfer) {
  if (disposed || document.hidden) return
  if (t.undo) reset()
  // Reconnect bursts should never leave minutes of stale animations queued.
  if (queue.length >= 5) queue.shift()
  queue.push(t)
  void play()
}
function visibility() { if (document.hidden) reset() }
onMounted(() => document.addEventListener('visibilitychange', visibility))
onBeforeUnmount(() => { disposed = true; reset(); document.removeEventListener('visibilitychange', visibility) })
defineExpose({ enqueue })
</script>

<template>
  <Teleport to="body">
    <div ref="layer" class="transfer-layer" aria-live="polite" role="status" aria-atomic="true">
      <template v-if="active">
        <div v-for="(card, index) in cards" :key="`${active.id}-${index}`" class="transfer-card" aria-hidden="true">
          <span class="card-corner">{{ card.rank }}<small>♦</small></span>
          <span class="card-suit">♦</span>
          <span class="card-corner card-corner-bottom">{{ card.rank }}<small>♦</small></span>
          <span class="card-value">{{ card.value }} 分</span>
        </div>
        <div class="transfer-caption" :class="{ received: active.to === active.mine, paid: active.from === active.mine }">
          <span class="transfer-amount">{{ active.to === active.mine ? '+' : active.from === active.mine ? '−' : '' }}{{ active.points }}<small>分</small></span>
          <span>{{ message }}<small>{{ active.undo ? '已撤销上一笔' : active.to === active.mine ? '好球，收下了' : active.from === active.mine ? '给到位了，下一杆继续' : '这一笔，已记好' }}</small></span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.transfer-layer { position: fixed; inset: 0; z-index: 80; pointer-events: none; overflow: hidden; perspective: 900px; }
.transfer-card { position: absolute; left: 0; top: 0; width: 72px; height: 104px; border-radius: 9px; background: linear-gradient(125deg, #fff, #faf9f6); color: #b54c48; box-shadow: 0 12px 25px #1d1d1f28, inset 0 0 0 1px #1d1d1f08; opacity: 0; will-change: transform, opacity; }
.card-corner { position: absolute; top: 7px; left: 8px; font: 700 19px/1 Georgia, serif; text-align: center; }.card-corner small { display: block; font-size: 12px; margin-top: 2px; }.card-corner-bottom { top: auto; left: auto; bottom: 7px; right: 8px; transform: rotate(180deg); }.card-suit { position: absolute; inset: 25px 0 auto; text-align: center; font-size: 37px; }.card-value { position: absolute; top: 68px; width: 100%; text-align: center; font-size: 10px; color: #8a7770; }
.transfer-caption { position: absolute; bottom: max(28px, env(safe-area-inset-bottom)); left: 50%; translate: -50% 0; width: max-content; max-width: calc(100% - 32px); display: flex; align-items: center; gap: 16px; padding: 18px 24px; border-radius: 24px; background: var(--feedback, #ffffffed); backdrop-filter: blur(18px); box-shadow: 0 12px 50px #1d1d1f20; color: var(--ink, #1d1d1f); font-size: 14px; font-weight: 600; opacity: 0; }
.transfer-caption small { display: block; font-size: 11px; color: var(--muted, #737377); margin-top: 5px; font-weight: 400; }.transfer-amount { font-size: 36px; font-weight: 700; letter-spacing: -1.5px; white-space: nowrap; }.transfer-amount small { display: inline; margin-left: 4px; letter-spacing: 0; }.received .transfer-amount { color: var(--positive, #23745e); }.paid .transfer-amount { color: var(--negative, #b54c48); }
@media (prefers-reduced-motion: reduce) { .transfer-card { display: none; } }
</style>
