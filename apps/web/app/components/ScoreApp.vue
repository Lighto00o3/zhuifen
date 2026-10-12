<script setup lang="ts">
import { io, type Socket } from 'socket.io-client'
import QRCode from 'qrcode'
import type { PlayerCount, PublicRoom, Rules, ScoreKind, Session } from '../../../api/src/model'

const route = useRoute()
const router = useRouter()

const apiOrigin = useRuntimeConfig().public.apiOrigin.replace(/\/$/, '')
const labels: Record<ScoreKind, string> = { foul: '犯规', normal: '普胜', xiaojin: '小金', dajin: '大金', golden9: '黄金九' }
const room = ref<PublicRoom | null>(null)
const session = ref<Session | null>(null)
const saved = ref<Session[]>([])
const nickname = ref('')
const roomName = ref('')
const roomCode = ref('')
const tab = ref<'create' | 'join'>('create')
const initialScore = ref(100)
const playerCount = ref<PlayerCount>(3)
const rules = reactive<Rules>({ foul: 1, normal: 4, xiaojin: 7, dajin: 10, golden9: 4 })
const busy = ref(false)
const connected = ref(false)
const error = ref('')
const notice = ref('')
const scoreNotices = ref<{ id: number; text: string; positive: boolean }[]>([])
const noticeTimers = new Set<ReturnType<typeof setTimeout>>()
let noticeId = 0
const inviteOpen = ref(false)
const qr = ref('')
const inviteLink = ref('')
const elapsed = ref('00:00')
const giving = ref<ScoreKind | null>(null)
const confirmation = ref<'end' | 'undo' | 'close' | null>(null)
const pending = ref<Record<string, unknown> | null>(null)
let socket: Socket | undefined
let timer: ReturnType<typeof setInterval> | undefined
let joining: { code: string; name: string; token: string; requestId: string } | undefined

const me = computed(() => room.value?.members.find(p => p.id === session.value?.playerId))
const isHost = computed(() => room.value?.hostId === session.value?.playerId)
const lastEvent = computed(() => room.value?.events.findLast(e => !e.undoneAt))
const canUndo = computed(() => !!lastEvent.value && (isHost.value || lastEvent.value.actorId === session.value?.playerId))
const previous = computed(() => {
  const members = room.value?.members ?? []
  const index = members.findIndex(p => p.id === session.value?.playerId)
  return members.length > 1 ? members[(index + members.length - 1) % members.length] : undefined
})
const next = computed(() => {
  const members = room.value?.members ?? []
  const index = members.findIndex(p => p.id === session.value?.playerId)
  return members.length > 1 ? members[(index + 1) % members.length] : undefined
})
const activeEvents = computed(() => room.value?.events.filter(e => !e.undoneAt) ?? [])
const totalScore = computed(() => room.value?.members.reduce((sum, p) => sum + p.score, 0) ?? 0)
const capacity = computed(() => room.value?.playerCount ?? 3)
const modeLabel = computed(() => capacity.value === 2 ? '双人追分' : '三人追分')
function scoreValue(kind: ScoreKind) {
  if (!room.value) return 0
  return room.value.rules[kind]
}
function scoreHint(kind: ScoreKind) {
  if (!room.value) return ''
  const value = room.value.rules[kind]
  if (capacity.value === 2) return `给对手 ${value} 分`
  return kind === 'foul' ? `给上家 ${value} 分` : '选择收分的球友'
}

