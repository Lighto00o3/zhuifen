<script setup lang="ts">
const { mode, install, dismiss } = useInstallPrompt()
</script>
<template>
  <div v-if="mode" class="install-hint">
    <p><b>添加到桌面</b>下次一点就开，没网也能单机记分。</p>
    <p v-if="mode === 'ios'" class="install-steps">在 Safari 底部点「分享」<span aria-hidden="true">⬆︎</span>，再选「添加到主屏幕」。</p>
    <div class="install-actions"><button v-if="mode === 'prompt'" class="secondary" type="button" @click="install">添加</button><button class="text-button" type="button" @click="dismiss">不用了</button></div>
  </div>
</template>
<style scoped>
.install-hint { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
.install-hint p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
.install-hint b { display: block; color: var(--ink); font-size: 15px; margin-bottom: 4px; }
.install-steps { margin-top: 6px !important; }
.install-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.install-actions .secondary { min-height: 44px; padding: 0 20px; }
.install-actions > .text-button:first-child { padding-left: 0; }
</style>
