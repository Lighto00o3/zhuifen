<script setup lang="ts">
import { LABELS, type Player, type ScoreEvent } from '@zhuifen/shared'
import { clockTime } from '../utils/format'
import { signed, transferOf } from '../utils/result'

// 本场记录：每笔一行「谁 给 谁 · 多少分」，最新的在最上面。联机、单机和历史详情共用。
const props = defineProps<{ events: ScoreEvent[]; members: Player[] }>()
const rows = computed(() => [...props.events].reverse().map(event => ({ event, transfer: transferOf(event) })))
function person(id: string) { return props.members.find(p => p.id === id)?.name ?? '球友' }
</script>

<template>
  <ol class="event-list">
    <li v-for="{ event, transfer } in rows" :key="event.id" :class="{ undone: event.undoneAt }">
      <template v-if="transfer">
        <div class="event-who">{{ person(transfer.from) }}<span>给</span>{{ person(transfer.to) }}</div>
        <div class="event-points">{{ transfer.points }}<small>分</small></div>
      </template>
      <!-- 升级前的旧记录：一笔里有多人加减分，逐人列出 -->
      <template v-else>
        <div class="event-who">{{ person(event.actorId) }}</div>
        <div class="event-deltas"><span v-for="(delta, id) in event.deltas" v-show="delta !== 0" :key="id">{{ person(String(id)) }}<b :class="delta > 0 ? 'positive' : 'negative'">{{ signed(delta) }}</b></span></div>
      </template>
      <div class="event-meta"><span class="kind-tag" :class="event.kind">{{ LABELS[event.kind] }}</span><time>{{ clockTime(event.createdAt) }}</time><span v-if="event.undoneAt" class="undo-label">已撤销</span></div>
    </li>
  </ol>
</template>
