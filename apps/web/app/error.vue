<script setup lang="ts">
import type { NuxtError } from '#app'

// 打开了不存在的地址，或者页面出错时显示。
const props = defineProps<{ error: NuxtError }>()
const missing = computed(() => props.error.statusCode === 404)
useHead({ title: missing.value ? '页面不存在 · 追分' : '出了点问题 · 追分' })
const home = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="app-shell">
    <header class="site-header"><a class="brand" href="/" @click.prevent="home"><span class="brand-ball" aria-hidden="true"><span>9</span></span>追分</a></header>
    <main class="error-page">
      <div class="empty-ball" aria-hidden="true">🎱</div>
      <h1>{{ missing ? '这一杆打空了' : '出了点问题' }}</h1>
      <p>{{ missing ? '这个页面不存在，可能是链接不完整。' : '页面没能正常打开，请回首页再试一次。' }}</p>
      <button class="primary" type="button" @click="home">回首页</button>
    </main>
  </div>
</template>

<style scoped>
.error-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 0 120px; }
.empty-ball { display: grid; place-items: center; width: 72px; height: 72px; margin-bottom: 20px; border-radius: 50%; background: var(--surface); font-size: 32px; }
h1 { font-size: 32px; }
p { margin: 10px 0 24px; color: var(--muted); font-size: 16px; line-height: 1.6; }
</style>
