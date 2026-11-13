import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 测构建好的静态站点（见 playwright.pwa.config.ts），不在开发服务器上跑。
const OUTPUT = 'apps/web/.output/public'
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800323d) NetType/WIFI Language/zh_CN'

const cached = (page: Page) => page.evaluate(async () => (await (await caches.open('zhuifen-v1')).keys()).map(request => new URL(request.url).pathname))
async function install(page: Page) {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

test('可以添加到主屏幕：manifest、图标、状态栏颜色跟着白天/夜间模式', async ({ page }) => {
  await page.goto('/')
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json())
  expect(manifest).toMatchObject({ short_name: '追分', start_url: '/', display: 'standalone' })
  for (const src of [...manifest.icons.map((icon: { src: string }) => icon.src), '/apple-touch-icon.png']) {
    expect(await page.evaluate(async path => (await fetch(path)).headers.get('content-type'), src)).toBe('image/png')
  }
  const themeColor = page.locator('meta[name="theme-color"]')
  await expect(themeColor).toHaveCount(1)
  const before = await themeColor.getAttribute('content')
  await page.getByRole('button', { name: /切换到/ }).click()
  await expect(themeColor).not.toHaveAttribute('content', before!)
})

test('没网时：打开过和没打开过的页面都能显示，单机记分能用；接口请求不会用缓存顶替', async ({ page, context }) => {
  await install(page)
  // 安装时就存好了各个页面和这次发布的全部脚本、样式。
  const precache = JSON.parse(readFileSync(`${OUTPUT}/sw.js`, 'utf8').match(/const PRECACHE = (\[.*?\]);/)![1]) as string[]
  expect(precache.length).toBeGreaterThan(10)
  expect(await cached(page)).toEqual(expect.arrayContaining([...precache, '/local', '/history']))

  await context.setOffline(true)
  await page.goto('/local?new=1')
  // 昵称不用填，直接开局。
  await page.getByRole('button', { name: '开始单机记分' }).click()
  await expect(page.locator('.score-number')).toHaveText(['100分', '100分', '100分'])
  await page.goto('/history')
  await expect(page.getByRole('heading', { name: '历史对局' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /开一桌/ })).toBeVisible()
  expect(await page.evaluate(() => fetch('/api/health').then(() => 'resolved', () => 'rejected'))).toBe('rejected')

  await context.setOffline(false)
  const [api] = await Promise.all([page.waitForResponse('**/api/health'), page.evaluate(() => fetch('/api/health'))])
  expect(api.fromServiceWorker()).toBe(false)
  expect(api.status()).toBe(502)
  expect((await cached(page)).filter(path => path.startsWith('/api/') || path.startsWith('/socket.io/') || path.startsWith('/_nuxt/builds/'))).toEqual([])
})

test('发布新版本后：页面马上是新的，Service Worker 自动更新并删掉旧文件', async ({ page }) => {
  await install(page)
  const sw = readFileSync(`${OUTPUT}/sw.js`, 'utf8')
  const html = readFileSync(`${OUTPUT}/index.html`, 'utf8')
  const removed = (JSON.parse(sw.match(/const PRECACHE = (\[.*?\]);/)![1]) as string[])[0]!
  expect(await cached(page)).toContain(removed)
  try {
    // 模拟新发布：清单里少了一个文件，首页 HTML 也变了。
    writeFileSync(`${OUTPUT}/sw.js`, sw.replace(`"${removed}",`, ''))
    writeFileSync(`${OUTPUT}/index.html`, html.replace('<title>', '<meta name="release" content="next"><title>'))
    await page.reload()
    await expect(page.locator('meta[name="release"]')).toHaveCount(1)
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(registration => registration?.update()))
    await expect.poll(() => cached(page)).not.toContain(removed)
  } finally {
    writeFileSync(`${OUTPUT}/sw.js`, sw)
    writeFileSync(`${OUTPUT}/index.html`, html)
  }
})

test('iPhone Safari 提示手动添加到主屏幕，点「不用了」后不再提示；微信里不提示', async ({ browser }) => {
  const safari = await (await browser.newContext({ userAgent: IPHONE_SAFARI })).newPage()
  await safari.goto('/')
  await expect(safari.getByText('再选「添加到主屏幕」')).toBeVisible()
  await safari.getByRole('button', { name: '不用了' }).click()
  await expect(safari.locator('.install-hint')).toHaveCount(0)
  await safari.reload()
  await expect(safari.getByRole('heading', { name: /开一桌/ })).toBeVisible()
  await expect(safari.locator('.install-hint')).toHaveCount(0)

  const wechat = await (await browser.newContext({ userAgent: IPHONE_WECHAT })).newPage()
  await wechat.goto('/')
  await expect(wechat.locator('html[data-hydrated="true"]')).toHaveCount(1)
  await expect(wechat.locator('.install-hint')).toHaveCount(0)
})
