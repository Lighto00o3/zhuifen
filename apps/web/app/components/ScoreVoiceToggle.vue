<script setup lang="ts">
defineProps<{ supported: boolean; enabled: boolean; ready: boolean; error: string }>()
defineEmits<{ toggle: []; test: [] }>()
</script>

<template>
  <ClientOnly>
    <div class="score-voice">
      <button type="button" class="voice-toggle" :class="{ active: enabled && ready }" :disabled="!supported" :aria-pressed="enabled && ready" :title="supported ? '只播报得分类型，联机仅在自己收分时播报' : '当前浏览器不支持语音播报'" @click="$emit('toggle')">{{ !supported ? '语音不可用' : enabled && ready ? '语音已开' : enabled ? '点击启用语音' : '开启语音' }}</button>
      <button v-if="supported && enabled" type="button" class="voice-test" @click="$emit('test')">试听</button>
      <span v-if="error" class="voice-error" role="status">{{ error }}</span>
    </div>
  </ClientOnly>
</template>

<style scoped>
.score-voice { display: flex; align-items: center; gap: 4px; position: relative; flex-shrink: 0; }
.voice-toggle, .voice-test { min-height: 36px; padding: 8px; border-radius: var(--r-s); background: var(--control); font-size: 12px; }
.voice-toggle.active { background: var(--own); color: var(--primary); }
.voice-toggle:hover, .voice-test:hover { background: var(--control-hover); }
.voice-test { background: transparent; color: var(--muted); }
.voice-error { position: absolute; top: calc(100% + 8px); right: 0; z-index: 10; width: 220px; padding: 12px; border-radius: var(--r-s); background: var(--surface); color: var(--negative); box-shadow: var(--shadow-pop); font-size: 12px; }
</style>
