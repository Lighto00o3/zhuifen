<script setup lang="ts">
import { CARD_SUITS, pointCards } from '../utils/pointCards'
import { formatElapsed } from '../utils/format'
import { headline, resultStats } from '../utils/result'
import { randomHex, randomId } from '../utils/random'
import { WAKE_TIMEOUT } from '../utils/api'
import { DEFAULT_RULES, LABELS, type PlayerCount, type PublicRoom, type Rules, type ScoreKind, type Session } from '@zhuifen/shared'
import type { Transfer } from './CardTransfer.vue'
import type { ScoreNotice } from '../utils/roomChanges'
import type { ConfirmAction } from './ConfirmDialog.vue'

const route = useRoute()
const { slow: waking, track } = useSlowHint()
const transfers = ref<{ enqueue: (transfer: Transfer) => void } | null>(null)
const notices = ref<{ push: (notice: ScoreNotice) => void } | null>(null)
const {
  room, session, saved, busy, connected, error, pending, isHost, lastEvent, canUndo, previous, activeEvents, capacity,
  api, loadSaved, refreshRecent, enter: enterRoom, resume: resumeRoom, disconnect, command, retry,
} = useRoom({
  onChanges(changes) {
    changes.transfers.forEach(t => transfers.value?.enqueue(t))
    changes.notices.forEach(n => notices.value?.push(n))
  },
  // 等待开局时同步房间设置；房主正在编辑设置时不覆盖他填的内容。
  onState(state) { if (state.status === 'waiting' && !(settingsOpen.value && isHost.value)) restoreSettings() },
})

const nickname = ref('')
const roomName = ref('')
const roomCode = ref('')
const tab = ref<'create' | 'join'>('create')
const initialScore = ref(100)
const playerCount = ref<PlayerCount>(3)
const rules = reactive<Rules>({ ...DEFAULT_RULES })
const settingsOpen = ref(false)
const elapsed = ref('00:00')
const giving = ref<ScoreKind | null>(null)
const confirmation = ref<ConfirmAction | null>(null)
const carry = ref(false)
const modalOpen = computed(() => settingsOpen.value || !!giving.value || !!confirmation.value)
useModalFocus(modalOpen, () => { closeSettings(); giving.value = null; confirmation.value = null })
watch(() => room.value?.status, status => { if (status !== 'playing') giving.value = null; if (status !== 'waiting') closeSettings() })
let timer: ReturnType<typeof setInterval> | undefined
let joining: { code: string; name: string; token: string; requestId: string } | undefined

const totalScore = computed(() => room.value?.members.reduce((sum, p) => sum + p.score, 0) ?? 0)
const modeLabel = computed(() => capacity.value === 2 ? '双人追分' : '三人追分')
const STATUS_TEXT = { waiting: '等球友上桌', playing: '这一桌，正在追分', ended: '这一场，收杆了', closed: '房间已关闭' } as const
// 结束后的结算信息：一句话结论 + 笔数、用时
const finished = computed(() => room.value?.status === 'ended' && room.value.startedAt
  ? { id: room.value.roundId ?? room.value.startedAt, name: room.value.roomName ?? '', initialScore: room.value.initialScore, startingScores: room.value.startingScores, rules: room.value.rules, members: room.value.members, events: room.value.events, startedAt: room.value.startedAt, endedAt: room.value.endedAt }
  : undefined)
function delta(player: { id: string; score: number }) { return player.score - (room.value?.startingScores?.[player.id] ?? room.value?.initialScore ?? 0) }
const scoreCards = computed(() => Object.fromEntries(Object.keys(LABELS).map(kind => [kind, pointCards(scoreValue(kind as ScoreKind))])) as Record<ScoreKind, ReturnType<typeof pointCards>>)
function scoreValue(kind: ScoreKind) {
  if (!room.value) return 0
  return room.value.rules[kind]
}
function scoreHint(kind: ScoreKind) {
  if (!room.value) return ''
  const value = room.value.rules[kind]
  if (capacity.value === 2) return `给对手 ${value} 分`
  if (kind === 'golden9' || kind === 'dajin') return `每人给 ${value} 分，共 ${value * 2} 分`
  return '选择收分的球友'
}

