<script setup lang="ts">
// 数字变化时滚动过渡到新的值（比分加减时用）。第一次显示不做动画；系统设置了「减少动态效果」时直接跳到新值。
const props = defineProps<{ value: number }>()
const shown = ref(props.value)
let frame: number | undefined

watch(() => props.value, (to, from) => {
  if (!import.meta.client) { shown.value = to; return }
  if (frame) cancelAnimationFrame(frame)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) { shown.value = to; return }
  const start = performance.now(), origin = shown.value ?? from
  // 差得越多滚得越久，但最长不超过 0.7 秒
  const duration = Math.min(700, 260 + Math.abs(to - origin) * 22)
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration)
    // 先快后慢
    shown.value = Math.round(origin + (to - origin) * (1 - (1 - progress) ** 3))
    frame = progress < 1 ? requestAnimationFrame(step) : undefined
  }
  frame = requestAnimationFrame(step)
})
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame) })
</script>

<template>{{ shown }}</template>
