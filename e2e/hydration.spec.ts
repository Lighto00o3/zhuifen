import { expect, test, type Page } from '@playwright/test'

// 模拟慢网络：页面脚本延迟返回，预渲染的 HTML 已经显示了，但页面还要过一会儿才能操作（水合）。
async function slowScripts(page: Page) {
  await page.route('**/_nuxt/**', async route => { await new Promise(resolve => setTimeout(resolve, 100)); await route.continue() })
}
const hydrated = (page: Page) => page.evaluate(() => document.documentElement.dataset.hydrated ?? null)

test('慢网络下，页面能操作之前点的按钮会在之后补上，表单不会被原生提交', async ({ page }) => {
  await slowScripts(page)
  // HTML 一到就开始操作，不等页面完成水合，就像心急的球友。
  await page.goto('/', { waitUntil: 'commit' })
  await page.getByLabel('你的昵称').fill('心急的甲')
  await page.getByLabel('房间名（选填）').fill('慢网络测试局')
  await page.getByRole('button', { name: '双人追分' }).click()
  await page.getByRole('button', { name: '创建房间，邀请球友' }).click()
  expect(await hydrated(page)).toBeNull()

  // 页面没有被刷新，水合后按顺序补上：先选双人，再创建房间；填的内容也都在。
  await expect(page).toHaveURL(/\/room\?room=\d{6}$/, { timeout: 30_000 })
  await expect(page.locator('.room-meta')).toContainText('双人追分')
  await expect(page.locator('.room-name')).toHaveText('慢网络测试局')
  await expect(page.locator('.player-card.mine h3')).toContainText('心急的甲')

  // 清理：关闭这个房间。
  await page.getByRole('button', { name: '关闭房间' }).click()
  await page.getByRole('button', { name: '确认关闭' }).click()
  await expect(page.getByRole('heading', { name: '房间已关闭' })).toBeVisible()
})

