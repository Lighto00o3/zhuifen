import { expect, test, type Page } from '@playwright/test'

const scores = (page: Page) => page.locator('.score-number')

test('联机双人：创建房间、扫码加入、实时记分、撤销、结束、再开一局、刷新恢复、历史页', async ({ browser }) => {
  // 两个独立的浏览器上下文，相当于两台手机。
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()

  await host.goto('/')
  await host.getByLabel('你的昵称').fill('甲')
  await host.getByLabel('房间名（选填）').fill('端到端测试局')
  await host.getByRole('button', { name: '双人追分' }).click()
  await host.getByRole('button', { name: '创建房间，邀请球友' }).click()
  await expect(host).toHaveURL(/\/room\?room=\d{6}$/)
  await expect(host.getByText('实时同步中')).toBeVisible()

  // 邀请弹窗：二维码和邀请链接；Esc 关闭后焦点回到原来的按钮。
  const inviteButton = host.getByRole('button', { name: /扫码邀请/ })
  await inviteButton.click()
  const dialog = host.getByRole('dialog', { name: '扫码，加入这一桌' })
  await expect(dialog.getByRole('img', { name: '加入房间的二维码' })).toBeVisible()
  const link = await dialog.getByLabel('邀请链接').inputValue()
  await host.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(inviteButton).toBeFocused()

  // 乙扫码打开邀请链接加入。
  await guest.goto(link)
  await guest.getByLabel('你的昵称').fill('乙')
  await guest.getByRole('button', { name: '加入这一桌' }).click()
  await expect(guest.getByText('实时同步中')).toBeVisible()
  await expect(host.getByText('2 / 2 人已加入')).toBeVisible()

  await host.getByRole('button', { name: '两人到齐，开始追分' }).click()
  await expect(guest.getByRole('heading', { name: '这一桌，正在追分' })).toBeVisible()

  // 乙给甲普胜 4 分，两边实时同步。
  await guest.getByRole('button', { name: /^给普胜/ }).click()
  await expect(scores(host)).toHaveText(['104分', '96分'])
  await expect(scores(guest)).toHaveText(['104分', '96分'])

  // 乙撤销刚才那一笔。
  await guest.getByRole('button', { name: /撤销上一笔/ }).click()
  await guest.getByRole('button', { name: '确认撤销' }).click()
  await expect(scores(host)).toHaveText(['100分', '100分'])
  await expect(guest.locator('.event-list li.undone')).toHaveCount(1)

  // 甲犯规，给对手 1 分。
  await host.getByRole('button', { name: /^犯规/ }).click()
  await expect(scores(guest)).toHaveText(['99分', '101分'])

  // 甲结束本场。
  await host.getByRole('button', { name: '结束本场' }).click()
  await host.getByRole('button', { name: '确认结束' }).click()
  await expect(guest.getByRole('heading', { name: '这一场，收杆了' })).toBeVisible()

  // 再开一局，接着上一场的积分。
  await host.getByRole('button', { name: '再开一局' }).click()
  await host.getByRole('button', { name: '接着上一场的积分' }).click()
  await host.getByRole('button', { name: '开始下一局' }).click()
  await expect(guest.getByRole('heading', { name: '这一桌，正在追分' })).toBeVisible()
  await expect(scores(guest)).toHaveText(['99分', '101分'])
  await expect(guest.locator('.event-list li')).toHaveCount(0)

  // 乙刷新页面：自动回到房间，比分还在，也不会重放之前的记分动画。
  await guest.reload()
  await expect(guest.getByText('实时同步中')).toBeVisible()
  await expect(scores(guest)).toHaveText(['99分', '101分'])
  await expect(guest.locator('.transfer-caption')).toHaveCount(0)

  // 乙给甲小金 7 分，甲结束第二局。
  await guest.getByRole('button', { name: /^给小金/ }).click()
  await expect(scores(host)).toHaveText(['106分', '94分'])
  await host.getByRole('button', { name: '结束本场' }).click()
  await host.getByRole('button', { name: '确认结束' }).click()
  await expect(guest.getByRole('heading', { name: '这一场，收杆了' })).toBeVisible()

  // 历史页能看到这两局，比分正确。
  await guest.goto('/history')
  const games = guest.locator('.history-game')
  await expect(games).toHaveCount(2)
  await expect(games.nth(0)).toContainText('端到端测试局')
  await expect(games.nth(0).locator('.history-scores')).toContainText('甲106')
  await expect(games.nth(1).locator('.history-scores')).toContainText('甲99')

  // 回到首页，最近的房间里有这个房间。
  await guest.goto('/')
  await expect(guest.locator('.recent')).toContainText('端到端测试局')
})
