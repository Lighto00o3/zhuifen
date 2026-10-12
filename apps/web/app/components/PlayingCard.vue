<script setup lang="ts">
const props = defineProps<{ value: number; face?: string; suit?: string }>()
const rank = computed(() => props.face ?? (props.value === 1 ? 'A' : props.value === 15 ? 'J' : String(props.value)))
const pips = computed(() => {
  const pairs = (rows: number[]) => rows.flatMap(y => [{ x: 29, y }, { x: 71, y }])
  if (props.value === 1) return [{ x: 50, y: 50 }]
  if (props.value === 2) return [{ x: 50, y: 22 }, { x: 50, y: 78 }]
  if (props.value === 3) return [{ x: 50, y: 22 }, { x: 50, y: 50 }, { x: 50, y: 78 }]
  if (props.value === 5) return [...pairs([25, 75]), { x: 50, y: 50 }]
  if (props.value === 6) return pairs([20, 50, 80])
  if (props.value === 8) return [...pairs([20, 50, 80]), { x: 50, y: 35 }, { x: 50, y: 65 }]
  if (props.value === 9) return [...pairs([15, 38, 62, 85]), { x: 50, y: 50 }]
  if (props.value === 4) return pairs([28, 72])
  if (props.value === 7) return [...pairs([24, 50, 76]), { x: 50, y: 37 }]
  if (props.value === 10) return [...pairs([22, 41, 59, 78]), { x: 50, y: 31 }, { x: 50, y: 69 }]
  return [{ x: 50, y: 50 }]
})
</script>
<template>
  <span class="playing-card" :class="{ black: suit === '♠' || suit === '♣' }" aria-hidden="true">
    <span class="rank top">{{ rank }}<small>{{ suit ?? '♦' }}</small></span>
    <span class="pip-field"><span v-for="(pip, i) in pips" :key="i" class="pip" :class="{ ace: value === 1 || value === 15 }" :style="{ left: `${pip.x}%`, top: `${pip.y}%` }">{{ value === 15 ? rank : (suit ?? '♦') }}</span></span>
    <span class="rank bottom">{{ rank }}<small>{{ suit ?? '♦' }}</small></span>
  </span>
</template>
<style scoped>
.playing-card { container-type: inline-size; position: relative; display: block; width: 100%; height: 100%; border-radius: 10px; color: #ac4138; background: linear-gradient(125deg,#fff,#f9f8f3); box-shadow: 0 7px 14px #10261918, inset 0 0 0 1px #18271b08; }
.black { color: #25382d; }
.rank { position: absolute; font: 700 clamp(12px, 24cqw, 18px)/1 Georgia,serif; text-align: center; }.rank small { display: block; margin-top: 2px; font-size: clamp(7px, 14cqw, 10px); }.top { left: 9%; top: 7%; }.bottom { right: 9%; bottom: 7%; transform: rotate(180deg); }.pip-field { position: absolute; inset: 23% 22%; }.pip { position: absolute; transform: translate(-50%,-50%); font-size: clamp(8px, 17cqw, 12px); line-height: 1; }.ace { font-size: clamp(23px, 48cqw, 36px); }
</style>
