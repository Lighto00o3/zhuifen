import { expect, type Page } from '@playwright/test'

// 打开或刷新页面后，等页面完成水合再操作：水合之前按钮还没有绑定事件，点击会被丢掉（见 app/plugins/hydrated.client.ts）。
export async function ready(page: Page) {
  await expect(page.locator('html[data-hydrated="true"]')).toHaveCount(1)
}
export async function open(page: Page, url: string) {
  await page.goto(url)
  await ready(page)
}