async function enter() {
  if (tab.value === 'join' && !/^\d{6}$/.test(roomCode.value)) { error.value = '请输入 6 位房间号'; return }
  busy.value = true; error.value = ''
  try {
    let result: { room: PublicRoom; session: Session }
    if (tab.value === 'create') result = await track(() => api('/rooms', { name: nickname.value, roomName: roomName.value, playerCount: playerCount.value, initialScore: initialScore.value, rules }, { timeout: WAKE_TIMEOUT }))
    else {
      if (!joining || joining.code !== roomCode.value || joining.name !== nickname.value.trim()) {
        joining = { code: roomCode.value, name: nickname.value.trim(), token: randomHex(32), requestId: randomId() }
      }
      result = await track(() => api(`/rooms/${roomCode.value}/join`, joining, { timeout: WAKE_TIMEOUT }))
    }
    enterRoom(result)
    await navigateTo({ path: '/room', query: { room: result.session.code } })
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function resume(value: Session) {
  busy.value = true
  try { if (await track(() => resumeRoom(value))) await navigateTo({ path: '/room', query: { room: value.code } }) }
  finally { busy.value = false }
}
// 双人局直接给对手；三人局打球顺序会变，包括犯规在内每一笔都让玩家选收分的球友。
async function give(kind: ScoreKind) {
  if (capacity.value === 2) await command({ type: 'score', kind, recipientId: previous.value?.id })
  else giving.value = kind
}
async function giveTo(recipientId: string) {
  const kind = giving.value
  giving.value = null
  if (kind) await command({ type: 'score', kind, recipientId })
}
function restoreSettings() {
  if (!room.value) return
  roomName.value = room.value.roomName ?? ''
  initialScore.value = room.value.initialScore
  Object.assign(rules, room.value.rules)
}
function openSettings() {
  if (room.value?.status !== 'waiting') return
  restoreSettings()
  settingsOpen.value = true
}
function closeSettings() {
  settingsOpen.value = false
  restoreSettings()
}
async function configure() {
  if (!isHost.value || room.value?.status !== 'waiting' || busy.value || !connected.value || pending.value) return
  await command({ type: 'configure', roomName: roomName.value, initialScore: initialScore.value, rules: { ...rules }, order: room.value!.members.map(p => p.id) })
  if (!error.value && !pending.value) closeSettings()
}
function back() {
  if (busy.value || pending.value) return
  disconnect()
  void navigateTo('/')
}
async function confirmAction() {
  const action = confirmation.value; confirmation.value = null
  if (action === 'close') await command({ type: 'close' })
  else if (action === 'end') await command({ type: 'end' })
  else if (action === 'restart') await command({ type: 'restart', carry: carry.value })
  else if (action === 'undo' && lastEvent.value) await command({ type: 'undo', eventId: lastEvent.value.id })
}
onMounted(() => {
  // 免费实例闲置后会休眠：一打开页面就先唤醒服务，填昵称的这段时间里它就在启动了。
  void api('/health', undefined, { timeout: WAKE_TIMEOUT }).catch(() => {})
  loadSaved()
  const code = typeof route.query.room === 'string' ? route.query.room : undefined
  if (!code) void refreshRecent()
  if (code && /^\d{6}$/.test(code)) {
    roomCode.value = code; tab.value = 'join'
    const existing = saved.value.find(s => s.code === code)
    if (existing) void resume(existing)
  }
  timer = setInterval(() => {
    elapsed.value = formatElapsed(room.value?.startedAt, room.value?.endedAt)
  }, 1000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="app-shell">
    <CardTransfer ref="transfers" />
    <ScoreNotices ref="notices" />
    <header class="site-header" :inert="modalOpen">
      <a class="brand" href="/" @click.prevent="back"><span class="brand-ball" aria-hidden="true"><span>9</span></span>追分<span class="brand-sub">球友的共享记分牌</span></a>
      <div class="header-actions"><span v-if="room" class="connection" :class="{ offline: !connected }"><i />{{ connected ? '实时同步中' : '正在重新连接' }}</span>
      <span v-else class="header-note">双人 / 三人追分</span><ThemeToggle /></div>
    </header>

    <main v-if="!room" class="landing" :inert="modalOpen">
      <section class="intro">
        <h1>开一桌，<br />一起追分。</h1>
        <p class="intro-copy">输的人给分，整桌一起看。<br />多人联机，或用一台手机记全桌。</p>
        <div class="table-visual" aria-hidden="true"><div class="felt"><span class="pocket p1" /><span class="pocket p2" /><span class="pocket p3" /><span class="pocket p4" /><span class="cue-ball" /><span class="nine-ball"><span>9</span></span><span class="one-ball"><span>1</span></span><span class="shot-line" /></div></div>
        <div class="benefits"><span>不用注册</span><span>扫码同桌</span><span>实时给分</span></div>
      </section>
      <section class="entry-card">
        <div class="card-heading"><h2>和球友开一局</h2><p>各自用手机，同步一场追分。</p></div>
        <div class="tabs"><button :aria-pressed="tab === 'create'" :class="{ active: tab === 'create' }" @click="tab = 'create'; error = ''">创建房间</button><button :aria-pressed="tab === 'join'" :class="{ active: tab === 'join' }" @click="tab = 'join'; error = ''">加入房间</button></div>
        <form @submit.prevent="enter">
          <label class="field">你的昵称（选填）<input v-model="nickname" maxlength="12" placeholder="不填就叫「球友甲 / 乙 / 丙」" autocomplete="nickname" /></label>
          <label v-if="tab === 'join'" class="field">房间号<input v-model="roomCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="输入球友的 6 位房间号" required /></label>
          <template v-else>
            <label class="field">房间名（选填）<input v-model="roomName" maxlength="24" placeholder="例如：周末球友局，留空也可以" /></label>
            <div class="field"><span id="player-count-label">追分人数</span><div class="mode-picker" role="group" aria-labelledby="player-count-label"><button type="button" :aria-pressed="playerCount === 2" :class="{ active: playerCount === 2 }" @click="playerCount = 2">双人追分</button><button type="button" :aria-pressed="playerCount === 3" :class="{ active: playerCount === 3 }" @click="playerCount = 3">三人追分</button></div></div>
            <DisclosurePanel class="entry-settings"><template #title>初始积分 <b>{{ initialScore }} 分</b></template><label class="field">每人初始积分<div class="input-unit"><input v-model.number="initialScore" type="number" min="1" max="10000" required /><span>分</span></div></label><p>其他分值可在球友到齐前由房主设置，到齐后自动开局。</p></DisclosurePanel>
          </template>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button class="primary full" :disabled="busy" type="submit">{{ busy ? '正在准备…' : tab === 'create' ? '创建房间，邀请球友' : '加入这一桌' }}</button>
          <p v-if="waking" class="muted wake-hint" role="status">服务正在启动，第一次打开可能需要半分钟左右，请稍候。</p>
        </form>
        <NuxtLink class="local-mode-entry" to="/local"><span><b>只有一台手机？</b><small>用单机记分，一台手机记全桌</small></span><span aria-hidden="true">›</span></NuxtLink>
        <div class="entry-links"><NuxtLink class="text-button" to="/history">历史对局</NuxtLink></div>
        <div v-if="saved.length" class="recent"><span>最近的房间</span><button v-for="s in saved.slice(0, 3)" :key="s.code" :disabled="busy" @click="resume(s)"><span class="recent-room"><b v-if="s.roomName">{{ s.roomName }}</b><span class="recent-code"># {{ s.code }}</span></span><span aria-hidden="true">›</span></button></div>
        <ClientOnly><InstallHint /></ClientOnly>
      </section>
    </main>

    <main v-else class="room-page" :inert="modalOpen">
      <div class="room-toolbar">
        <button class="pill home-button" :disabled="busy || !!pending" @click="back"><span aria-hidden="true">‹</span>首页</button>
        <span class="spacer" />
        <NuxtLink class="pill" to="/history">历史对局</NuxtLink><button v-if="isHost && (room.status === 'waiting' || room.status === 'playing')" class="pill danger-button" :disabled="busy || !connected || !!pending" @click="confirmation = room.status === 'waiting' ? 'close' : 'end'">{{ room.status === 'waiting' ? '关闭房间' : '结束本场' }}</button>
      </div>
      <div class="room-heading"><div>
        <p class="room-status" :class="{ ended: room.status === 'ended' || room.status === 'closed' }">{{ room.roomName ? STATUS_TEXT[room.status] : modeLabel }}</p>
        <h1>{{ room.roomName || STATUS_TEXT[room.status] }}</h1>
        <p class="room-meta"><span v-if="room.roomName">{{ modeLabel }}</span><span>房间 <b>#{{ room.code }}</b></span><template v-if="room.status === 'waiting'"><span>{{ room.members.length }} / {{ capacity }} 人已加入</span></template><template v-else><span>{{ activeEvents.length }} 笔记分</span><span class="room-timer">{{ elapsed }}</span></template></p>
      </div></div>
      <div v-if="!connected" class="banner">连接恢复后会自动更新比分，暂时无法记分。</div>
      <div v-if="error" class="error" role="alert">{{ error }} <button v-if="pending" :disabled="busy || !connected" @click="retry">重试这笔操作</button></div>
      <div class="room-layout">
        <section class="score-section">
          <div class="players" :class="{ duel: capacity === 2 }">
            <article v-for="(player, index) in room.members" :key="player.id" :data-player-id="player.id" class="player-card" :class="{ mine: player.id === session?.playerId }">
              <div class="player-top"><span class="avatar" :class="`color-${index}`">{{ player.name.slice(0, 1) }}</span><div><h3>{{ player.name }}<span v-if="player.id === session?.playerId" class="you">我</span></h3><span class="presence" :class="{ online: player.online }"><i />{{ player.online ? '在线' : '离线' }}<span v-if="player.id === room.hostId"> · 房主</span></span></div></div>
              <div class="score-number" :class="{ compact: String(player.score).length > 4 }">{{ player.score }}<span>分</span></div>
              <div class="player-bottom"><span class="delta-chip" :class="{ positive: delta(player) > 0, negative: delta(player) < 0 }">本场 {{ delta(player) > 0 ? '+' : '' }}{{ delta(player) }}</span></div>
            </article>
            <template v-if="room.status === 'waiting'"><div v-for="n in capacity - room.members.length" :key="`empty-${n}`" class="player-card empty-seat"><span class="empty-icon" aria-hidden="true">＋</span><span class="empty-seat-title">等球友加入</span><span class="empty-seat-copy">扫码就能上桌</span></div></template>
          </div>

          <section v-if="room.status === 'playing'" class="action-panel">
            <div class="section-label"><h2>我来给分</h2><span>{{ capacity === 2 ? '点一张牌，给对手分' : '点一张牌，再选给谁' }}</span></div>
            <div class="score-actions">
              <button v-for="(label, kind, index) in LABELS" :key="kind" :class="['score-action', kind]" :style="{ '--card-tilt': `${(index - 2) * 3}deg` }" :aria-label="`${kind === 'foul' ? label : `给${label}`}，${scoreValue(kind)} 分，${scoreHint(kind)}`" :disabled="busy || !connected || !!pending" @click="give(kind)">
                <span class="score-card-stack" aria-hidden="true">
                  <span v-for="(card, cardIndex) in scoreCards[kind].slice(0, 3)" :key="cardIndex" class="score-card-face" :style="{ '--stack-offset': `${cardIndex * 3}px`, zIndex: 3 - cardIndex }"><PlayingCard :value="card.value" :face="card.rank" :suit="CARD_SUITS[kind]" /></span>
                </span>
                <span class="score-card-label">{{ label }}</span>
                <span class="score-card-amount">−{{ scoreValue(kind) }} 分<span v-if="scoreCards[kind].length > 1"> · {{ scoreCards[kind].length }} 张</span></span>
              </button>
            </div>
            <p class="card-rule-note">{{ capacity === 2 ? '犯规直接给对手，其他牌按赢家的得分支付。' : `每笔都要选收分的球友；大金每人给 ${room.rules.dajin} 分，黄金9每人给 ${room.rules.golden9} 分（共 ${room.rules.golden9 * 2} 分）。` }}</p>
            <div class="action-footer"><span>全桌总分 {{ totalScore }} · 每人初始 {{ room.initialScore }}</span><button class="text-button" :disabled="!canUndo || busy || !connected || !!pending" @click="confirmation = 'undo'">↶ 撤销上一笔</button></div>
          </section>

          <!-- 人到齐会自动开局；只有升级前就已经坐满、还在等房主开局的房间才会走到这里 -->
          <section v-if="room.status === 'waiting' && room.members.length === capacity" class="lobby-ready"><p>球友到齐了。</p><button v-if="isHost" class="primary full" type="button" :disabled="busy || !connected || !!pending" @click="command({ type: 'start' })">开始追分</button><p v-else class="muted">由房主开始追分。</p></section>
          <button v-if="room.status === 'waiting'" class="settings-entry" type="button" aria-haspopup="dialog" @click="openSettings"><span class="settings-entry-title"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="7" y="4" width="4" height="6" rx="2" fill="currentColor"/><rect x="14" y="14" width="4" height="6" rx="2" fill="currentColor"/></svg>分值与初始积分</span><span>{{ isHost ? '修改' : '查看' }} ›</span></button>

          <section v-if="room.status === 'closed'" class="finished-panel"><span class="eyebrow">房主已关闭房间</span><h2>下次约球，再开一桌。</h2><p>这个房间无法再加入或开始追分。</p><div class="finished-actions"><button class="primary" @click="back">回首页，再开一桌</button></div></section>
          <section v-if="finished" class="finished-panel">
            <span class="eyebrow">本场结束</span><h2>{{ headline(finished) }}</h2>
            <p>共 {{ resultStats(finished).count }} 笔记分，用时 {{ resultStats(finished).duration }}。比分已保存，每个人都能回到房间查看。</p>
            <div class="finished-actions">
              <button v-if="isHost" class="primary" :disabled="busy || !connected || !!pending" @click="carry = false; confirmation = 'restart'">再开一局</button>
              <ShareScore :game="finished" :primary="!isHost" />
              <p v-if="!isHost" class="muted">等房主发起下一局，大家会自动进入。</p>
            </div>
          </section>
          <div v-if="room.status !== 'playing'" class="room-summary"><span>全桌总分 <b>{{ totalScore }}</b> · {{ room.startingScores ? '按本局开局积分计算输赢' : `每人初始 ${room.initialScore}` }}</span></div>
        </section>

        <!-- 等人的时候右侧（手机上是最上面）放邀请二维码；开局后换成记分记录 -->
        <InvitePanel v-if="room.status === 'waiting' && room.members.length < capacity" class="invite-first" :code="room.code" :missing="capacity - room.members.length" :capacity="capacity" />
        <aside v-else class="history-panel"><div class="section-label"><h2>本场记录</h2><span>{{ room.events.length }} 笔</span></div><div v-if="!room.events.length" class="empty-history"><span aria-hidden="true">✎</span><h3>还没有记分</h3><p>每一笔给分和撤销<br />都会留在这里。</p></div><EventList v-else :events="room.events" :members="room.members" /><div class="history-foot"><i /> 所有球友看到的是同一份记录</div></aside>
      </div>
    </main>
    <footer class="site-footer" :inert="modalOpen"><span>追分 · 和球友一起记分</span><span>专注下一杆</span></footer>

    <SettingsDialog v-if="settingsOpen && room" v-model:room-name="roomName" v-model:initial-score="initialScore" :rules="rules" :is-host="isHost" :capacity="capacity" :busy="busy" :pending="!!pending" :connected="connected" :error="error" @close="closeSettings" @submit="configure" @retry="retry" />
    <RecipientDialog v-if="giving && room" :label="LABELS[giving]" :value="scoreValue(giving)" :players="room.members.filter(p => p.id !== session?.playerId)" :disabled="busy || !connected || !!pending || room.status !== 'playing'" @pick="giveTo" @close="giving = null" />
    <ConfirmDialog v-if="confirmation" v-model:carry="carry" :action="confirmation" :initial-score="room?.initialScore" @confirm="confirmAction" @close="confirmation = null" />
  </div>
</template>
