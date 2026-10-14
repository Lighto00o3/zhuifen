<script setup lang="ts">
import { loadLocalGames } from '../utils/localGame'
import { cacheOnlineGames, ONLINE_HISTORY_KEY, gameDelta, missingRounds, type HistoryGame } from '../utils/gameHistory'
import { createApi, errorCode } from '../utils/api'
import { forgetSessions, loadSessions } from '../utils/sessions'
import type { PublicRoom, RoundRecord } from '@zhuifen/shared'
useHead({ title: '历史对局 · 追分' })
const route = useRoute()
const apiOrigin = useRuntimeConfig().public.apiOrigin.replace(/\/$/, '')
const api = createApi(apiOrigin, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(12000) }))
const games = ref<HistoryGame[]>([])
const mode = ref<'all' | 'local' | 'online'>('all')
const day = ref('')
const loading = ref(true)
const error = ref('')
const selected = computed(() => games.value.find(g => g.id === route.query.id))
const dateKey = (value: string) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const filtered = computed(() => games.value.filter(g => (mode.value === 'all' || g.mode === mode.value) && (!day.value || dateKey(g.startedAt) === day.value)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)))
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
function load() {
  const all: HistoryGame[] = []
  try { all.push(...loadLocalGames(localStorage).games.filter(g => g.endedAt).map(g => ({ ...g, mode: 'local' as const }))) } catch { error.value = '部分本机记录无法读取，原数据仍保留。' }
  try { const online = JSON.parse(localStorage.getItem(ONLINE_HISTORY_KEY) ?? '[]'); if (Array.isArray(online)) all.push(...online) } catch { error.value = '部分联机历史缓存无法读取，请联网重试。' }
  games.value = all
}
onMounted(async () => {
  load()
  let failures = 0
  try {
    const sessions = loadSessions(localStorage)
    const expired = new Set<string>()
    await Promise.allSettled(sessions.map(async s => {
      try {
        const room = await api<PublicRoom>(`/rooms/${s.code}`, undefined, s.token)
        const rounds = missingRounds(localStorage, room) ? await api<RoundRecord[]>(`/rooms/${s.code}/rounds`, undefined, s.token) : []
        cacheOnlineGames(localStorage, room, rounds)
      } catch (e) {
        // 房间已被服务端清理：缓存里的历史仍保留，只是不再尝试更新。
        if (errorCode(e) === 'room_not_found') expired.add(s.code)
        else failures++
      }
    }))
    if (expired.size) forgetSessions(localStorage, sessions, expired)
    load()
    if (failures && !error.value) error.value = '部分联机房间暂时无法更新，已保存的历史仍可查看。'
  } catch { error.value = '房间凭证无法读取，已保存的历史仍可查看。' }
  finally { loading.value = false }
})
</script>
<template>
  <div class="app-shell">
    <header class="site-header"><NuxtLink class="brand" to="/"><span class="brand-ball" aria-hidden="true"><span>9</span></span>追分</NuxtLink><ThemeToggle /></header>
    <main class="room-page history-page">
      <div class="room-toolbar"><NuxtLink class="secondary home-button" :to="selected ? '/history' : '/'">{{ selected ? '← 全部历史' : '← 返回首页' }}</NuxtLink></div>
      <p v-if="error" class="error" role="status">{{ error }}</p>
      <template v-if="selected">
        <div class="room-heading"><div><h1>{{ selected.name || '这一场，收杆了' }}</h1><p>{{ date(selected.startedAt) }} · {{ selected.mode === 'online' ? `联机 #${selected.code}` : '单机记分' }}</p></div></div>
        <div class="players" :class="{ duel: selected.members.length === 2 }"><article v-for="(p, i) in selected.members" :key="p.id" class="player-card"><div class="player-top"><span class="avatar" :class="`color-${i}`">{{ p.name.slice(0, 1) }}</span><h3>{{ p.name }}</h3></div><div class="score-number" :class="{ compact: String(p.score).length > 4 }">{{ p.score }}<span>分</span></div><div class="player-bottom"><span :class="gameDelta(selected, p.id) >= 0 ? 'positive' : 'negative'">本场 {{ gameDelta(selected, p.id) > 0 ? '+' : '' }}{{ gameDelta(selected, p.id) }}</span></div></article></div>
        <ShareScore :game="selected" />
        <section class="history-panel history-detail"><div class="section-label"><h2>本场记录</h2><span>{{ selected.events.length }} 笔</span></div><p v-if="!selected.events.length" class="muted">本场没有记分。</p><ol v-else class="event-list"><li v-for="event in [...selected.events].reverse()" :key="event.id" :class="{ undone: event.undoneAt }"><div class="event-heading"><b>{{ selected.members.find(p => p.id === event.actorId)?.name }} · {{ event.label }}</b><time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time></div><div class="event-deltas"><span v-for="(delta, id) in event.deltas" v-show="delta !== 0" :key="id">{{ selected.members.find(p => p.id === id)?.name }} <b :class="delta > 0 ? 'positive' : 'negative'">{{ delta > 0 ? '+' : '' }}{{ delta }}</b></span></div><span v-if="event.undoneAt" class="undo-label">已撤销</span></li></ol></section>
      </template>
      <template v-else>
        <div class="room-heading"><div><h1>每一桌，都记得。</h1><p>查看已结束的单机和联机对局。</p></div></div>
        <div class="history-filters"><div class="mode-picker"><button v-for="(label, value) in { all: '全部', local: '单机', online: '联机' }" :key="value" :class="{ active: mode === value }" :aria-pressed="mode === value" @click="mode = value">{{ label }}</button></div><label class="field">对局日期<input v-model="day" type="date" /></label><button v-if="day" class="text-button" @click="day = ''">清除日期</button></div>
        <p v-if="loading" class="muted" role="status">正在更新联机历史…</p>
        <p v-if="!filtered.length" class="empty-history">{{ games.length ? '这个条件下没有对局，试试其他日期或模式。' : '结束一场追分后，比分和记录会出现在这里。' }}</p>
        <div class="history-games"><NuxtLink v-for="g in filtered" :key="g.id" class="history-game" :to="{ path: '/history', query: { id: g.id } }"><div class="history-game-heading"><b>{{ g.name || (g.members.length === 2 ? '双人追分' : '三人追分') }}</b><span>{{ g.mode === 'online' ? '联机' : '单机' }}</span></div><time>{{ date(g.startedAt) }}</time><div class="history-scores"><div v-for="p in g.members" :key="p.id"><span>{{ p.name }}</span><b>{{ p.score }}<small :class="gameDelta(g, p.id) >= 0 ? 'positive' : 'negative'">{{ gameDelta(g, p.id) > 0 ? '+' : '' }}{{ gameDelta(g, p.id) }}</small></b></div></div><span class="history-game-foot">{{ g.events.filter(e => !e.undoneAt).length }} 笔记分 <span>查看记录 →</span></span></NuxtLink></div>
        <p class="history-storage-note">单机记录保存在此浏览器。联机记录保存在房间中，此浏览器会缓存已查看的历史；请保留房间凭证。</p>
      </template>
    </main>
  </div>
</template>
