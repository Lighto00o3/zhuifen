<script setup lang="ts">
import { CARD_SUITS, pointCards } from '../utils/pointCards'
import { clockTime, formatElapsed } from '../utils/format'
import { randomHex, randomId } from '../utils/random'
import { WAKE_TIMEOUT } from '../utils/api'
import { DEFAULT_RULES, LABELS, type PlayerCount, type PublicRoom, type Rules, type ScoreKind, type Session } from '@zhuifen/shared'
import type { Transfer } from './CardTransfer.vue'
import type { ScoreNotice } from '../utils/roomChanges'
import type { ConfirmAction } from './ConfirmDialog.vue'

const route = useRoute()
const transfers = ref<{ enqueue: (transfer: Transfer) => void } | null>(null)
const notices = ref<{ push: (notice: ScoreNotice) => void } | null>(null)
const {
  room, session, saved, busy, connected, error, pending, me, isHost, lastEvent, canUndo, previous, next, activeEvents, capacity,
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
const inviteOpen = ref(false)
const settingsOpen = ref(false)
const elapsed = ref('00:00')
const giving = ref<ScoreKind | null>(null)
const confirmation = ref<ConfirmAction | null>(null)
const carry = ref(false)
const modalOpen = computed(() => inviteOpen.value || settingsOpen.value || !!giving.value || !!confirmation.value)
useModalFocus(modalOpen, () => { inviteOpen.value = false; closeSettings(); giving.value = null; confirmation.value = null })
watch(() => room.value?.status, status => { if (status !== 'playing') giving.value = null; if (status !== 'waiting') closeSettings() })
let timer: ReturnType<typeof setInterval> | undefined
let joining: { code: string; name: string; token: string; requestId: string } | undefined

const totalScore = computed(() => room.value?.members.reduce((sum, p) => sum + p.score, 0) ?? 0)
const modeLabel = computed(() => capacity.value === 2 ? '双人追分' : '三人追分')
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
  return kind === 'foul' ? `给上家 ${value} 分` : '选择收分的球友'
}

