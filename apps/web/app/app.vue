<script setup lang="ts">
const { theme, preference } = useColorTheme()
let cleanup: (() => void) | undefined
onMounted(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  const restore = () => {
    let saved: string | null = null
    try { saved = localStorage.getItem('zhuifen:theme') } catch {}
    preference.value = saved === 'light' || saved === 'dark' ? saved : null
    theme.value = preference.value ?? (system.matches ? 'dark' : 'light')
  }
  const followSystem = () => { if (!preference.value) theme.value = system.matches ? 'dark' : 'light' }
  const followTabs = (event: StorageEvent) => { if (event.key === 'zhuifen:theme' || event.key === null) restore() }
  restore()
  const stop = watch(theme, value => { document.documentElement.dataset.theme = value }, { immediate: true, flush: 'sync' })
  system.addEventListener('change', followSystem)
  window.addEventListener('storage', followTabs)
  cleanup = () => { stop(); system.removeEventListener('change', followSystem); window.removeEventListener('storage', followTabs) }
})
onBeforeUnmount(() => cleanup?.())
</script>
<template>
  <NuxtPage :page-key="route => route.fullPath" />
</template>
