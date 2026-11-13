<script setup lang="ts">
import type { Player } from '@zhuifen/shared'
import { avatarText } from '../utils/result'

// 选收分人的选项：头像、昵称、现在的积分，右边是这一笔要给的分。联机和单机的给分弹窗共用。
const props = defineProps<{
  // 可以收分的球友
  players: Player[]
  // 同桌所有人，用来保持头像的颜色和文字与比分卡一致
  members: Player[]
  value: number
  disabled?: boolean
}>()
const emit = defineEmits<{ pick: [id: string] }>()
const seat = (id: string) => props.members.findIndex(member => member.id === id)
</script>

<template>
  <div class="recipient-actions">
    <button v-for="player in players" :key="player.id" type="button" class="recipient-option" :aria-label="`给 ${player.name} ${value} 分`" :disabled="disabled" @click="emit('pick', player.id)">
      <span class="avatar" :class="`color-${seat(player.id)}`" aria-hidden="true">{{ avatarText(player.name, members) }}</span>
      <span class="recipient-name"><b>{{ player.name }}</b><small>现在 {{ player.score }} 分</small></span>
      <span class="recipient-gain" aria-hidden="true">+{{ value }}</span>
    </button>
  </div>
</template>
