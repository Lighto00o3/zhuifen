<script setup lang="ts">
import type { Player } from '@zhuifen/shared'

// 三人局每一笔（包括犯规）都由给分的人选择收分的球友。
defineProps<{ label: string; value: number; players: Player[]; members: Player[]; disabled: boolean }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="give-title">
      <h2 id="give-title">这笔分给谁？</h2>
      <p>{{ label }} {{ value }} 分，从你的积分里扣。</p>
      <RecipientOptions :players="players" :members="members" :value="value" :disabled="disabled" @pick="emit('pick', $event)" />
      <button class="text-button full cancel-give" type="button" @click="emit('close')">取消给分</button>
    </section>
  </div>
</template>