async function api<T>(path: string, body?: unknown, token = session.value?.token): Promise<T> {
  const response = await fetch(`${apiOrigin}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) { const failure = new Error(Array.isArray(result.message) ? result.message.join('；') : result.message ?? '操作失败'); Object.assign(failure, { status: response.status }); throw failure }
  return result as T
}
function receive(state: PublicRoom) {
  if (session.value && state.code !== session.value.code) return
  if (room.value && state.version <= room.value.version) return
  const before = room.value
  const playerId = session.value?.playerId
  // 首次进入只恢复比分；HTTP 响应、广播和重连快照按版本去重。
  if (before && before.code === state.code && playerId) {
    const oldEvents = new Map(before.events.map(event => [event.id, event]))
    for (const event of state.events) {
      const old = oldEvents.get(event.id)
      const undone = !!old && !old.undoneAt && !!event.undoneAt
      if ((!old && !event.undoneAt) || undone) {
        const delta = (event.deltas[playerId] ?? 0) * (undone ? -1 : 1)
        if (!delta) continue
        const actor = event.actorId === playerId ? '你' : state.members.find(p => p.id === event.actorId)?.name ?? '球友'
        const action = undone ? `已撤销${actor}的${event.label}` : `${actor}${event.label}`
        const id = ++noticeId
        scoreNotices.value = [...scoreNotices.value, { id, text: `${action}，你${delta > 0 ? '加' : '扣'}了 ${Math.abs(delta)} 分`, positive: delta > 0 }].slice(-4)
        const timeout = setTimeout(() => { scoreNotices.value = scoreNotices.value.filter(item => item.id !== id); noticeTimers.delete(timeout) }, 5000)
        noticeTimers.add(timeout)
      }
    }
  }
  room.value = state
  rememberRoomName(state.code, state.roomName)
  if (state.status === 'waiting') { roomName.value = state.roomName ?? ''; initialScore.value = state.initialScore; Object.assign(rules, state.rules) }
}
function rememberRoomName(code: string, title?: string) {
  const value = saved.value.find(s => s.code === code)
  if (!value || value.roomName === title) return
  value.roomName = title
  localStorage.setItem('zhuifen:sessions', JSON.stringify(saved.value))
}
async function refreshRecent() {
  await Promise.allSettled(saved.value.slice(0, 3).map(async value => {
    const state = await api<PublicRoom>(`/rooms/${value.code}`, undefined, value.token)
    rememberRoomName(state.code, state.roomName)
  }))
}
function saveSession(value: Session) {
  session.value = value
  saved.value = [value, ...saved.value.filter(s => s.code !== value.code)].slice(0, 12)
  localStorage.setItem('zhuifen:sessions', JSON.stringify(saved.value))
  try { pending.value = JSON.parse(localStorage.getItem(`zhuifen:pending:${value.code}`) ?? 'null') } catch { pending.value = null }
}
function connect() {
  socket?.disconnect()
  connected.value = false
  // 开发环境直连 API，避免 Nuxt 开发服务器拦截 WebSocket Upgrade。
  // 托管平台可通过 NUXT_PUBLIC_API_ORIGIN 指定独立的 HTTPS 后端地址。
  const origin = new URL(location.origin)
  if (import.meta.dev) origin.port = '3001'
  socket = io(apiOrigin || origin.origin, { transports: ['websocket', 'polling'], tryAllTransports: true })
  socket.on('room:state', receive)
  socket.on('room:presence', (ids: string[]) => {
    if (room.value) room.value.members.forEach(p => { p.online = ids.includes(p.id) })
  })
  socket.on('connect', () => {
    socket!.timeout(5000).emit('room:subscribe', session.value, (err: Error | null, response: { ok: boolean; room?: PublicRoom; message?: string }) => {
      if (err || !response?.ok || !response.room) { error.value = response?.message ?? '连接房间失败，请重试'; connected.value = false; return }
      receive(response.room); connected.value = true
      if (pending.value) void retry()
    })
  })
  socket.on('disconnect', () => { connected.value = false })
  socket.on('connect_error', () => { connected.value = false })
}
async function enter() {
  if (!nickname.value.trim()) { error.value = '先填一个球友能认出的昵称'; return }
  if (tab.value === 'join' && !/^\d{6}$/.test(roomCode.value)) { error.value = '请输入 6 位房间号'; return }
  busy.value = true; error.value = ''
  try {
    let result: { room: PublicRoom; session: Session }
    if (tab.value === 'create') result = await api('/rooms', { name: nickname.value, roomName: roomName.value, playerCount: playerCount.value, initialScore: initialScore.value, rules })
    else {
      if (!joining || joining.code !== roomCode.value || joining.name !== nickname.value.trim()) {
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        joining = { code: roomCode.value, name: nickname.value.trim(), token: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), requestId: requestId() }
      }
      result = await api(`/rooms/${roomCode.value}/join`, joining)
    }
    saveSession(result.session); receive(result.room); connect()
    await navigateTo({ path: '/room', query: { room: result.session.code } })
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function resume(value: Session) {
  busy.value = true; error.value = ''; session.value = value; room.value = null
  try { const state = await api<PublicRoom>(`/rooms/${value.code}`); saveSession(value); receive(state); connect(); await navigateTo({ path: '/room', query: { room: value.code } }) }
  catch (e) { session.value = null; error.value = (e as Error).message }
  finally { busy.value = false }
}
// crypto.randomUUID 在手机通过局域网 HTTP 打开时不可用，使用随机字节构造 UUID。
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
async function command(data: Record<string, unknown>) {
  if (!connected.value || busy.value || pending.value) return
  pending.value = { ...data, requestId: requestId() }
  localStorage.setItem(`zhuifen:pending:${session.value!.code}`, JSON.stringify(pending.value))
  await retry()
}
async function retry() {
  if (!pending.value || busy.value || !session.value) return
  busy.value = true; error.value = ''
  try {
    receive(await api<PublicRoom>(`/rooms/${session.value.code}/commands`, pending.value))
    pending.value = null
    localStorage.removeItem(`zhuifen:pending:${session.value.code}`)
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status && status < 500) { pending.value = null; localStorage.removeItem(`zhuifen:pending:${session.value.code}`) }
    error.value = `${(e as Error).message}${pending.value ? '，重试不会重复记分' : ''}`
  } finally { busy.value = false }
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
async function configure() {
  await command({ type: 'configure', roomName: roomName.value, initialScore: initialScore.value, rules: { ...rules }, order: room.value!.members.map(p => p.id) })
}
function back() {
  if (busy.value || pending.value) return
  socket?.disconnect(); socket = undefined; connected.value = false
  void navigateTo('/')
}
async function invite() {
  inviteLink.value = new URL(router.resolve({ path: '/room', query: { room: room.value!.code } }).href, location.origin).href
  qr.value = await QRCode.toDataURL(inviteLink.value, { width: 240, margin: 2, color: { dark: '#173c2e', light: '#ffffff' } })
  inviteOpen.value = true
}
async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteLink.value); notice.value = '邀请链接已复制' }
  catch { notice.value = '长按下方链接即可复制' }
}
function person(id: string) { return room.value?.members.find(p => p.id === id)?.name ?? '球友' }
function time(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
async function confirmAction() {
  const action = confirmation.value; confirmation.value = null
  if (action === 'close') await command({ type: 'close' })
  else if (action === 'end') await command({ type: 'end' })
  else if (action === 'undo' && lastEvent.value) await command({ type: 'undo', eventId: lastEvent.value.id })
}
onMounted(() => {
  try { const value = JSON.parse(localStorage.getItem('zhuifen:sessions') ?? '[]'); if (Array.isArray(value)) saved.value = value.filter(s => typeof s?.code === 'string' && typeof s?.token === 'string' && typeof s?.playerId === 'string') } catch {}
  const code = typeof route.query.room === 'string' ? route.query.room : undefined
  if (!code) void refreshRecent()
  if (code && /^\d{6}$/.test(code)) {
    roomCode.value = code; tab.value = 'join'
    const existing = saved.value.find(s => s.code === code)
    if (existing) void resume(existing)
  }
  timer = setInterval(() => {
    if (!room.value?.startedAt) { elapsed.value = '00:00'; return }
    const seconds = Math.max(0, Math.floor(((room.value.endedAt ? Date.parse(room.value.endedAt) : Date.now()) - Date.parse(room.value.startedAt)) / 1000))
    elapsed.value = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }, 1000)
})
onUnmounted(() => { socket?.disconnect(); if (timer) clearInterval(timer); noticeTimers.forEach(clearTimeout) })
</script>

<template>
  <div class="app-shell">
    <div class="score-notices" role="status" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="score-notice">
        <div v-for="item in scoreNotices" :key="item.id" class="score-notice" :class="{ loss: !item.positive }"><span aria-hidden="true">{{ item.positive ? '+' : '−' }}</span>{{ item.text }}</div>
      </TransitionGroup>
    </div>
    <header class="site-header">
      <a class="brand" href="/" @click.prevent="back"><span class="brand-ball">9</span>追分<span class="brand-sub">和球友一起记分</span></a>
      <span v-if="room" class="connection" :class="{ offline: !connected }"><i />{{ connected ? '实时同步中' : '正在重新连接' }}</span>
      <span v-else class="header-note">双人或三人 · 同一个比分</span>
    </header>

    <main v-if="!room" class="landing">
      <section class="intro">
        <span class="eyebrow"><i /> 球友的共享记分牌</span>
        <h1>好好打球。<br /><span>分数，一起看。</span></h1>
        <p class="intro-copy">告别来回递牌、反复对分。<br />扫码进同一个房间，你记一笔，大家都看得见。</p>
        <div class="table-visual" aria-hidden="true"><div class="table-rail"><div class="felt"><span class="pocket p1" /><span class="pocket p2" /><span class="pocket p3" /><span class="pocket p4" /><div class="cue-ball" /><div class="nine-ball">9</div><div class="one-ball">1</div><div class="shot-line" /></div></div><div class="floating-score"><span class="mini-avatar">陈</span><span>犯规 <strong>−1</strong></span><span class="sync-mark">✓ 已同步</span></div><div class="visual-caption">专注下一杆，记分交给我们。</div></div>
        <div class="benefits"><span><b>01</b> 扫码同桌</span><span><b>02</b> 自动转分</span><span><b>03</b> 随时回看</span></div>
      </section>
      <section class="entry-card">
        <div class="card-heading"><span class="eyebrow">今晚，打几杆？</span><h2>和球友开一局</h2><p>不必注册，取个昵称就能上桌。</p></div>
        <div class="tabs"><button :class="{ active: tab === 'create' }" @click="tab = 'create'; error = ''">创建房间</button><button :class="{ active: tab === 'join' }" @click="tab = 'join'; error = ''">加入房间</button></div>
        <form @submit.prevent="enter">
          <label class="field">你的昵称<input v-model="nickname" maxlength="12" placeholder="球友怎么称呼你？" autocomplete="nickname" required /></label>
          <label v-if="tab === 'join'" class="field">房间号<input v-model="roomCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="输入球友的 6 位房间号" required /></label>
          <template v-else>
            <label class="field">房间名（选填）<input v-model="roomName" maxlength="24" placeholder="例如：周末球友局，留空也可以" /></label>
            <div class="field"><span id="player-count-label">追分人数</span><div class="mode-picker" role="group" aria-labelledby="player-count-label"><button type="button" :aria-pressed="playerCount === 2" :class="{ active: playerCount === 2 }" @click="playerCount = 2">双人追分</button><button type="button" :aria-pressed="playerCount === 3" :class="{ active: playerCount === 3 }" @click="playerCount = 3">三人追分</button></div></div>
            <label class="field">每人初始积分<div class="input-unit"><input v-model.number="initialScore" type="number" min="1" max="10000" required /><span>分</span></div></label>
            <div class="rule-preview"><div><b>{{ playerCount === 2 ? '双人追分' : '三人追分' }}</b><span>默认 1 / 4 / 7 / 10</span></div><p>{{ playerCount === 2 ? '两人对局，输的人给对手分。' : '三人轮流，输的人选择赢家给分。' }}开局前可调整规则。</p></div>
          </template>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button class="primary full" :disabled="busy" type="submit">{{ busy ? '正在准备…' : tab === 'create' ? '创建房间，邀请球友' : '加入这一桌' }}<span>↗</span></button>
        </form>
        <p class="entry-foot">各自用手机，同步一场追分。</p>
        <div v-if="saved.length" class="recent"><span>最近的房间</span><button v-for="s in saved.slice(0, 3)" :key="s.code" :disabled="busy" @click="resume(s)"><span class="recent-room"><b v-if="s.roomName">{{ s.roomName }}</b><span class="recent-code"># {{ s.code }}</span></span><span>返回 →</span></button></div>
      </section>
    </main>

    <main v-else class="room-page">
      <div class="room-toolbar">
        <button class="secondary home-button" :disabled="busy || !!pending" @click="back">← 返回首页</button>
        <button v-if="isHost && (room.status === 'waiting' || room.status === 'playing')" class="danger-button" :disabled="busy || !connected || !!pending" @click="confirmation = room.status === 'waiting' ? 'close' : 'end'">{{ room.status === 'waiting' ? '关闭房间' : '结束本场' }}</button>
      </div>
      <div class="room-heading" :class="{ named: !!room.roomName }"><div><p v-if="room.roomName" class="room-name">{{ room.roomName }}</p><h1>{{ room.status === 'waiting' ? '等球友上桌' : room.status === 'ended' ? '这一场，收杆了' : room.status === 'closed' ? '房间已关闭' : '这一桌，正在追分' }}</h1><p>{{ modeLabel }}<span class="dot-separator">·</span>房间 <b>#{{ room.code }}</b><span class="dot-separator">·</span>{{ room.status === 'waiting' ? `${room.members.length} / ${capacity} 人已加入` : `${activeEvents.length} 笔记分 · ${elapsed}` }}</p></div><button v-if="room.status === 'waiting' || room.status === 'playing'" class="secondary" @click="invite">扫码邀请 <span>↗</span></button></div>
      <div v-if="!connected" class="banner">连接恢复后会自动更新比分，暂时无法记分。</div>
      <div v-if="error" class="error" role="alert">{{ error }} <button v-if="pending" :disabled="busy || !connected" @click="retry">重试这笔操作</button></div>
      <div class="room-layout">
        <section class="score-section">
          <div class="section-label"><h2>同桌比分</h2><span>按出杆顺序排列</span></div>
          <div class="players" :class="{ duel: capacity === 2 }">
            <article v-for="(player, index) in room.members" :key="player.id" class="player-card" :class="{ mine: player.id === session?.playerId }">
              <div class="player-top"><span class="avatar" :class="`color-${index}`">{{ player.name.slice(0, 1) }}</span><div><h3>{{ player.name }}<span v-if="player.id === session?.playerId" class="you">我</span></h3><span class="presence" :class="{ online: player.online }"><i />{{ player.online ? '已在线' : '暂时离线' }}<span v-if="player.id === room.hostId"> · 房主</span></span></div><span class="seat">0{{ index + 1 }}</span></div>
              <div class="score-number">{{ player.score }}<span>分</span></div><div class="player-bottom"><span :class="{ positive: player.score > room.initialScore, negative: player.score < room.initialScore }">本场 {{ player.score - room.initialScore > 0 ? '+' : '' }}{{ player.score - room.initialScore }}</span><button v-if="isHost && room.status === 'waiting' && index > 0" class="text-button" :disabled="busy || !connected || !!pending" @click="move(index)">↑ 向前一位</button><span v-else-if="capacity === 2 && player.id !== session?.playerId">我的对手</span><span v-else-if="capacity === 3 && player.id === previous?.id">我的上家</span><span v-else-if="capacity === 3 && player.id === next?.id">我的下家</span></div>
            </article>
            <template v-if="room.status === 'waiting'"><button v-for="n in capacity - room.members.length" :key="`empty-${n}`" class="player-card empty-seat" type="button" aria-label="邀请球友加入房间" @click="invite"><span class="empty-icon">＋</span><span class="empty-seat-title">留给下一位球友</span><span class="empty-seat-copy">扫一扫，一起上桌</span><span class="text-button">邀请加入 →</span></button></template>
          </div>

          <section v-if="room.status === 'playing'" class="action-panel"><div class="section-label"><h2>记下这一杆</h2><span>以「{{ me?.name }}」的身份给分</span></div><div class="score-actions"><button v-for="(label, kind) in labels" :key="kind" :class="['score-action', kind]" :disabled="busy || !connected || !!pending" @click="give(kind)"><span>{{ kind === 'foul' ? label : `给${label}` }}</span><b>−{{ scoreValue(kind) }}<small>分</small></b><em>{{ scoreHint(kind) }}</em></button></div><div class="action-footer"><span>输的人给分，整桌实时同步。</span><button class="text-button" :disabled="!canUndo || busy || !connected || !!pending" @click="confirmation = 'undo'">↶ 撤销上一笔</button></div></section>

          <section v-if="room.status === 'waiting'" class="settings-panel"><div class="section-label"><h2>开局规则</h2><span>{{ isHost ? '房主可以调整' : '由房主设置' }}</span></div><form @submit.prevent="configure"><label class="field">房间名（选填）<input v-model="roomName" maxlength="24" placeholder="留空则只显示房间号" :disabled="!isHost" /></label><div class="settings-grid"><label class="field">初始积分<input v-model.number="initialScore" type="number" min="1" max="10000" :disabled="!isHost" required /></label><label v-for="(label, kind) in labels" :key="kind" class="field">{{ label }}<input v-model.number="rules[kind]" type="number" min="1" max="100" :disabled="!isHost" required /></label></div><p class="rule-help">{{ capacity === 2 ? '所有按钮只扣自己的分、给对手加分。犯规给对手；其他按钮按赢家的普胜、小金、大金或黄金九支付一份分值。' : '所有按钮只扣自己的分。犯规自动给上家；其他按钮选择赢家给分。大金、黄金九由每位输家分别支付一份分值。' }}允许积分低于零。</p><div v-if="isHost" class="lobby-actions"><button class="secondary" :disabled="busy || !connected || !!pending" type="submit">保存设置</button><button class="primary" type="button" :disabled="room.members.length !== capacity || busy || !connected || !!pending" @click="command({ type: 'start' })">{{ room.members.length === capacity ? `${capacity === 2 ? '两人' : '三人'}到齐，开始追分` : `等待${capacity === 2 ? '两人' : '三人'}到齐` }} →</button></div><p v-else class="muted">大家确认顺序和规则后，由房主开始。</p></form></section>

          <section v-if="room.status === 'closed'" class="finished-panel"><span class="eyebrow">房主已关闭房间</span><h2>下次约球，再开一桌。</h2><p>这个房间无法再加入或开始追分。</p><button class="primary" @click="back">回首页，再开一桌 →</button></section>
          <section v-if="room.status === 'ended'" class="finished-panel"><span class="eyebrow">本场结束</span><h2>比分已保存，下次继续约。</h2><p>本场共记分 {{ activeEvents.length }} 笔，用时 {{ elapsed }}。每个人都能回到房间查看记录。</p><button class="primary" @click="back">回首页，再开一桌 →</button></section>
          <div class="room-summary"><span>全桌总分 <b>{{ totalScore }}</b> · 每人初始 {{ room.initialScore }}</span></div>
        </section>

        <aside class="history-panel"><div class="section-label"><h2>本场记录</h2><span>{{ room.events.length }} 笔</span></div><div v-if="!room.events.length" class="empty-history"><span>↗</span><h3>好球，从第一杆开始</h3><p>每次记分和积分变化<br />都会留在这里。</p></div><ol v-else class="event-list"><li v-for="event in [...room.events].reverse()" :key="event.id" :class="{ undone: event.undoneAt }"><div class="event-heading"><b>{{ person(event.actorId) }} · {{ event.label }}</b><time>{{ time(event.createdAt) }}</time></div><div class="event-deltas"><span v-for="(delta, id) in event.deltas" v-show="delta !== 0" :key="id">{{ person(String(id)) }} <b :class="delta > 0 ? 'positive' : 'negative'">{{ delta > 0 ? '+' : '' }}{{ delta }}</b></span></div><span v-if="event.undoneAt" class="undo-label">已撤销</span></li></ol><div class="history-foot"><i /> 所有球友查看同一份记录</div></aside>
      </div>
    </main>
    <footer class="site-footer"><span>追分 · 每一杆，都算数。</span><span>球友之间的共享记分工具</span></footer>

    <div v-if="inviteOpen" class="modal-backdrop" @click.self="inviteOpen = false"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button class="close-modal" aria-label="关闭邀请" @click="inviteOpen = false">×</button><span class="eyebrow">给球友留个位置</span><h2 id="invite-title">扫码，加入这一桌</h2><p>球友用自己的手机扫码打开</p><img :src="qr" alt="加入房间的二维码" width="240" height="240" /><p v-if="room?.roomName" class="invite-room-name">{{ room.roomName }}</p><div class="invite-code">{{ room?.code }}</div><p>也可以在首页输入房间号加入</p><input class="share-link" :value="inviteLink" aria-label="邀请链接" readonly @focus="($event.target as HTMLInputElement).select()" /><button class="primary full" @click="copyInvite">复制邀请链接 ↗</button><p v-if="notice" role="status">{{ notice }}</p></section></div>
    <div v-if="giving" class="modal-backdrop" @click.self="giving = null"><section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="give-title"><h2 id="give-title">这笔分给谁？</h2><p>{{ labels[giving] }}：从你的积分扣 {{ scoreValue(giving) }} 分，给选中的球友。</p><div class="recipient-actions"><button v-for="player in room?.members.filter(p => p.id !== session?.playerId)" :key="player.id" class="primary full" :disabled="busy || !connected || !!pending || room?.status !== 'playing'" @click="giveTo(player.id)">给 {{ player.name }} {{ scoreValue(giving) }} 分</button><button class="secondary full" @click="giving = null">取消给分</button></div></section></div>
    <div v-if="confirmation" class="modal-backdrop" @click.self="confirmation = null"><section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{{ confirmation === 'undo' ? '撤销上一笔记分？' : confirmation === 'close' ? '关闭这个房间？' : '结束这场追分？' }}</h2><p>{{ confirmation === 'undo' ? '这一笔的所有积分变化会一起还原，记录保留并标记为已撤销。' : confirmation === 'close' ? '关闭后无法加入或开局，所有球友都会看到房间已关闭。' : '结束后保留比分和操作记录，这一场将无法继续记分。' }}</p><div class="confirm-actions"><button class="secondary" @click="confirmation = null">再想想</button><button class="primary" @click="confirmAction">{{ confirmation === 'undo' ? '确认撤销' : confirmation === 'close' ? '确认关闭' : '确认结束' }}</button></div></section></div>
  </div>
</template>
