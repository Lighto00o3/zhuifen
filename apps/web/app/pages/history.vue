<script setup lang="ts">
import { loadLocalGames, removeLocalGame } from '../utils/localGame'
import { cacheOnlineGames, ONLINE_HISTORY_KEY, missingRounds, type HistoryGame } from '../utils/gameHistory'
import { clockTime } from '../utils/format'
import { dayKey, dayLabel, durationText, headline, resultStats, shortDay, signed, tally } from '../utils/result'
import { createApi, credentialGone, WAKE_TIMEOUT } from '../utils/api'
import { forgetSessions, loadSessions } from '../utils/sessions'
import type { PublicRoom, RoundRecord } from '@zhuifen/shared'
useHead({ title: '历史对局 · 追分' })
const route = useRoute()
const apiOrigin = useRuntimeConfig().public.apiOrigin.replace(/\/$/, '')
// 历史页可能是服务休眠后第一个打开的页面，超时放宽到能等服务冷启动完。
const api = createApi(apiOrigin, undefined, WAKE_TIMEOUT)
const { slow: waking, track } = useSlowHint()
const games = ref<HistoryGame[]>([])
const mode = ref<'all' | 'local' | 'online'>('all')
// 选中的日期（2026-11-14），空串表示全部日期
const day = ref('')
const calendarOpen = ref(false)
const loading = ref(true)
const error = ref('')
const selected = computed(() => games.value.find(g => g.id === route.query.id))
const stats = computed(() => selected.value ? resultStats(selected.value) : undefined)
const inMode = computed(() => games.value.filter(g => mode.value === 'all' || g.mode === mode.value))
// 日历上每天的场数，跟着「全部 / 单机 / 联机」变
const counts = computed(() => {
  const result: Record<string, number> = {}
  for (const g of inMode.value) { const key = dayKey(g.startedAt); result[key] = (result[key] ?? 0) + 1 }
  return result
})
// 按天分组，最近的在前
const groups = computed(() => {
  const sorted = inMode.value.filter(g => !day.value || dayKey(g.startedAt) === day.value).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const result: { key: string; games: HistoryGame[] }[] = []
  for (const g of sorted) {
    const key = dayKey(g.startedAt)
    if (result.at(-1)?.key === key) result.at(-1)!.games.push(g)
    else result.push({ key, games: [g] })
  }
  return result
})
// 累计输赢跟着当前的筛选条件走；只有一场时和那一场的结果一样，就不显示了
const shown = computed(() => groups.value.flatMap(group => group.games))
const board = computed(() => shown.value.length > 1 ? tally(shown.value) : [])
const boardOpen = ref(false)
const deleting = ref(false)
function removeSelected() {
  if (!selected.value || selected.value.mode !== 'local') return
  try { removeLocalGame(localStorage, selected.value.id) } catch { error.value = '没能删除这场记录，请重试。'; deleting.value = false; return }
  deleting.value = false
  load()
  void navigateTo('/history')
}
const title = (g: HistoryGame) => g.name || (g.members.length === 2 ? '双人追分' : '三人追分')
// 换了模式后，选中的那天可能已经没有对局了，回到全部日期
watch(counts, value => { if (day.value && !value[day.value]) day.value = '' })
const modalOpen = computed(() => calendarOpen.value || deleting.value)
useModalFocus(modalOpen, () => { calendarOpen.value = false; deleting.value = false })
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
        const room = await track(() => api<PublicRoom>(`/rooms/${s.code}`, undefined, s.token))
        const rounds = missingRounds(localStorage, room) ? await api<RoundRecord[]>(`/rooms/${s.code}/rounds`, undefined, s.token) : []
        cacheOnlineGames(localStorage, room, rounds)
      } catch (e) {
        // 房间已被服务端清理（或凭证已失效）：缓存里的历史仍保留，只是不再尝试更新。
        if (credentialGone(e)) expired.add(s.code)
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
    <header class="site-header" :inert="modalOpen"><NuxtLink class="brand" to="/"><span class="brand-ball" aria-hidden="true"><span>9</span></span>追分</NuxtLink><ThemeToggle /></header>
    <main class="room-page history-page" :class="{ detail: !!selected }" :inert="modalOpen">
      <div class="room-toolbar"><NuxtLink class="pill" :to="selected ? '/history' : '/'"><span aria-hidden="true">‹</span>{{ selected ? '全部对局' : '首页' }}</NuxtLink></div>
      <p v-if="error" class="error" role="status">{{ error }}</p>

      <!-- 一场对局的详情 -->
      <template v-if="selected && stats">
        <div class="room-heading"><div>
          <h1>{{ title(selected) }}</h1>
          <p class="room-meta"><span>{{ dayLabel(dayKey(selected.startedAt)) }} {{ clockTime(selected.startedAt) }}</span><span>{{ selected.mode === 'online' ? `联机 #${selected.code}` : '单机记分' }}</span></p>
        </div></div>
        <div class="room-layout">
          <section class="result-card">
            <div class="result-headline"><span class="eyebrow">本场结果</span><h2>{{ headline(selected) }}</h2></div>
            <RankList :game="selected" />
            <div class="result-stats">
              <div><b>{{ stats.count }}</b><span>笔记分</span></div>
              <div><b>{{ durationText(selected.startedAt, selected.endedAt) }}</b><span>用时</span></div>
              <div><b>{{ stats.biggest ? stats.biggest.points : '—' }}</b><span>{{ stats.biggest ? `最大一笔 · ${stats.biggest.label}` : '最大一笔' }}</span></div>
            </div>
            <div class="finished-actions"><ShareScore :game="selected" primary /><span class="spacer" /><button v-if="selected.mode === 'local'" class="text-button danger-text" type="button" @click="deleting = true">删除这场</button></div>
          </section>
          <aside class="history-panel"><div class="section-label"><h2>本场记录</h2><span>{{ selected.events.length }} 笔</span></div><p v-if="!selected.events.length" class="muted">本场没有记分。</p><EventList v-else :events="selected.events" :members="selected.members" /></aside>
        </div>
      </template>

      <!-- 全部对局 -->
      <template v-else>
        <div class="history-hero"><h1>历史对局</h1><p>{{ games.length ? `一共 ${games.length} 场，每一桌都记得。` : '每一桌，都记得。' }}</p></div>
        <div v-if="games.length" class="history-filters">
          <div class="mode-picker" role="group" aria-label="对局类型"><button v-for="(label, value) in { all: '全部', local: '单机', online: '联机' }" :key="value" type="button" :class="{ active: mode === value }" :aria-pressed="mode === value" @click="mode = value">{{ label }}</button></div>
          <span class="spacer" />
          <span class="pill date-trigger" :class="{ active: !!day }">
            <button type="button" class="date-open" aria-haspopup="dialog" @click="calendarOpen = true">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M8 3v4m8-4v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
              <span class="date-label">{{ day ? shortDay(day) : '按日期找' }}</span>
            </button>
            <button v-if="day" type="button" class="clear-date" aria-label="清除日期，查看全部" @click="day = ''">×</button>
          </span>
        </div>
        <!-- 累计输赢：按昵称把当前列表里的对局加起来 -->
        <section v-if="board.length" class="tally-card" aria-labelledby="tally-title">
          <div class="section-label"><h2 id="tally-title">累计输赢</h2><span>{{ shown.length }} 场合计</span></div>
          <ol class="tally-list">
            <li v-for="(row, index) in (boardOpen ? board : board.slice(0, 3))" :key="row.name">
              <span class="tally-rank" :class="{ top: index === 0 && row.total > 0 }">{{ index + 1 }}</span>
              <span class="tally-name"><b>{{ row.name }}</b><small>{{ row.games }} 场 · 赢 {{ row.wins }} 场</small></span>
              <span class="tally-total" :class="{ positive: row.total > 0, negative: row.total < 0 }">{{ signed(row.total) }}</span>
            </li>
          </ol>
          <button v-if="board.length > 3" class="text-button full" type="button" :aria-expanded="boardOpen" @click="boardOpen = !boardOpen">{{ boardOpen ? '收起' : `查看全部 ${board.length} 位球友` }}</button>
        </section>
        <p v-if="loading" class="muted" role="status">正在更新联机对局…{{ waking ? '服务正在启动，第一次可能需要半分钟左右。' : '' }}</p>

        <section v-for="group in groups" :key="group.key" class="history-day">
          <h2>{{ dayLabel(group.key) }}<small>{{ group.games.length }} 场</small></h2>
          <div class="history-games">
            <NuxtLink v-for="g in group.games" :key="g.id" class="history-game" :to="{ path: '/history', query: { id: g.id } }">
              <div class="history-game-heading"><b>{{ title(g) }}</b><span class="chevron" aria-hidden="true">›</span></div>
              <div class="history-game-meta"><span>{{ clockTime(g.startedAt) }}</span><span>{{ g.mode === 'online' ? '联机' : '单机' }}</span><span>{{ g.events.filter(e => !e.undoneAt).length }} 笔</span><span>{{ durationText(g.startedAt, g.endedAt) }}</span></div>
              <RankList :game="g" />
            </NuxtLink>
          </div>
        </section>

        <div v-if="!groups.length && !loading" class="history-empty">
          <div class="empty-ball" aria-hidden="true">🎱</div>
          <template v-if="games.length"><h2>这里还没有对局</h2><p>换个类型看看，或者回到全部对局。</p><button class="pill" type="button" @click="mode = 'all'; day = ''">查看全部对局</button></template>
          <template v-else><h2>还没有打完的对局</h2><p>结束一场追分后，比分和每一笔记录都会留在这里。</p><NuxtLink class="primary" to="/">去开一桌</NuxtLink></template>
        </div>
        <p v-if="games.length" class="history-storage-note">单机记录只保存在这台设备的浏览器里；联机记录保存在房间里，换设备后需要重新进入房间才能看到。</p>
      </template>
    </main>
    <div v-if="deleting && selected" class="modal-backdrop" @click.self="deleting = false">
      <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">删除这场记录？</h2>
        <p>「{{ title(selected) }}」的比分和每一笔记录都会从这台设备上删掉，不能恢复。</p>
        <div class="confirm-actions"><button class="secondary" type="button" @click="deleting = false">再想想</button><button class="primary danger-solid" type="button" @click="removeSelected">确认删除</button></div>
      </section>
    </div>
    <HistoryCalendar v-if="calendarOpen" v-model="day" :counts="counts" @close="calendarOpen = false" />
  </div>
</template>
