import { io, type Socket } from 'socket.io-client'
import type { PublicRoom, Session } from '@zhuifen/shared'
import { createApi, credentialGone, errorStatus, WAKE_TIMEOUT } from '../utils/api'
import { cacheOnlineGames } from '../utils/gameHistory'
import { randomId } from '../utils/random'
import { roomChanges } from '../utils/roomChanges'
import { addSession, forgetSessions, loadSessions, pendingKey, storeSessions } from '../utils/sessions'
import { withStorage } from '../utils/storage'
import { createSubscription, type SubscribeResponse } from '../utils/subscription'

type Changes = ReturnType<typeof roomChanges>

// 联机房间的状态、实时连接和命令队列。
// 每次记分先存进 pending，请求成功后才清掉；断线或 5xx 时可以用同一个 requestId 重试，不会重复记分。
export function useRoom(hooks: { onChanges?: (changes: Changes) => void; onState?: (state: PublicRoom) => void } = {}) {
  const apiOrigin = useRuntimeConfig().public.apiOrigin.replace(/\/$/, '')
  const request = createApi(apiOrigin)
  const room = ref<PublicRoom | null>(null)
  const session = ref<Session | null>(null)
  const saved = ref<Session[]>([])
  const busy = ref(false)
  const connected = ref(false)
  const error = ref('')
  const pending = ref<Record<string, unknown> | null>(null)
  let socket: Socket | undefined
  let subscription: ReturnType<typeof createSubscription> | undefined

  const me = computed(() => room.value?.members.find(p => p.id === session.value?.playerId))
  const isHost = computed(() => room.value?.hostId === session.value?.playerId)
  const lastEvent = computed(() => room.value?.events.findLast(e => !e.undoneAt))
  const canUndo = computed(() => !!lastEvent.value && (isHost.value || lastEvent.value.actorId === session.value?.playerId))
  const neighbour = (step: number) => computed(() => {
    const members = room.value?.members ?? []
    const index = members.findIndex(p => p.id === session.value?.playerId)
    return members.length > 1 ? members[(index + step + members.length) % members.length] : undefined
  })
  const previous = neighbour(-1)
  const next = neighbour(1)
  const activeEvents = computed(() => room.value?.events.filter(e => !e.undoneAt) ?? [])
  const capacity = computed(() => room.value?.playerCount ?? 3)

  // timeout 为空时用默认的 20 秒；进入房间（可能碰上服务冷启动）时传 WAKE_TIMEOUT。
  function api<T>(path: string, body?: unknown, options: { token?: string; timeout?: number } = {}) {
    return request<T>(path, body, options.token ?? session.value?.token, options.timeout)
  }

  function receive(state: PublicRoom) {
    if (session.value && state.code !== session.value.code) return
    if (room.value && state.version <= room.value.version) return
    const before = room.value
    // 历史只在有局结束时变化，记分过程中不必反复重写整份缓存。
    if (!before || before.code !== state.code || before.status !== state.status || before.roundCount !== state.roundCount) {
      withStorage(storage => cacheOnlineGames(storage, state))
    }
    // HTTP 响应、广播和重连快照按版本去重，同一笔记分只提示一次。
    const changes = roomChanges(before, state, session.value?.playerId)
    room.value = state
    rememberRoomName(state.code, state.roomName)
    hooks.onChanges?.(changes)
    hooks.onState?.(state)
  }
  function rememberRoomName(code: string, title?: string) {
    const value = saved.value.find(s => s.code === code)
    if (!value || value.roomName === title) return
    value.roomName = title
    withStorage(storage => storeSessions(storage, saved.value))
  }
  function forgetSession(code: string) {
    saved.value = withStorage(storage => forgetSessions(storage, saved.value, [code])) ?? saved.value.filter(s => s.code !== code)
  }
  function loadSaved() { saved.value = withStorage(loadSessions) ?? [] }
  async function refreshRecent() {
    await Promise.allSettled(saved.value.slice(0, 3).map(async value => {
      try {
        const state = await api<PublicRoom>(`/rooms/${value.code}`, undefined, { token: value.token })
        rememberRoomName(state.code, state.roomName)
      } catch (e) { if (credentialGone(e)) forgetSession(value.code) }
    }))
  }
  function saveSession(value: Session) {
    session.value = value
    saved.value = addSession(saved.value, value)
    withStorage(storage => storeSessions(storage, saved.value))
    pending.value = withStorage(storage => JSON.parse(storage.getItem(pendingKey(value.code)) ?? 'null')) ?? null
  }
  function connect() {
    disconnect()
    // 开发环境直连 API，避免 Nuxt 开发服务器拦截 WebSocket Upgrade。
    // 托管平台可通过 NUXT_PUBLIC_API_ORIGIN 指定独立的 HTTPS 后端地址。
    const origin = new URL(location.origin)
    if (import.meta.dev) origin.port = '3001'
    const current = io(apiOrigin || origin.origin, { transports: ['websocket', 'polling'], tryAllTransports: true })
    socket = current
    current.on('room:state', receive)
    current.on('room:presence', (ids: string[]) => {
      if (room.value) room.value.members.forEach(p => { p.online = ids.includes(p.id) })
    })
    subscription = createSubscription({
      emit: done => current.timeout(5000).emit('room:subscribe', session.value, (err: Error | null, response?: SubscribeResponse) => done(err, response)),
      active: () => socket === current && current.connected,
      onRoom(state) {
        receive(state); connected.value = true
        if (pending.value) void retry()
      },
      onDenied(message) { error.value = message },
    })
    current.on('connect', () => subscription?.start())
    current.on('disconnect', () => { connected.value = false; subscription?.stop() })
    current.on('connect_error', () => { connected.value = false })
  }
  function disconnect() {
    subscription?.stop(); subscription = undefined
    socket?.disconnect(); socket = undefined; connected.value = false
  }
  // 创建或加入成功后进入房间。
  function enter(result: { room: PublicRoom; session: Session }) { saveSession(result.session); receive(result.room); connect() }
  async function resume(value: Session) {
    error.value = ''; session.value = value; room.value = null
    try { const state = await api<PublicRoom>(`/rooms/${value.code}`, undefined, { timeout: WAKE_TIMEOUT }); saveSession(value); receive(state); connect(); return true }
    catch (e) {
      session.value = null; error.value = (e as Error).message
      if (credentialGone(e)) forgetSession(value.code)
      return false
    }
  }
  async function command(data: Record<string, unknown>) {
    if (!connected.value || busy.value || pending.value) return
    pending.value = { ...data, roundId: room.value?.roundId, requestId: randomId() }
    // 存不进去也照样发送，只是刷新页面后无法自动重试这一笔。
    const value = JSON.stringify(pending.value)
    withStorage(storage => storage.setItem(pendingKey(session.value!.code), value))
    await retry()
  }
  async function retry() {
    if (!pending.value || busy.value || !session.value) return
    busy.value = true; error.value = ''
    const key = pendingKey(session.value.code)
    try {
      receive(await api<PublicRoom>(`/rooms/${session.value.code}/commands`, pending.value))
      pending.value = null
      withStorage(storage => storage.removeItem(key))
    } catch (e) {
      // 4xx 说明这笔操作被拒绝了，不必再重试；超时、断网、5xx 和限流（429）时保留，可以用同一个编号重试。
      const status = errorStatus(e)
      if (status && status < 500 && status !== 429) { pending.value = null; withStorage(storage => storage.removeItem(key)) }
      error.value = `${(e as Error).message}${pending.value ? '，重试不会重复记分' : ''}`
    } finally { busy.value = false }
  }
  onUnmounted(disconnect)

  return { room, session, saved, busy, connected, error, pending, me, isHost, lastEvent, canUndo, previous, next, activeEvents, capacity,
    api, loadSaved, refreshRecent, enter, resume, disconnect, connect, command, retry }
}
