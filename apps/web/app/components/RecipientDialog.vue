<script setup lang="ts">
import type { Player } from '../../../api/src/model'

// 三人局普胜、小金等由输家选择收分的球友。
defineProps<{ label: string; value: number; players: Player[]; disabled: boolean }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="give-title">
      <h2 id="give-title">这笔分给谁？</h2>
      <p>{{ label }}：从你的积分扣 {{ value }} 分，给选中的球友。</p>
      <div class="recipient-actions">
        <button v-for="player in players" :key="player.id" class="primary full" :disabled="disabled" @click="emit('pick', player.id)">给 {{ player.name }} {{ value }} 分</button>
        <button class="secondary full" @click="emit('close')">取消给分</button>
      </div>
    </section>
  </div>
</template>
