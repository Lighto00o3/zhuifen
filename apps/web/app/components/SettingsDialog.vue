<script setup lang="ts">
import { LABELS, type Rules } from '@zhuifen/shared'

// rules 由父组件持有，表单直接修改它；取消时由父组件恢复成房间当前的设置。
defineProps<{ isHost: boolean; capacity: number; rules: Rules; busy: boolean; pending: boolean; connected: boolean; error: string }>()
const emit = defineEmits<{ close: []; submit: []; retry: [] }>()
const roomName = defineModel<string>('roomName', { required: true })
const initialScore = defineModel<number>('initialScore', { required: true })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button class="close-modal" aria-label="关闭房间设置" @click="emit('close')">×</button>
      <span class="eyebrow">{{ isHost ? '开局前可以调整' : '由房主设置' }}</span>
      <h2 id="settings-title">房间与开局设置</h2>
      <p class="settings-description">{{ isHost ? '设置好房间和分值，保存后整桌同步。' : '查看本桌规则，只有房主可以修改。' }}</p>
      <form @submit.prevent="emit('submit')">
        <label class="field">房间名（选填）<input v-model="roomName" maxlength="24" placeholder="留空则只显示房间号" :disabled="!isHost || busy || pending" /></label>
        <div class="settings-grid">
          <label class="field">初始积分<input v-model.number="initialScore" type="number" min="1" max="10000" :disabled="!isHost || busy || pending" required /></label>
          <label v-for="(label, kind) in LABELS" :key="kind" class="field">{{ label }}{{ kind === 'golden9' || kind === 'dajin' ? '（每位输家）' : '' }}<input v-model.number="rules[kind]" type="number" min="1" max="100" :disabled="!isHost || busy || pending" required /></label>
        </div>
        <p class="rule-help">{{ capacity === 2 ? '所有按钮只扣自己的分、给对手加分。犯规给对手；其他按钮按赢家的普胜、小金、大金或黄金九支付一份分值。' : '所有按钮只扣自己的分。犯规自动给上家；其他按钮选择赢家给分。大金、黄金9由上下家分别给分。默认大金每人给 10 分，赢家共得 20 分；黄金9每人给 4 分，赢家共得 8 分。' }}允许积分低于零。</p>
        <p v-if="error" class="error" role="alert">{{ error }}<button v-if="pending" type="button" :disabled="busy || !connected" @click="emit('retry')">重试这笔操作</button></p>
        <div v-if="isHost" class="lobby-actions"><button class="primary full" :disabled="busy || !connected || pending" type="submit">{{ busy ? '正在保存…' : '保存设置' }}</button></div>
        <button v-else class="secondary full" type="button" @click="emit('close')">知道了</button>
      </form>
    </section>
  </div>
</template>
