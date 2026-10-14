<script setup lang="ts">
import QRCode from 'qrcode'

const props = defineProps<{ code: string; roomName?: string }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const link = new URL(router.resolve({ path: '/room', query: { room: props.code } }).href, location.origin).href
// 二维码生成前先用透明占位图撑住尺寸，避免弹窗跳动。
const qr = ref('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')
const notice = ref('')
QRCode.toDataURL(link, { width: 240, margin: 2, color: { dark: '#173c2e', light: '#ffffff' } }).then(value => { qr.value = value }, () => {})
async function copy() {
  try { await navigator.clipboard.writeText(link); notice.value = '邀请链接已复制' }
  catch { notice.value = '长按下方链接即可复制' }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <button class="close-modal" aria-label="关闭邀请" @click="emit('close')">×</button>
      <span class="eyebrow">给球友留个位置</span>
      <h2 id="invite-title">扫码，加入这一桌</h2>
      <p>球友用自己的手机扫码打开</p>
      <img :src="qr" alt="加入房间的二维码" width="240" height="240" />
      <p v-if="roomName" class="invite-room-name">{{ roomName }}</p>
      <div class="invite-code">{{ code }}</div>
      <p>也可以在首页输入房间号加入</p>
      <input class="share-link" :value="link" aria-label="邀请链接" readonly @focus="($event.target as HTMLInputElement).select()" />
      <button class="primary full" @click="copy">复制邀请链接 ↗</button>
      <p v-if="notice" role="status">{{ notice }}</p>
    </section>
  </div>
</template>
