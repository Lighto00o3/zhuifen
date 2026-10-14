<script setup lang="ts">
import { DEFAULT_RULES, LABELS, type Rules, type ScoreKind } from '@zhuifen/shared'
import { createLocalGame, giveLocal, undoLocal, loadLocalGames, storeLocalGame, rematchLocal, LOCAL_GAME_KEY, LOCAL_GAMES_KEY, type LocalGame } from '../utils/localGame'
import { CARD_SUITS, pointCards } from '../utils/pointCards'
import { clockTime, formatElapsed } from '../utils/format'
import { randomId } from '../utils/random'
import type { Transfer } from '../components/CardTransfer.vue'

useHead({ title: '单机记分 · 追分' })
const route = useRoute()
const historical = computed(() => typeof route.query.id === 'string')
const fresh = computed(() => route.query.new === '1')
const game = ref<LocalGame | null>(null)
const carry = ref(false)
const ready = ref(false)
const count = ref<2 | 3>(3)
const names = ref(['', '', ''])
const title = ref('')
const initial = ref(100)
const rules = reactive<Rules>({ ...DEFAULT_RULES })
const payer = ref('')
const error = ref('')
const storageError = ref('')
const dialog = ref<HTMLDialogElement | null>(null)
const action = ref<'give' | 'undo' | 'end' | 'new' | null>(null)
useScrollLock(computed(() => !!action.value))
const kind = ref<ScoreKind>('normal')
const transfers = ref<{ enqueue: (t: Transfer) => void } | null>(null)
const last = computed(() => game.value?.events.findLast(e => !e.undoneAt))
const selected = computed(() => game.value?.members.find(p => p.id === payer.value))
const recipients = computed(() => game.value?.members.filter(p => p.id !== payer.value) ?? [])
const elapsed = ref('00:00')
let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  if (game.value) elapsed.value = formatElapsed(game.value.startedAt, game.value.endedAt)
}
function save(next: LocalGame) {
  // Persist before accepting a change, so a storage failure never silently loses a score.
  try { storeLocalGame(localStorage, next) }
  catch { throw new Error('未能保存，这次操作尚未生效。请检查浏览器是否允许存储、空间是否充足后重试。') }
  game.value = next
  storageError.value = ''
  error.value = ''
  tick()
}
function start() {
  try { save(createLocalGame(names.value.slice(0, count.value), title.value, initial.value, rules)); payer.value = game.value!.members[0]!.id; if (fresh.value) void navigateTo('/local') }
  catch (e) { error.value = e instanceof Error ? e.message : '无法保存，请检查浏览器的存储空间。' }
}
function close() { dialog.value?.close(); action.value = null }
async function open(next: NonNullable<typeof action.value>) {
  error.value = ''
  action.value = next
  await nextTick()
  dialog.value?.showModal()
}
function choose(k: ScoreKind) { kind.value = k; void open('give') }
function give(recipientId?: string) {
  if (!game.value) return
  try {
    const next = giveLocal(game.value, payer.value, kind.value, recipientId)
    save(next)
    close()
    animate(next.events.at(-1)!.deltas, false)
  } catch (e) { error.value = e instanceof Error ? e.message : '记分失败，请重试。' }
}
function animate(deltas: Record<string, number>, undo: boolean) {
  const entries = Object.entries(deltas).map(([id, d]) => [id, undo ? -d : d] as const)
  const from = entries.find(([, d]) => d < 0), to = entries.find(([, d]) => d > 0)
  if (from && to) transfers.value?.enqueue({ id: randomId(), from: from[0], to: to[0], fromName: person(from[0]), toName: person(to[0]), points: to[1], undo, suit: CARD_SUITS[kind.value] })
}
function confirm() {
  if (!game.value) return
  try {
    if (action.value === 'undo' && last.value) {
      const event = last.value
      save(undoLocal(game.value)); kind.value = event.kind; animate(event.deltas, true)
    } else if (action.value === 'end') save({ ...game.value, endedAt: new Date().toISOString() })
    else if (action.value === 'new') {
      save(rematchLocal(game.value, carry.value))
      payer.value = game.value!.members[0]!.id
    }
    close()
  } catch { error.value = '保存失败，请检查浏览器的存储空间后重试。' }
}
function person(id: string) { return game.value?.members.find(p => p.id === id)?.name ?? '球友' }
function restore() {
  try {
    const store = loadLocalGames(localStorage)
    const id = historical.value ? route.query.id : store.currentId
    game.value = fresh.value ? null : store.games.find(g => g.id === id) ?? null
    if (historical.value && !game.value) storageError.value = '这场记录未在当前浏览器找到。'
    payer.value = game.value?.members[0]?.id ?? ''
    if (game.value || !historical.value) storageError.value = ''
    tick()
  } catch { storageError.value = '本机记录无法读取。原记录仍保留，请勿清除浏览器数据。' }
}
function storageChanged(e: StorageEvent) { if (e.key === LOCAL_GAME_KEY || e.key === LOCAL_GAMES_KEY) { close(); restore() } }
onMounted(() => { restore(); ready.value = true; timer = setInterval(tick, 1000); window.addEventListener('storage', storageChanged) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('storage', storageChanged) })
</script>

