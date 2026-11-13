import { withStorage } from '../utils/storage'

// 安卓 Chrome 等浏览器在可以安装时触发 beforeinstallprompt，留着它，用户点「添加」时再弹系统的安装框。
// 事件可能在首页组件挂载前就触发，所以由 plugins/pwa.client.ts 一启动就开始监听。
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const DISMISSED_KEY = 'zhuifen:install-dismissed'
const deferred = shallowRef<InstallPromptEvent | null>(null)
const installed = ref(false)

export function listenInstallPrompt() {
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred.value = event as InstallPromptEvent })
  addEventListener('appinstalled', () => { installed.value = true; deferred.value = null })
}

export function useInstallPrompt() {
  const dismissed = ref(false)
  const standalone = ref(false)
  // iOS 没有安装事件，只能提示用户在 Safari 里手动添加；微信和 iOS 上的其他浏览器不能添加，不提示。
  const iosSafari = ref(false)
  onMounted(() => {
    dismissed.value = withStorage(storage => storage.getItem(DISMISSED_KEY)) === '1'
    standalone.value = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    const ua = navigator.userAgent
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
    iosSafari.value = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|MicroMessenger/.test(ua)
  })
  const mode = computed(() => {
    if (dismissed.value || standalone.value || installed.value) return null
    if (deferred.value) return 'prompt'
    return iosSafari.value ? 'ios' : null
  })
  async function install() {
    const event = deferred.value
    if (!event) return
    deferred.value = null
    await event.prompt()
    if ((await event.userChoice).outcome === 'accepted') installed.value = true
  }
  function dismiss() {
    dismissed.value = true
    withStorage(storage => storage.setItem(DISMISSED_KEY, '1'))
  }
  return { mode, install, dismiss }
}
