<script setup lang="ts">
export type ConfirmAction = 'end' | 'undo' | 'close' | 'restart'

const TEXT: Record<ConfirmAction, { title: string; body: string; confirm: string }> = {
  restart: { title: '同一桌，再开一局？', body: '沿用球友、座位和规则，上一场比分和记录会保留。', confirm: '开始下一局' },
  undo: { title: '撤销上一笔记分？', body: '这一笔的所有积分变化会一起还原，记录保留并标记为已撤销。', confirm: '确认撤销' },
  close: { title: '关闭这个房间？', body: '关闭后无法加入或开局，所有球友都会看到房间已关闭。', confirm: '确认关闭' },
  end: { title: '结束这场追分？', body: '结束后保留比分和操作记录，房主可以再开下一局。', confirm: '确认结束' },
}
defineProps<{ action: ConfirmAction; initialScore?: number }>()
const emit = defineEmits<{ confirm: []; close: [] }>()
// 再开一局时是否沿用上一场的积分。
const carry = defineModel<boolean>('carry', { default: false })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">{{ TEXT[action].title }}</h2>
      <p>{{ TEXT[action].body }}</p>
      <div v-if="action === 'restart'" class="rematch-options">
        <button class="secondary full" :aria-pressed="!carry" @click="carry = false">重置积分 · 每人 {{ initialScore }} 分</button>
        <button class="secondary full" :aria-pressed="carry" @click="carry = true">接着上一场的积分</button>
      </div>
      <div class="confirm-actions"><button class="secondary" @click="emit('close')">再想想</button><button class="primary" @click="emit('confirm')">{{ TEXT[action].confirm }}</button></div>
    </section>
  </div>
</template>
