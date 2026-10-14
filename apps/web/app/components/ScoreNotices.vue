<script setup lang="ts">
import type { ScoreNotice } from '../utils/roomChanges'

// 自己的积分被别人改动时的提示，最多同时显示 4 条，5 秒后消失。
const items = ref<(ScoreNotice & { id: number })[]>([])
const timers = new Set<ReturnType<typeof setTimeout>>()
let nextId = 0
function push(notice: ScoreNotice) {
  const id = ++nextId
  items.value = [...items.value, { ...notice, id }].slice(-4)
  const timeout = setTimeout(() => { items.value = items.value.filter(item => item.id !== id); timers.delete(timeout) }, 5000)
  timers.add(timeout)
}
onUnmounted(() => timers.forEach(clearTimeout))
defineExpose({ push })
</script>

<template>
  <div class="score-notices" role="status" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="score-notice">
      <div v-for="item in items" :key="item.id" class="score-notice" :class="{ loss: !item.positive }"><span aria-hidden="true">{{ item.positive ? '+' : '−' }}</span>{{ item.text }}</div>
    </TransitionGroup>
  </div>
</template>
