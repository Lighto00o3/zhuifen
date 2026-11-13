<script setup lang="ts">
import QRCode from 'qrcode'

// 等球友上桌时直接显示的邀请卡片：二维码、房间号、复制链接。不用再点一次按钮才看到二维码。
const props = defineProps<{ code: string; missing: number; capacity: number }>()
const router = useRouter()
const link = new URL(router.resolve({ path: '/room', query: { room: props.code } }).href, location.origin).href
// 二维码生成前先用透明占位图撑住尺寸，避免卡片跳动。
const qr = ref('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')
const notice = ref('')
const canShare = ref(false)
QRCode.toDataURL(link, { width: 400, margin: 1, color: { dark: '#12392f', light: '#ffffff' } }).then(value => { qr.value = value }, () => {})
onMounted(() => { canShare.value = typeof navigator.share === 'function' && !/MicroMessenger|QQ\/|AlipayClient|DingTalk/i.test(navigator.userAgent) })
let timer: ReturnType<typeof setTimeout> | undefined
function say(text: string) {
  notice.value = text
  clearTimeout(timer)
  timer = setTimeout(() => { notice.value = '' }, 2500)
}
async function copy() {
  try { await navigator.clipboard.writeText(link); say('链接已复制，发给球友就能加入') }
  catch { say('没能自动复制，请长按下面的链接复制') }
}
async function share() {
  try { await navigator.share({ title: '来追分', text: `加入我的追分房间 ${props.code}`, url: link }) }
  catch (e) { if ((e as Error).name !== 'AbortError') await copy() }
}
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <section class="invite-panel" aria-labelledby="invite-title">
    <h2 id="invite-title">扫码，加入这一桌</h2>
    <p>还差 {{ missing }} 位球友，{{ capacity === 2 ? '两人' : '三人' }}到齐后自动开始追分。</p>
    <img :src="qr" alt="加入房间的二维码" width="200" height="200" />
    <div class="invite-code" aria-label="房间号">{{ code }}</div>
    <p class="invite-hint">或者在首页「加入房间」里输入这个房间号</p>
    <input class="share-link" :value="link" aria-label="邀请链接" readonly @focus="($event.target as HTMLInputElement).select()" />
    <div class="invite-buttons">
      <button v-if="canShare" class="primary" type="button" @click="share">发给球友</button>
      <button :class="canShare ? 'secondary' : 'primary'" type="button" @click="copy">复制邀请链接</button>
    </div>
    <p class="invite-notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.invite-panel { background: var(--surface); border-radius: var(--r-xl); padding: 28px 24px 16px; text-align: center; }
.invite-panel h2 { font-size: 22px; }
.invite-panel p { margin-top: 6px; color: var(--muted); font-size: 14px; line-height: 1.6; }
.invite-panel img { display: block; width: 200px; height: 200px; margin: 18px auto 12px; padding: 8px; border-radius: var(--r-m); background: #fff; box-shadow: 0 0 0 1px var(--line); }
.invite-hint { margin-top: 0 !important; font-size: 13px !important; }
.share-link { height: 44px; margin: 16px 0 10px; font-size: 13px; text-align: center; color: var(--muted); }
.invite-buttons { display: flex; gap: 10px; }
.invite-buttons button { flex: 1; padding: 0 12px; }
.invite-notice { min-height: 22px; margin-top: 8px !important; font-size: 13px !important; color: var(--green) !important; }
@media (max-width: 760px) { .invite-panel { padding: 22px 18px 12px; border-radius: var(--r-l); } .invite-panel img { width: 184px; height: 184px; } }
</style>
