<script setup lang="ts">
const props = defineProps<{ value: number }>()
const rank = computed(() => props.value === 1 ? 'A' : props.value === 15 ? 'J' : String(props.value))
const pips = computed(() => {
  const pairs = (rows: number[]) => rows.flatMap(y => [{ x: 29, y }, { x: 71, y }])
  if (props.value === 1) return [{ x: 50, y: 50 }]
  if (props.value === 4) return pairs([28, 72])
  if (props.value === 7) return [...pairs([24, 50, 76]), { x: 50, y: 37 }]
  if (props.value === 10) return [...pairs([22, 41, 59, 78]), { x: 50, y: 31 }, { x: 50, y: 69 }]
  return [{ x: 50, y: 50 }]
})
</script>
<template>
  <span class="playing-card" aria-hidden="true">
    <span class="rank top">{{ rank }}<small>♦</small></span>
    <span class="pip-field"><span v-for="(pip, i) in pips" :key="i" class="pip" :class="{ ace: value === 1 }" :style="{ left: `${pip.x}%`, top: `${pip.y}%` }">♦</span></span>
    <span class="rank bottom">{{ rank }}<small>♦</small></span>
  </span>
</template>
<style scoped>
.playing-card { position: relative; display: block; width: 100%; height: 100%; border-radius: 10px; color: #ac4138; background: linear-gradient(125deg,#fff,#f9f8f3); box-shadow: 0 7px 14px #10261918, inset 0 0 0 1px #18271b08; }
.rank { position: absolute; font: 700 18px/1 Georgia,serif; text-align: center; }.rank small { display: block; margin-top: 2px; font-size: 10px; }.top { left: 7px; top: 7px; }.bottom { right: 7px; bottom: 7px; transform: rotate(180deg); }.pip-field { position: absolute; inset: 22px 15px; }.pip { position: absolute; transform: translate(-50%,-50%); font-size: 12px; line-height: 1; }.ace { font-size: 36px; }
</style>
