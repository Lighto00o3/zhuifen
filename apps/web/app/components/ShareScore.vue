<script setup lang="ts">
import { drawPoster, type PosterGame } from '../utils/poster'

// 战绩海报：点按钮生成一张结算图，全屏展示。
// 微信等内置浏览器不能直接下载文件，所以海报用 <img> 显示，长按就能保存或转发；也可以直接截屏。
const props = withDefaults(defineProps<{ game: PosterGame; primary?: boolean }>(), { primary: false })
const open = ref(false)
const busy = ref(false)
const image = ref('')
const message = ref('')
const closeButton = ref<HTMLButtonElement | null>(null)
let file: File | undefined
let opener: HTMLElement | null = null

// 微信、QQ、支付宝等内置浏览器里下载和系统分享都不可用，只提示长按保存。
const embedded = computed(() => import.meta.client && /MicroMessenger|QQ\/|AlipayClient|DingTalk|Weibo/i.test(navigator.userAgent))
const canShare = ref(false)
useScrollLock(open)

async function show(event: MouseEvent) {
  if (busy.value) return
  opener = event.currentTarget as HTMLElement
  busy.value = true; message.value = ''
  try {
    const canvas = await drawPoster(props.game, location.origin)
    image.value = canvas.toDataURL('image/png')
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    file = blob ? new File([blob], '追分战绩.png', { type: 'image/png' }) : undefined
    canShare.value = !embedded.value && !!file && !!navigator.canShare?.({ files: [file] })
    open.value = true
    await nextTick()
    closeButton.value?.focus()
  } catch { message.value = '海报生成失败，请重试' }
  finally { busy.value = false }
}
function close() {
  open.value = false
  message.value = ''
  void nextTick(() => opener?.focus())
}
async function share() {
  if (!file) return
  try { await navigator.share({ files: [file], title: '追分战绩' }) }
  catch (e) { if ((e as Error).name !== 'AbortError') message.value = '没能打开分享，可以长按图片保存' }
}
function save() {
  const link = document.createElement('a')
  link.href = image.value; link.download = '追分战绩.png'; link.click()
  message.value = '已保存到下载目录'
}
function keys(event: KeyboardEvent) { if (open.value && event.key === 'Escape') { event.preventDefault(); close() } }
onMounted(() => window.addEventListener('keydown', keys))
onUnmounted(() => window.removeEventListener('keydown', keys))
</script>

<template>
  <button :class="primary ? 'primary' : 'secondary'" type="button" :disabled="busy" @click="show">{{ busy ? '正在生成…' : '生成战绩海报' }}</button>
  <p v-if="message && !open" class="muted" role="status">{{ message }}</p>
  <Teleport to="body">
    <div v-if="open" class="poster-backdrop" role="dialog" aria-modal="true" aria-label="战绩海报" @click.self="close">
      <button ref="closeButton" class="poster-close" type="button" aria-label="关闭海报" @click="close">×</button>
      <div class="poster-frame"><img :src="image" alt="本场战绩海报，包含每位球友的最终积分和本场输赢" /></div>
      <div class="poster-actions">
        <p role="status">{{ message || (embedded ? '长按图片，保存到手机或发给球友' : '长按图片可保存，也可以直接截屏') }}</p>
        <div v-if="!embedded" class="poster-buttons">
          <button v-if="canShare" class="poster-button solid" type="button" @click="share">分享给球友</button>
          <button class="poster-button" :class="{ solid: !canShare }" type="button" @click="save">保存图片</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.poster-backdrop { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: max(56px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom)); background: #050d0bd9; backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%); animation: poster-fade .25s both; }
.poster-close { position: absolute; top: max(14px, env(safe-area-inset-top)); right: 16px; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #ffffff24; color: #fff; font-size: 22px; line-height: 1; }
.poster-close:hover { background: #ffffff38; }
/* 海报本身：从下方弹起，再扫过一道光 */
.poster-frame { position: relative; flex: 0 1 auto; min-height: 0; max-width: min(420px, 100%); overflow: hidden; border-radius: 22px; box-shadow: 0 30px 80px #000000a6, 0 0 0 1px #ffffff1a; animation: poster-rise .6s cubic-bezier(.2, .9, .2, 1) both; }
.poster-frame img { display: block; width: auto; max-width: 100%; height: auto; max-height: calc(100dvh - 210px); -webkit-touch-callout: default; user-select: auto; }
.poster-frame::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 40%, #ffffff40 50%, transparent 60%); transform: translateX(-120%); animation: poster-shine 1.1s .45s ease-out both; pointer-events: none; }
.poster-actions { width: min(420px, 100%); text-align: center; animation: poster-fade .4s .3s both; }
.poster-actions p { margin: 0 0 12px; color: #ffffffb3; font-size: 14px; line-height: 1.6; }
.poster-buttons { display: flex; gap: 10px; }
.poster-button { flex: 1; min-height: 50px; border-radius: 14px; background: #ffffff24; color: #fff; font-size: 16px; font-weight: 600; }
.poster-button:hover { background: #ffffff38; }
.poster-button.solid { background: #f0d28a; color: #2a3126; }
.poster-button.solid:hover { background: #f6dea3; }
@keyframes poster-fade { from { opacity: 0; } }
@keyframes poster-rise { from { opacity: 0; transform: translateY(40px) scale(.94); } }
@keyframes poster-shine { to { transform: translateX(120%); } }
</style>
