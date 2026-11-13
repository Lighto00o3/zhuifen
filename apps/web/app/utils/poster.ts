import QRCode from 'qrcode'
import { headline, resultStats, signed, standings, winners, type ResultGame } from './result'

// 战绩海报：把一场对局的结果画成一张竖版图片（深绿球台 + 金色赢家），用来截屏或保存后发给球友。
// 只包含昵称、比分、日期、笔数和用时，不包含房间凭证。
export interface PosterGame extends ResultGame { name: string }

const WIDTH = 1080
const PAD = 72
const TEXT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif'
const NUM = `ui-rounded, "SF Pro Rounded", "Avenir Next", "DIN Alternate", ${TEXT}`
const GOLD = '#f0d28a'
const WHITE = '#ffffff'
const DIM = 'rgba(255,255,255,.62)'
const FAINT = 'rgba(255,255,255,.4)'
const RED = '#ffb0a3'
const AVATARS = [['#d6ecdf', '#1d5a45'], ['#f3dc91', '#6a5215'], ['#c9e2ee', '#2c5a70']] as const

type Ctx = CanvasRenderingContext2D

// 文字太长时截断并加省略号，保证不超出给定宽度。
function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
// 品牌的 9 号球
function nineBall(ctx: Ctx, cx: number, cy: number, r: number, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = '#fbfaf4'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.fillStyle = '#f2bd0c'; ctx.fillRect(cx - r, cy - r * .5, r * 2, r)
  const shade = ctx.createRadialGradient(cx - r * .4, cy - r * .5, r * .1, cx, cy, r * 1.1)
  shade.addColorStop(0, 'rgba(255,255,255,.55)'); shade.addColorStop(.5, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(60,40,0,.28)')
  ctx.fillStyle = shade; ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.beginPath(); ctx.arc(cx, cy, r * .5, 0, Math.PI * 2); ctx.fillStyle = '#fffef8'; ctx.fill()
  ctx.fillStyle = '#22221e'; ctx.font = `800 ${r * .78}px ${TEXT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('9', cx, cy + r * .04)
  ctx.restore()
}
// 赢家头上的皇冠（不用 emoji，各家手机画出来不一样）
function crown(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = GOLD
  ctx.beginPath()
  ctx.moveTo(0, size * .82); ctx.lineTo(-size * .08, size * .2); ctx.lineTo(size * .26, size * .5)
  ctx.lineTo(size * .5, 0); ctx.lineTo(size * .74, size * .5); ctx.lineTo(size * 1.08, size * .2); ctx.lineTo(size, size * .82)
  ctx.closePath(); ctx.fill()
  for (const [cx, cy] of [[-size * .08, size * .16], [size * .5, -size * .04], [size * 1.08, size * .16]] as const) { ctx.beginPath(); ctx.arc(cx, cy, size * .08, 0, Math.PI * 2); ctx.fill() }
  roundRect(ctx, 0, size * .9, size, size * .12, size * .06); ctx.fill()
  ctx.restore()
}
// 赢家身后的光芒和彩屑。位置是固定算出来的，同一场每次生成的海报都一样。
function celebrate(ctx: Ctx, cx: number, cy: number) {
  ctx.save()
  const rays = 18
  for (let i = 0; i < rays; i++) {
    const angle = (Math.PI * 2 * i) / rays - Math.PI / 2
    const spread = Math.PI / rays * .42
    const glow = ctx.createRadialGradient(cx, cy, 90, cx, cy, 470)
    glow.addColorStop(0, 'rgba(240,210,138,.13)'); glow.addColorStop(1, 'rgba(240,210,138,0)')
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 470, angle - spread, angle + spread); ctx.closePath(); ctx.fill()
  }
  const colors = ['#f0d28a', '#ffffff', '#9fe0c0', '#f7e6b0']
  for (let i = 0; i < 34; i++) {
    // 简单的伪随机：只和序号有关
    const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123
    const rx = a - Math.floor(a), ry = b - Math.floor(b)
    const side = i % 2 ? 1 : -1
    const x = cx + side * (190 + rx * 250), y = cy - 190 + ry * 330
    ctx.save()
    ctx.translate(x, y); ctx.rotate(rx * Math.PI)
    ctx.globalAlpha = .35 + ry * .5
    ctx.fillStyle = colors[i % colors.length]!
    if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, 5 + rx * 4, 0, Math.PI * 2); ctx.fill() }
    else { roundRect(ctx, -9, -3.5, 18, 7, 3.5); ctx.fill() }
    ctx.restore()
  }
  ctx.restore()
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

export async function drawPoster(game: PosterGame, siteUrl: string): Promise<HTMLCanvasElement> {
  const list = standings(game)
  const top = winners(game)
  const stats = resultStats(game)
  const rowHeight = 136, rowGap = 16
  const rowsTop = 836
  const statsTop = rowsTop + list.length * (rowHeight + rowGap) + 28
  const footerTop = statsTop + 190
  const height = footerTop + 250

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH; canvas.height = height
  const ctx = canvas.getContext('2d')!

  // 背景：深绿台呢 + 顶部一束灯光
  const felt = ctx.createLinearGradient(0, 0, WIDTH * .3, height)
  felt.addColorStop(0, '#12493d'); felt.addColorStop(.55, '#0c352d'); felt.addColorStop(1, '#082420')
  ctx.fillStyle = felt; ctx.fillRect(0, 0, WIDTH, height)
  const light = ctx.createRadialGradient(WIDTH / 2, 380, 40, WIDTH / 2, 380, 760)
  light.addColorStop(0, 'rgba(120,220,180,.30)'); light.addColorStop(.5, 'rgba(120,220,180,.08)'); light.addColorStop(1, 'rgba(120,220,180,0)')
  ctx.fillStyle = light; ctx.fillRect(0, 0, WIDTH, height)
  // 球台内沿的细线
  ctx.strokeStyle = 'rgba(240,210,138,.22)'; ctx.lineWidth = 2
  roundRect(ctx, 28, 28, WIDTH - 56, height - 56, 56); ctx.stroke()
  // 右上角露出半个 9 号球做装饰，不超出内沿
  ctx.save()
  roundRect(ctx, 29, 29, WIDTH - 58, height - 58, 55); ctx.clip()
  nineBall(ctx, WIDTH - 60, 96, 190, .13)
  ctx.restore()

  // 顶部：品牌
  nineBall(ctx, PAD + 30, 118, 30)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  ctx.fillStyle = WHITE; ctx.font = `700 40px ${TEXT}`; ctx.fillText('追分', PAD + 76, 120)

  // 标题：房间名 + 人数、日期、时间
  const started = new Date(game.startedAt)
  const mode = `${game.members.length === 2 ? '双人' : '三人'}追分`
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = GOLD; ctx.font = `600 32px ${TEXT}`; ctx.fillText('本场战绩', PAD, 240)
  ctx.fillStyle = WHITE; ctx.font = `700 76px ${TEXT}`
  ctx.fillText(fit(ctx, game.name || mode, WIDTH - PAD * 2), PAD, 332)
  ctx.fillStyle = DIM; ctx.font = `400 30px ${TEXT}`
  ctx.fillText(`${game.name ? `${mode} · ` : ''}${started.getFullYear()}年${started.getMonth() + 1}月${started.getDate()}日 ${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`, PAD, 386)

  // 赢家
  ctx.textAlign = 'center'
  if (top.length) {
    celebrate(ctx, WIDTH / 2, 632)
    crown(ctx, WIDTH / 2 - 36, 452, 72)
    ctx.fillStyle = WHITE; ctx.font = `700 64px ${TEXT}`
    ctx.fillText(fit(ctx, top.map(item => item.player.name).join('、'), WIDTH - PAD * 2), WIDTH / 2, 612)
    const win = ctx.createLinearGradient(0, 642, 0, 792)
    win.addColorStop(0, '#fff1c4'); win.addColorStop(1, '#e0b85a')
    ctx.fillStyle = win; ctx.font = `700 150px ${NUM}`
    ctx.fillText(signed(top[0]!.delta), WIDTH / 2, 772)
  } else {
    ctx.fillStyle = WHITE; ctx.font = `700 84px ${TEXT}`; ctx.fillText('打平了', WIDTH / 2, 632)
    ctx.fillStyle = DIM; ctx.font = `400 36px ${TEXT}`; ctx.fillText('谁也没占到便宜，下次再战', WIDTH / 2, 712)
  }

  // 名次
  list.forEach((item, index) => {
    const y = rowsTop + index * (rowHeight + rowGap)
    const first = item.rank === 1 && item.delta > 0
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, rowHeight, 36)
    ctx.fillStyle = first ? 'rgba(240,210,138,.16)' : 'rgba(255,255,255,.08)'; ctx.fill()
    if (first) { ctx.strokeStyle = 'rgba(240,210,138,.5)'; ctx.lineWidth = 2; ctx.stroke() }
    const mid = y + rowHeight / 2
    ctx.textBaseline = 'middle'
    // 名次数字
    ctx.textAlign = 'center'; ctx.fillStyle = first ? GOLD : FAINT; ctx.font = `700 44px ${NUM}`
    ctx.fillText(String(item.rank), PAD + 52, mid + 2)
    // 头像
    const [bg, fg] = AVATARS[item.seat % AVATARS.length]!
    ctx.beginPath(); ctx.arc(PAD + 134, mid, 36, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill()
    ctx.fillStyle = fg; ctx.font = `600 32px ${TEXT}`; ctx.fillText(item.player.name.slice(0, 1), PAD + 134, mid + 2)
    // 本场输赢（右侧大数字）
    ctx.textAlign = 'right'; ctx.font = `700 60px ${NUM}`
    ctx.fillStyle = item.delta > 0 ? GOLD : item.delta < 0 ? RED : DIM
    const deltaText = signed(item.delta)
    ctx.fillText(deltaText, WIDTH - PAD - 36, mid + 2)
    const deltaWidth = ctx.measureText(deltaText).width
    // 昵称 + 最终积分
    ctx.textAlign = 'left'
    ctx.fillStyle = WHITE; ctx.font = `600 40px ${TEXT}`
    ctx.fillText(fit(ctx, item.player.name, WIDTH - PAD * 2 - 196 - 36 - deltaWidth - 40), PAD + 196, mid - 20)
    ctx.fillStyle = DIM; ctx.font = `400 28px ${TEXT}`
    ctx.fillText(`最终 ${item.player.score} 分`, PAD + 196, mid + 28)
  })

  // 统计
  const cells: [string, string][] = [[String(stats.count), '笔记分'], [stats.duration.replace(/\s/g, ''), '用时'], stats.biggest ? [`${stats.biggest.points}`, `最大一笔 · ${stats.biggest.label}`] : ['—', '最大一笔']]
  const cellWidth = (WIDTH - PAD * 2) / cells.length
  cells.forEach(([value, label], index) => {
    const cx = PAD + cellWidth * index + cellWidth / 2
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = WHITE; ctx.font = `700 ${value.length > 5 ? 44 : 56}px ${NUM}`; ctx.fillText(value, cx, statsTop + 70)
    ctx.fillStyle = DIM; ctx.font = `400 28px ${TEXT}`; ctx.fillText(label, cx, statsTop + 118)
    if (index) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(PAD + cellWidth * index, statsTop + 24, 2, 90) }
  })

  // 底部：一句话 + 二维码
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(PAD, footerTop, WIDTH - PAD * 2, 2)
  const qrSize = 132
  let textRight = WIDTH - PAD
  try {
    const qr = await loadImage(await QRCode.toDataURL(siteUrl, { width: qrSize * 2, margin: 1, color: { dark: '#0c352d', light: '#ffffff' } }))
    roundRect(ctx, WIDTH - PAD - qrSize - 16, footerTop + 44, qrSize + 16, qrSize + 16, 20); ctx.fillStyle = WHITE; ctx.fill()
    ctx.drawImage(qr, WIDTH - PAD - qrSize - 8, footerTop + 52, qrSize, qrSize)
    textRight = WIDTH - PAD - qrSize - 56
  } catch { /* 二维码画不出来不影响海报本身 */ }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = WHITE; ctx.font = `600 40px ${TEXT}`
  ctx.fillText(fit(ctx, top.length ? headline(game) : '好球，下次继续', textRight - PAD), PAD, footerTop + 104)
  ctx.fillStyle = DIM; ctx.font = `400 28px ${TEXT}`
  ctx.fillText('扫码开一桌，和球友一起追分', PAD, footerTop + 158)
  return canvas
}