<template>
  <div class="app-shell local-page">
    <CardTransfer ref="transfers" />
    <header class="site-header"><NuxtLink class="brand" to="/"><span class="brand-ball" aria-hidden="true"><span>9</span></span>追分<span class="brand-sub">一台手机，记好一桌</span></NuxtLink><div class="header-actions"><NuxtLink class="text-button" to="/history">历史对局</NuxtLink><ThemeToggle /></div></header>
    <main class="room-page">
      <div class="room-toolbar"><NuxtLink class="secondary home-button" to="/">← 返回首页</NuxtLink><button v-if="game && !game.endedAt && !historical" class="danger-button" @click="open('end')">结束本场</button></div>
      <p v-if="storageError" class="error" role="alert">{{ storageError }}</p>
      <p v-if="error && !action" class="error" role="alert">{{ error }}</p>
      <p v-if="!ready" class="muted">正在读取本机记录…</p>
      <section v-else-if="!game && !historical" class="entry-card local-setup">
        <div class="card-heading"><h1>一台手机，<br />也能开一桌。</h1><p>按出杆顺序填写昵称，记分时切换给分的人。</p></div>
        <form @submit.prevent="start">
          <div class="field"><span>追分人数</span><div class="mode-picker"><button v-for="n in ([2, 3] as const)" :key="n" type="button" :class="{ active: count === n }" :aria-pressed="count === n" @click="count = n">{{ n === 2 ? '双人追分' : '三人追分' }}</button></div></div>
          <label v-for="n in count" :key="n" class="field">第 {{ n }} 位球友<input v-model="names[n - 1]" :placeholder="`球友 ${n} 的昵称`" maxlength="12" required /></label>
          <label class="field">本场名称（选填）<input v-model="title" placeholder="例如：周末练球" maxlength="24" /></label>
          <label class="field">每人初始积分<input v-model.number="initial" type="number" min="1" max="10000" required /></label>
          <div class="settings-grid"><label v-for="(label, k) in LABELS" :key="k" class="field">{{ label }}{{ k === 'dajin' || k === 'golden9' ? '（每位输家）' : '' }}<input v-model.number="rules[k]" type="number" min="1" max="100" required /></label></div>
          <button class="primary full" type="submit">开始单机记分</button>
        </form>
        <p class="entry-foot">记录只保存在当前浏览器，返回或刷新后可继续。</p>
      </section>
      <template v-else-if="game">
        <div class="room-heading"><div><p v-if="game.name" class="room-name">{{ game.name }}</p><h1>{{ game.endedAt ? '这一场，收杆了' : '一台手机，全桌记分' }}</h1><p class="room-meta"><span>{{ game.members.length === 2 ? '双人追分' : '三人追分' }}</span><span>单机模式</span><span class="room-progress"><span>{{ game.events.filter(e => !e.undoneAt).length }} 笔记分</span><span>·</span><span class="room-timer">{{ elapsed }}</span></span></p></div></div>
        <div class="room-layout">
          <section class="score-section">
            <div class="section-label"><h2>同桌比分</h2><span>按出杆顺序排列</span></div>
            <div class="players" :class="{ duel: game.members.length === 2 }">
              <article v-for="(p, index) in game.members" :key="p.id" :data-player-id="p.id" class="player-card" :class="{ mine: !game.endedAt && p.id === payer }"><div class="player-top"><span class="avatar" :class="`color-${index}`">{{ p.name.slice(0, 1) }}</span><div><h3>{{ p.name }}</h3><span class="presence">第 {{ index + 1 }} 位出杆</span></div></div><div class="score-number" :class="{ compact: String(p.score).length > 4 }">{{ p.score }}<span>分</span></div><div class="player-bottom"><span :class="{ positive: p.score > (game.startingScores?.[p.id] ?? game.initialScore), negative: p.score < (game.startingScores?.[p.id] ?? game.initialScore) }">本场 {{ p.score > (game.startingScores?.[p.id] ?? game.initialScore) ? '+' : '' }}{{ p.score - (game.startingScores?.[p.id] ?? game.initialScore) }}</span></div></article>
            </div>
            <section v-if="!game.endedAt && !historical" class="action-panel">
              <div class="section-label"><h2>谁来给分？</h2><span>先选输家，再点牌</span></div>
              <div class="local-payers" role="group" aria-label="选择给分的人"><button v-for="p in game.members" :key="p.id" :class="{ active: payer === p.id }" :aria-pressed="payer === p.id" @click="payer = p.id">{{ p.name }}</button></div>
              <div class="score-actions"><button v-for="(label, k, index) in LABELS" :key="k" :class="['score-action', k]" :style="{ '--card-tilt': `${(index - 2) * 3}deg` }" :aria-label="`${selected?.name}给${label} ${game.rules[k]} 分`" @click="choose(k)"><span class="score-card-stack" aria-hidden="true"><span v-for="(card, i) in pointCards(game.rules[k]).slice(0, 3)" :key="i" class="score-card-face" :style="{ '--stack-offset': `${i * 3}px`, zIndex: 3 - i }"><PlayingCard :value="card.value" :face="card.rank" :suit="CARD_SUITS[k]" /></span></span><span class="score-card-label">{{ label }}</span><span class="score-card-amount">−{{ game.rules[k] }} 分</span></button></div>
              <p class="card-rule-note">{{ game.members.length === 3 ? `犯规给上家；大金每位输家给 ${game.rules.dajin} 分，黄金9每位输家给 ${game.rules.golden9} 分，请分别记两笔。` : '犯规给对手；其他牌按赢家的得分支付一份。' }}</p>
              <div class="action-footer"><span>当前给分：{{ selected?.name }}</span><button class="text-button" :disabled="!last" @click="open('undo')">↶ 撤销上一笔</button></div>
            </section>
            <section v-else class="finished-panel"><h2>本场比分已保存</h2><p>比分与记录已收入历史对局。</p><button v-if="!historical" class="primary" @click="carry = false; open('new')">再开一局</button><NuxtLink class="secondary" to="/history">历史对局</NuxtLink><ShareScore :game="game" /><NuxtLink v-if="!historical" class="text-button" to="/local?new=1">换球友，开新桌</NuxtLink></section>
            <div class="room-summary"><span>全桌总分 <b>{{ game.members.reduce((sum, p) => sum + p.score, 0) }}</b> · {{ game.startingScores ? '沿用上一场积分' : `每人初始 ${game.initialScore}` }}</span></div>
            <p class="local-save-note">已保存在本机 · 不与其他手机同步<br />清除浏览器数据会删除记录，请使用同一浏览器继续。</p>
          </section>
          <aside class="history-panel"><div class="section-label"><h2>本场记录</h2><span>{{ game.events.length }} 笔</span></div><div v-if="!game.events.length" class="empty-history"><h3>从第一笔给分开始</h3><p>选择输家和分值，比分会自动更新。</p></div><ol v-else class="event-list"><li v-for="event in [...game.events].reverse()" :key="event.id" :class="{ undone: event.undoneAt }"><div class="event-heading"><b>{{ person(event.actorId) }} · {{ event.label }}</b><time>{{ clockTime(event.createdAt) }}</time></div><div class="event-deltas"><span v-for="(delta, id) in event.deltas" v-show="delta !== 0" :key="id">{{ person(String(id)) }} <b :class="delta > 0 ? 'positive' : 'negative'">{{ delta > 0 ? '+' : '' }}{{ delta }}</b></span></div><span v-if="event.undoneAt" class="undo-label">已撤销</span></li></ol></aside>
        </div>
      </template>
    </main>
    <dialog ref="dialog" class="modal local-dialog" aria-labelledby="local-dialog-title" @cancel.prevent="close" @click="($event.target === dialog) && close()">
      <div v-if="action && game" class="local-dialog-content">
        <button class="close-modal" aria-label="关闭弹窗" @click="close">×</button>
        <h2 id="local-dialog-title">{{ action === 'give' ? `${selected?.name}给${LABELS[kind]}` : action === 'undo' ? '撤销上一笔记分？' : action === 'end' ? '结束这场追分？' : '开始新一局？' }}</h2>
        <template v-if="action === 'give'"><p>扣 {{ selected?.name }} {{ game.rules[kind] }} 分，给收分的球友。</p><div class="recipient-actions"><button v-if="kind === 'foul'" class="primary full" @click="give()">给 {{ game.members[(game.members.findIndex(p => p.id === payer) + game.members.length - 1) % game.members.length]?.name }} {{ game.rules[kind] }} 分</button><template v-else><button v-for="p in recipients" :key="p.id" class="primary full" @click="give(p.id)">给 {{ p.name }} {{ game.rules[kind] }} 分</button></template></div></template>
        <template v-else><p>{{ action === 'undo' ? '还原上一笔给分，记录会标记为已撤销。' : action === 'end' ? '结束后可以查看比分和记录，不能继续给分。' : '沿用球友、座位和规则，上一场记录会保留。' }}</p><div v-if="action === 'new'" class="rematch-options"><button class="secondary full" :aria-pressed="!carry" @click="carry = false">重置积分 · 每人 {{ game.initialScore }} 分</button><button class="secondary full" :aria-pressed="carry" @click="carry = true">接着上一场的积分</button></div><div class="confirm-actions"><button class="secondary" @click="close">再想想</button><button class="primary" @click="confirm">{{ action === 'undo' ? '确认撤销' : action === 'end' ? '确认结束' : '开始下一局' }}</button></div></template>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.local-setup { max-width: 560px; margin: 0 auto; }
.local-setup h1 { font-size: 32px; line-height: 1.25; margin: 0 0 14px; }
.local-payers { display: flex; gap: 8px; margin: 0 0 24px; }
.local-payers button { flex: 1; min-width: 0; min-height: 48px; padding: 10px 8px; background: var(--control); color: var(--ink); border-radius: 14px; overflow-wrap: anywhere; }
.local-payers button.active { background: var(--primary); color: var(--primary-ink); }
.local-save-note { color: var(--muted); text-align: center; font-size: 12px; line-height: 1.8; }
.local-dialog { position: fixed; inset: 0; margin: auto; border: 0; color: var(--ink); max-height: calc(100dvh - 32px); }
.local-dialog::backdrop { background: #0007; backdrop-filter: blur(8px); }
.local-dialog-content { text-align: left; }
.local-dialog-content h2 { padding-right: 24px; }
@media(max-width: 760px) { .local-dialog { inset: auto 0 0; margin: 0; max-height: calc(100dvh - 24px); width: 100%; max-width: 100%; border-radius: 24px 24px 0 0; } }
</style>
