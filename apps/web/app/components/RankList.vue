<script setup lang="ts">
import { signed, standings, type ResultGame } from '../utils/result'

// 按本场输赢排好名次的球友列表：头像、昵称、最终积分、本场输赢。
const props = defineProps<{ game: ResultGame }>()
const list = computed(() => standings(props.game))
</script>

<template>
  <ol class="rank-list">
    <li v-for="item in list" :key="item.player.id" class="rank-row" :class="{ winner: item.rank === 1 && item.delta > 0 }">
      <span class="avatar small" :class="`color-${item.seat}`" aria-hidden="true">{{ item.player.name.slice(0, 1) }}</span>
      <span class="rank-name">{{ item.player.name }}<span v-if="item.rank === 1 && item.delta > 0" class="crown" role="img" aria-label="本场赢家">👑</span></span>
      <span class="rank-score">{{ item.player.score }}</span>
      <span class="delta-chip" :class="{ positive: item.delta > 0, negative: item.delta < 0 }">{{ signed(item.delta) }}</span>
    </li>
  </ol>
</template>
