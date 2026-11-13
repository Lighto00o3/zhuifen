<script setup lang="ts">
import { dayKey } from '../utils/result'

// 选对局日期的日历：只有打过球的日子能点（下面有个小圆点），不用在空日子里翻找。
const props = defineProps<{
  // 每天的对局场数，键是 2026-11-14 这样的日期
  counts: Record<string, number>
}>()
const emit = defineEmits<{ close: [] }>()
const selected = defineModel<string>({ required: true })

const today = dayKey(new Date())
const days = computed(() => Object.keys(props.counts).sort())
// 打开时停在选中的那天所在的月；没选就停在最近一次打球的月份
const anchor = selected.value || days.value.at(-1) || today
const year = ref(Number(anchor.slice(0, 4)))
const month = ref(Number(anchor.slice(5, 7)))

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
const current = computed(() => monthKey(year.value, month.value))
// 只能翻到有对局的月份之间
const hasEarlier = computed(() => !!days.value[0] && days.value[0].slice(0, 7) < current.value)
const hasLater = computed(() => !!days.value.at(-1) && days.value.at(-1)!.slice(0, 7) > current.value)
const monthTotal = computed(() => days.value.filter(key => key.startsWith(current.value)).reduce((sum, key) => sum + props.counts[key]!, 0))

const cells = computed(() => {
  const blanks = new Date(year.value, month.value - 1, 1).getDay()
  const total = new Date(year.value, month.value, 0).getDate()
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: total }, (_, index) => {
      const key = `${current.value}-${String(index + 1).padStart(2, '0')}`
      return { key, date: index + 1, count: props.counts[key] ?? 0 }
    }),
  ]
})
function move(step: number) {
  const next = new Date(year.value, month.value - 1 + step, 1)
  year.value = next.getFullYear(); month.value = next.getMonth() + 1
}
function pick(key: string) {
  selected.value = key
  emit('close')
}
function clear() {
  selected.value = ''
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-title">
      <button class="close-modal" aria-label="关闭日历" @click="emit('close')">×</button>
      <div class="calendar-head">
        <h2 id="calendar-title" aria-live="polite">{{ year }}年{{ month }}月</h2>
        <div class="calendar-nav">
          <button type="button" aria-label="上个月" :disabled="!hasEarlier" @click="move(-1)">‹</button>
          <button type="button" aria-label="下个月" :disabled="!hasLater" @click="move(1)">›</button>
        </div>
      </div>
      <div class="calendar-grid">
        <span v-for="name in ['日', '一', '二', '三', '四', '五', '六']" :key="name" class="weekday" aria-hidden="true">{{ name }}</span>
        <template v-for="(cell, index) in cells" :key="index">
          <span v-if="!cell" />
          <button
            v-else type="button" class="calendar-day"
            :class="{ 'has-games': cell.count, today: cell.key === today, selected: cell.key === selected }"
            :disabled="!cell.count" :aria-pressed="cell.key === selected"
            :aria-label="`${month}月${cell.date}日${cell.count ? `，${cell.count} 场对局` : '，没有对局'}`"
            @click="pick(cell.key)"
          >{{ cell.date }}</button>
        </template>
      </div>
      <div class="calendar-foot">
        <span>{{ monthTotal ? `这个月打了 ${monthTotal} 场` : '这个月没有对局' }}</span>
        <button v-if="selected" type="button" class="text-button" @click="clear">查看全部日期</button>
      </div>
    </section>
  </div>
</template>
