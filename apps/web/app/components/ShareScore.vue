<script setup lang="ts">
import type { LocalGame } from '../utils/localGame'
import { gameDelta } from '../utils/gameHistory'
const props = defineProps<{ game: LocalGame }>()
const busy = ref(false)
const message = ref('')
async function share() {
  busy.value = true; message.value = ''
  try {
    const g = props.game
    const canvas = document.createElement('canvas')
    canvas.width = 720; canvas.height = 460 + g.members.length * 140
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f4f5f4'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#28654c'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('追分 · 本场战绩', 48, 70)
    ctx.fillStyle = '#202722'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(g.name || `${g.members.length === 2 ? '双人' : '三人'}追分`, 48, 136)
    ctx.fillStyle = '#727a74'; ctx.font = '22px sans-serif'; ctx.fillText(new Date(g.startedAt).toLocaleString('zh-CN', { hour12: false }), 48, 184)
    g.members.forEach((p, i) => {
      const y = 220 + i * 140, delta = gameDelta(g, p.id)
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(40, y, 640, 120, 20); ctx.fill()
      ctx.fillStyle = '#202722'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(p.name, 64, y + 46, 340)
      ctx.fillStyle = '#727a74'; ctx.font = '21px sans-serif'; ctx.fillText(`最终积分 ${p.score}`, 64, y + 87)
      ctx.fillStyle = delta >= 0 ? '#28654c' : '#ab4f41'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${delta > 0 ? '+' : ''}${delta}`, 652, y + 73); ctx.textAlign = 'left'
    })
    const bottom = 255 + g.members.length * 140
    const seconds = Math.max(0, Math.floor((Date.parse(g.endedAt ?? new Date().toISOString()) - Date.parse(g.startedAt)) / 1000))
    ctx.fillStyle = '#727a74'; ctx.font = '22px sans-serif'; ctx.fillText(`${g.events.filter(e => !e.undoneAt).length} 笔记分 · ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`, 48, bottom)
    ctx.fillStyle = '#28654c'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('好球，下次继续。', 48, bottom + 62)
    ctx.fillStyle = '#727a74'; ctx.font = '18px sans-serif'; ctx.fillText('追分 · 和球友一起记分', 48, canvas.height - 40)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('无法生成图片')), 'image/png'))
    const file = new File([blob], '追分战绩.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: '追分战绩' }); message.value = '战绩已分享' }
    else {
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000)
      message.value = '战绩图片已生成，可保存后发给球友'
    }
  } catch (e) { if ((e as Error).name !== 'AbortError') message.value = '图片生成失败，请重试' }
  finally { busy.value = false }
}
</script>
<template><div class="share-score"><button class="secondary" :disabled="busy" @click="share">{{ busy ? '正在生成…' : '分享战绩图片' }}</button><p v-if="message" role="status">{{ message }}</p></div></template>
<style scoped>.share-score { margin-top: 12px; }.share-score p { font-size: 12px; color: var(--muted); }</style>
