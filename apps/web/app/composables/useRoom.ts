import { io, type Socket } from 'socket.io-client'
import type { PublicRoom, Session } from '@zhuifen/shared'
import { createApi, errorCode, errorStatus } from '../utils/api'
import { cacheOnlineGames } from '../utils/gameHistory'
import { randomId } from '../utils/random'
import { roomChanges } from '../utils/roomChanges'
import { addSession, forgetSessions, loadSessions, pendingKey, storeSessions } from '../utils/sessions'

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

  function api<T>(path: string, body?: unknown, token = session.value?.token) { return request<T>(path, body, token) }

  function receive(state: PublicRoom) {
    if (session.value && state.code !== session.value.code) return
    if (room.value && state.version <= room.value.version) return
    const before = room.value
    // 历史只在有局结束时变化，记分过程中不必反复重写整份缓存。
    if (!before || before.code !== state.code || before.status !== state.status || before.roundCount !== state.roundCount) {
      try { cacheOnlineGames(localStorage, state) } catch {}
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
    storeSessions(localStorage, saved.value)
  }
  function forgetSession(code: string) { saved.value = forgetSessions(localStorage, saved.value, [code]) }
  function loadSaved() { saved.value = loadSessions(localStorage) }
  async function refreshRecent() {
    await Promise.allSettled(saved.value.slice(0, 3).map(async value => {
      try {
        const state = await api<PublicRoom>(`/rooms/${value.code}`, undefined, value.token)
        rememberRoomName(state.code, state.roomName)
      } catch (e) { if (errorCode(e) === 'room_not_found') forgetSession(value.code) }
    }))
  }
  function saveSession(value: Session) {
    session.value = value
    saved.value = addSession(saved.value, value)
    storeSessions(localStorage, saved.value)
    try { pending.value = JSON.parse(localStorage.getItem(pendingKey(value.code)) ?? 'null') } catch { pending.value = null }
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
  function disconnect() { socket?.disconnect(); socket = undefined; connected.value = false }
  // 创建或加入成功后进入房间。
  function enter(result: { room: PublicRoom; session: Session }) { saveSession(result.session); receive(result.room); connect() }
  async function resume(value: Session) {
    error.value = ''; session.value = value; room.value = null
    try { const state = await api<PublicRoom>(`/rooms/${value.code}`); saveSession(value); receive(state); connect(); return true }
    catch (e) {
      session.value = null; error.value = (e as Error).message
      if (errorCode(e) === 'room_not_found') forgetSession(value.code)
      return false
    }
  }
  async function command(data: Record<string, unknown>) {
    if (!connected.value || busy.value || pending.value) return
    pending.value = { ...data, roundId: room.value?.roundId, requestId: randomId() }
    localStorage.setItem(pendingKey(session.value!.code), JSON.stringify(pending.value))
    await retry()
  }
  async function retry() {
    if (!pending.value || busy.value || !session.value) return
    busy.value = true; error.value = ''
    const key = pendingKey(session.value.code)
    try {
      receive(await api<PublicRoom>(`/rooms/${session.value.code}/commands`, pending.value))
      pending.value = null
      localStorage.removeItem(key)
    } catch (e) {
      const status = errorStatus(e)
      if (status && status < 500) { pending.value = null; localStorage.removeItem(key) }
      error.value = `${(e as Error).message}${pending.value ? '，重试不会重复记分' : ''}`
    } finally { busy.value = false }
  }
  onUnmounted(() => socket?.disconnect())

  return { room, session, saved, busy, connected, error, pending, me, isHost, lastEvent, canUndo, previous, next, activeEvents, capacity,
    api, loadSaved, refreshRecent, enter, resume, disconnect, connect, command, retry }
}