async function enter() {
  if (!nickname.value.trim()) { error.value = '先填一个球友能认出的昵称'; return }
  if (tab.value === 'join' && !/^\d{6}$/.test(roomCode.value)) { error.value = '请输入 6 位房间号'; return }
  busy.value = true; error.value = ''
  try {
    let result: { room: PublicRoom; session: Session }
    if (tab.value === 'create') result = await api('/rooms', { name: nickname.value, roomName: roomName.value, playerCount: playerCount.value, initialScore: initialScore.value, rules }, { timeout: WAKE_TIMEOUT })
    else {
      if (!joining || joining.code !== roomCode.value || joining.name !== nickname.value.trim()) {
        joining = { code: roomCode.value, name: nickname.value.trim(), token: randomHex(32), requestId: randomId() }
      }
      result = await api(`/rooms/${roomCode.value}/join`, joining, { timeout: WAKE_TIMEOUT })
    }
    enterRoom(result)
    await navigateTo({ path: '/room', query: { room: result.session.code } })
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function resume(value: Session) {
  busy.value = true
  try { if (await resumeRoom(value)) await navigateTo({ path: '/room', query: { room: value.code } }) }
  finally { busy.value = false }
}
async function give(kind: ScoreKind) {
  if (kind === 'foul') await command({ type: 'score', kind })
  else if (capacity.value === 2) await command({ type: 'score', kind, recipientId: previous.value?.id })
  else giving.value = kind
}
async function giveTo(recipientId: string) {
  const kind = giving.value
  giving.value = null
  if (kind) await command({ type: 'score', kind, recipientId })
}
async function move(index: number) {
  if (!room.value || index === 0) return
  const order = room.value.members.map(p => p.id)
  ;[order[index - 1], order[index]] = [order[index]!, order[index - 1]!]
  await command({ type: 'configure', initialScore: initialScore.value, rules: { ...rules }, order })
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
function person(id: string) { return room.value?.members.find(p => p.id === id)?.name ?? '球友' }
async function confirmAction() {
  const action = confirmation.value; confirmation.value = null
  if (action === 'close') await command({ type: 'close' })
  else if (action === 'end') await command({ type: 'end' })
  else if (action === 'restart') await command({ type: 'restart', carry: carry.value })
  else if (action === 'undo' && lastEvent.value) await command({ type: 'undo', eventId: lastEvent.value.id })
}
onMounted(() => {
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
        <div class="card-heading"><h2>和球友开一局</h2><p>取个昵称，就能上桌。</p></div>
        <NuxtLink class="local-mode-entry" to="/local"><span><b>单机记分</b><small>一台手机，记录两人或三人追分</small></span><span aria-hidden="true">→</span></NuxtLink>
        <div class="tabs"><button :aria-pressed="tab === 'create'" :class="{ active: tab === 'create' }" @click="tab = 'create'; error = ''">创建房间</button><button :aria-pressed="tab === 'join'" :class="{ active: tab === 'join' }" @click="tab = 'join'; error = ''">加入房间</button></div>
        <form @submit.prevent="enter">
          <label class="field">你的昵称<input v-model="nickname" maxlength="12" placeholder="球友怎么称呼你？" autocomplete="nickname" required /></label>
          <label v-if="tab === 'join'" class="field">房间号<input v-model="roomCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="输入球友的 6 位房间号" required /></label>
          <template v-else>
            <label class="field">房间名（选填）<input v-model="roomName" maxlength="24" placeholder="例如：周末球友局，留空也可以" /></label>
            <div class="field"><span id="player-count-label">追分人数</span><div class="mode-picker" role="group" aria-labelledby="player-count-label"><button type="button" :aria-pressed="playerCount === 2" :class="{ active: playerCount === 2 }" @click="playerCount = 2">双人追分</button><button type="button" :aria-pressed="playerCount === 3" :class="{ active: playerCount === 3 }" @click="playerCount = 3">三人追分</button></div></div>
            <DisclosurePanel class="entry-settings"><template #title>初始积分 <b>{{ initialScore }} 分</b></template><label class="field">每人初始积分<div class="input-unit"><input v-model.number="initialScore" type="number" min="1" max="10000" required /><span>分</span></div></label><p>其他分值可在开局前由房主设置。</p></DisclosurePanel>
          </template>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button class="primary full" :disabled="busy" type="submit">{{ busy ? '正在准备…' : tab === 'create' ? '创建房间，邀请球友' : '加入这一桌' }}</button>
        </form>
        <p class="entry-foot">各自用手机，同步一场追分。</p><NuxtLink class="text-button full" to="/history">查看历史对局</NuxtLink>
        <div v-if="saved.length" class="recent"><span>最近的房间</span><button v-for="s in saved.slice(0, 3)" :key="s.code" :disabled="busy" @click="resume(s)"><span class="recent-room"><b v-if="s.roomName">{{ s.roomName }}</b><span class="recent-code"># {{ s.code }}</span></span><span>返回 →</span></button></div>
      </section>
    </main>

    <main v-else class="room-page" :inert="modalOpen">
      <div class="room-toolbar">
        <button class="secondary home-button" :disabled="busy || !!pending" @click="back">← 返回首页</button>
        <NuxtLink class="text-button" to="/history">历史对局</NuxtLink><button v-if="isHost && (room.status === 'waiting' || room.status === 'playing')" class="danger-button" :disabled="busy || !connected || !!pending" @click="confirmation = room.status === 'waiting' ? 'close' : 'end'">{{ room.status === 'waiting' ? '关闭房间' : '结束本场' }}</button>
      </div>
      <div class="room-heading" :class="{ named: !!room.roomName }"><div><p v-if="room.roomName" class="room-name">{{ room.roomName }}</p><h1>{{ room.status === 'waiting' ? '等球友上桌' : room.status === 'ended' ? '这一场，收杆了' : room.status === 'closed' ? '房间已关闭' : '这一桌，正在追分' }}</h1><p class="room-meta"><span>{{ modeLabel }}</span><span>房间 <b>#{{ room.code }}</b></span><span class="room-progress"><template v-if="room.status === 'waiting'">{{ room.members.length }} / {{ capacity }} 人已加入</template><template v-else><span>{{ activeEvents.length }} 笔记分</span><span aria-hidden="true">·</span><span class="room-timer">{{ elapsed }}</span></template></span></p></div><button v-if="room.status === 'waiting' || room.status === 'playing'" class="secondary" @click="inviteOpen = true">扫码邀请 <span>↗</span></button></div>
      <div v-if="!connected" class="banner">连接恢复后会自动更新比分，暂时无法记分。</div>
      <div v-if="error" class="error" role="alert">{{ error }} <button v-if="pending" :disabled="busy || !connected" @click="retry">重试这笔操作</button></div>
      <div class="room-layout">
        <section class="score-section">
          <div class="section-label"><h2>同桌比分</h2><span>按出杆顺序排列</span></div>
          <div class="players" :class="{ duel: capacity === 2 }">
            <article v-for="(player, index) in room.members" :key="player.id" :data-player-id="player.id" class="player-card" :class="{ mine: player.id === session?.playerId }">
              <div class="player-top"><span class="avatar" :class="`color-${index}`">{{ player.name.slice(0, 1) }}</span><div><h3>{{ player.name }}<span v-if="player.id === session?.playerId" class="you">我</span></h3><span class="presence" :class="{ online: player.online }"><i />{{ player.online ? '已在线' : '暂时离线' }}<span v-if="player.id === room.hostId"> · 房主</span></span></div></div>
              <div class="score-number" :class="{ compact: String(player.score).length > 4 }">{{ player.score }}<span>分</span></div><div class="player-bottom"><span :class="{ positive: player.score > (room.startingScores?.[player.id] ?? room.initialScore), negative: player.score < (room.startingScores?.[player.id] ?? room.initialScore) }">本场 {{ player.score - (room.startingScores?.[player.id] ?? room.initialScore) > 0 ? '+' : '' }}{{ player.score - (room.startingScores?.[player.id] ?? room.initialScore) }}</span><button v-if="isHost && room.status === 'waiting' && index > 0" class="text-button" :disabled="busy || !connected || !!pending" @click="move(index)">↑ 向前一位</button><span v-else-if="capacity === 2 && player.id !== session?.playerId">我的对手</span><span v-else-if="capacity === 3 && player.id === previous?.id">我的上家</span><span v-else-if="capacity === 3 && player.id === next?.id">我的下家</span></div>
            </article>
            <template v-if="room.status === 'waiting'"><button v-for="n in capacity - room.members.length" :key="`empty-${n}`" class="player-card empty-seat" type="button" aria-label="邀请球友加入房间" @click="inviteOpen = true"><span class="empty-icon">＋</span><span class="empty-seat-title">留给下一位球友</span><span class="empty-seat-copy">扫一扫，一起上桌</span><span class="text-button">邀请加入 →</span></button></template>
          </div>

          <section v-if="room.status === 'playing'" class="action-panel">
            <div class="section-label"><h2>我来给分</h2><span>点一张牌，给球友分</span></div>
            <div class="score-actions">
              <button v-for="(label, kind, index) in LABELS" :key="kind" :class="['score-action', kind]" :style="{ '--card-tilt': `${(index - 2) * 3}deg` }" :aria-label="`${kind === 'foul' ? label : `给${label}`}，${scoreValue(kind)} 分，${scoreHint(kind)}`" :disabled="busy || !connected || !!pending" @click="give(kind)">
                <span class="score-card-stack" aria-hidden="true">
                  <span v-for="(card, cardIndex) in scoreCards[kind].slice(0, 3)" :key="cardIndex" class="score-card-face" :style="{ '--stack-offset': `${cardIndex * 3}px`, zIndex: 3 - cardIndex }"><PlayingCard :value="card.value" :face="card.rank" :suit="CARD_SUITS[kind]" /></span>
                </span>
                <span class="score-card-label">{{ label }}</span>
                <span class="score-card-amount">−{{ scoreValue(kind) }} 分<span v-if="scoreCards[kind].length > 1"> · {{ scoreCards[kind].length }} 张</span></span>
              </button>
            </div>
            <p class="card-rule-note">{{ capacity === 2 ? '犯规直接给对手，其他牌按赢家的得分支付。' : `犯规给上家；大金每人给 ${room.rules.dajin} 分，黄金9每人给 ${room.rules.golden9} 分（共 ${room.rules.golden9 * 2} 分）。` }}</p>
            <div class="action-footer"><span>以「{{ me?.name }}」的身份给分</span><button class="text-button" :disabled="!canUndo || busy || !connected || !!pending" @click="confirmation = 'undo'">↶ 撤销上一笔</button></div>
          </section>

          <section v-if="room.status === 'waiting'" class="lobby-ready"><p>{{ room.members.length === capacity ? '球友到齐了，确认座位顺序后开局。' : `还差 ${capacity - room.members.length} 位球友，点空位邀请加入。` }}</p><button v-if="isHost" class="primary full" type="button" :disabled="room.members.length !== capacity || busy || !connected || !!pending" @click="command({ type: 'start' })">{{ room.members.length === capacity ? `${capacity === 2 ? '两人' : '三人'}到齐，开始追分` : `等待${capacity === 2 ? '两人' : '三人'}到齐` }}</button><p v-else class="muted">由房主确认并开始追分。</p></section>
          <button v-if="room.status === 'waiting'" class="settings-entry" type="button" aria-haspopup="dialog" @click="openSettings"><span class="settings-entry-title"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="7" y="4" width="4" height="6" rx="2" fill="currentColor"/><rect x="14" y="14" width="4" height="6" rx="2" fill="currentColor"/></svg>房间与开局设置</span><span>{{ isHost ? '修改' : '查看' }} ↗</span></button>

          <section v-if="room.status === 'closed'" class="finished-panel"><span class="eyebrow">房主已关闭房间</span><h2>下次约球，再开一桌。</h2><p>这个房间无法再加入或开始追分。</p><button class="primary" @click="back">回首页，再开一桌 →</button></section>
          <section v-if="room.status === 'ended'" class="finished-panel"><span class="eyebrow">本场结束</span><h2>比分已保存，下次继续约。</h2><p>本场共记分 {{ activeEvents.length }} 笔，用时 {{ elapsed }}。每个人都能回到房间查看记录。</p><button v-if="isHost" class="primary" :disabled="busy || !connected || !!pending" @click="carry = false; confirmation = 'restart'">再开一局</button><p v-else class="muted">等房主发起下一局，大家会自动进入。</p><NuxtLink class="secondary" to="/history">历史对局</NuxtLink><ShareScore :game="{ id: room.roundId ?? room.startedAt!, name: room.roomName ?? '', initialScore: room.initialScore, startingScores: room.startingScores, rules: room.rules, members: room.members, events: room.events, startedAt: room.startedAt!, endedAt: room.endedAt }" /></section>
          <div class="room-summary"><span>全桌总分 <b>{{ totalScore }}</b> · {{ room.startingScores ? '按本局开局积分计算输赢' : `每人初始 ${room.initialScore}` }}</span></div>
        </section>

        <aside class="history-panel"><div class="section-label"><h2>本场记录</h2><span>{{ room.events.length }} 笔</span></div><div v-if="!room.events.length" class="empty-history"><span>↗</span><h3>好球，从第一杆开始</h3><p>每次记分和积分变化<br />都会留在这里。</p></div><ol v-else class="event-list"><li v-for="event in [...room.events].reverse()" :key="event.id" :class="{ undone: event.undoneAt }"><div class="event-heading"><b>{{ person(event.actorId) }} · {{ event.label }}</b><time>{{ clockTime(event.createdAt) }}</time></div><div class="event-deltas"><span v-for="(delta, id) in event.deltas" v-show="delta !== 0" :key="id">{{ person(String(id)) }} <b :class="delta > 0 ? 'positive' : 'negative'">{{ delta > 0 ? '+' : '' }}{{ delta }}</b></span></div><span v-if="event.undoneAt" class="undo-label">已撤销</span></li></ol><div class="history-foot"><i /> 所有球友查看同一份记录</div></aside>
      </div>
    </main>
    <footer class="site-footer" :inert="modalOpen"><span>追分 · 和球友一起记分</span><span>专注下一杆</span></footer>

    <InviteDialog v-if="inviteOpen && room" :code="room.code" :room-name="room.roomName" @close="inviteOpen = false" />
    <SettingsDialog v-if="settingsOpen && room" v-model:room-name="roomName" v-model:initial-score="initialScore" :rules="rules" :is-host="isHost" :capacity="capacity" :busy="busy" :pending="!!pending" :connected="connected" :error="error" @close="closeSettings" @submit="configure" @retry="retry" />
    <RecipientDialog v-if="giving && room" :label="LABELS[giving]" :value="scoreValue(giving)" :players="room.members.filter(p => p.id !== session?.playerId)" :disabled="busy || !connected || !!pending || room.status !== 'playing'" @pick="giveTo" @close="giving = null" />
    <ConfirmDialog v-if="confirmation" v-model:carry="carry" :action="confirmation" :initial-score="room?.initialScore" @confirm="confirmAction" @close="confirmation = null" />
  </div>
</template>
