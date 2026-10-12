<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ action?: string }>(), { action: '调整' })
const open = ref(false)
const id = useId()
async function revealInvalid(event: Event) {
  if (open.value || !(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  const input = event.target
  open.value = true
  await nextTick()
  input.reportValidity()
}
</script>

<template>
  <section class="disclosure" :class="{ 'is-open': open }">
    <button :id="`${id}-toggle`" type="button" class="disclosure-toggle" :aria-expanded="open" :aria-controls="id" @click="open = !open">
      <span class="disclosure-title"><slot name="title" /></span>
      <span class="disclosure-action">{{ open ? '收起' : action }}<span class="disclosure-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></span></span>
    </button>
    <div :id="id" class="disclosure-body" @invalid.capture="revealInvalid" :inert="!open" :aria-hidden="!open" :aria-labelledby="`${id}-toggle`" role="region">
      <div class="disclosure-clip"><div class="disclosure-content"><slot /></div></div>
    </div>
  </section>
</template>

<style scoped>
.disclosure-toggle { width: 100%; min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; color: inherit; background: transparent; text-align: left; border-radius: 12px; }
.disclosure-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: 15px; font-weight: 600; }
.disclosure-action { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--green); font-size: 12px; font-weight: 500; }
.disclosure-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); transition: background .2s, transform .32s cubic-bezier(.2,.8,.2,1); }
.disclosure-icon svg { width: 20px; height: 20px; }
.is-open .disclosure-icon { transform: rotate(180deg); background: var(--accent-soft); }
.disclosure-toggle:active .disclosure-icon { background: var(--control); }
.disclosure-body { display: grid; grid-template-rows: 0fr; visibility: hidden; opacity: 0; transition: grid-template-rows .32s cubic-bezier(.2,.8,.2,1), opacity .2s, visibility .32s; }
.is-open .disclosure-body { grid-template-rows: 1fr; visibility: visible; opacity: 1; }
.disclosure-clip { min-height: 0; overflow: hidden; }
.disclosure-content { padding: 6px 0 20px; }
@media (prefers-reduced-motion: reduce) { .disclosure-body, .disclosure-icon { transition: none; } }
</style>
