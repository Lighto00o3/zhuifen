<script setup lang="ts">
const { theme, toggleTheme } = useColorTheme()
</script>
<template>
  <ClientOnly>
    <button class="theme-toggle" type="button" :aria-label="theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'" :title="theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'" @click="toggleTheme">
      <span class="theme-icon" :class="{ dark: theme === 'dark' }" aria-hidden="true"><svg v-if="theme === 'light'" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg v-else viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg></span>
      <span>{{ theme === 'dark' ? '夜间' : '白天' }}</span>
    </button>
    <template #fallback><span class="theme-toggle theme-placeholder" aria-hidden="true" /></template>
  </ClientOnly>
</template>
<style scoped>
.theme-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 80px; height: 44px; padding: 0 12px; flex-shrink: 0; background: var(--control); color: var(--ink); border-radius: 22px; font-size: 12px; font-weight: 500; }
.theme-icon { display: inline-grid; place-items: center; width: 20px; height: 20px; transition: transform .35s cubic-bezier(.2,.8,.2,1); }.theme-icon.dark { transform: rotate(-15deg); }.theme-icon svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.theme-toggle:active .theme-icon { transform: scale(.8) rotate(25deg); }.theme-placeholder { opacity: .5; }
@media (max-width:360px) { .theme-toggle { min-width: 70px; padding: 0 9px; gap: 5px; } }
@media (prefers-reduced-motion:reduce) { .theme-icon { transition: none; } }
</style>
