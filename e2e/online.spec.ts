import { expect, test, type Page } from '@playwright/test'
import { open, ready } from './helpers'

const scores = (page: Page) => page.locator('.score-number')

test('联机双人：创建房间、扫码加入后自动开局、实时记分、撤销、结束、再开一局、刷新恢复、历史页', async ({ browser }) => {
  // 两个独立的浏览器上下文，相当于两台手机。
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()

  await open(host, '/')
  await host.getByLabel('你的昵称').fill('甲')
  await host.getByLabel('房间名（选填）').fill('端到端测试局')
  await host.getByRole('button', { name: '双人追分' }).click()
  await host.getByRole('button', { name: '创建房间，邀请球友' }).click()
  await expect(host).toHaveURL(/\/room\?room=\d{6}$/)
  await expect(host.getByText('实时同步中')).toBeVisible()
  await expect(host.getByText('1 / 2 人已加入')).toBeVisible()
  await expect(host.getByText('两人到齐后自动开始追分')).toBeVisible()

  // 邀请弹窗：二维码和邀请链接；Esc 关闭后焦点回到原来的按钮。
  const inviteButton = host.getByRole('button', { name: /扫码邀请/ })
  await inviteButton.click()
  const dialog = host.getByRole('dialog', { name: '扫码，加入这一桌' })
  await expect(dialog.getByRole('img', { name: '加入房间的二维码' })).toBeVisible()
  const link = await dialog.getByLabel('邀请链接').inputValue()
  await host.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(inviteButton).toBeFocused()

  // 乙扫码打开邀请链接加入；人到齐自动开局，房主不用再点开始。
  await open(guest, link)
  await guest.getByLabel('你的昵称').fill('乙')
  await guest.getByRole('button', { name: '加入这一桌' }).click()
  await expect(guest.getByText('实时同步中')).toBeVisible()
  for (const page of [host, guest]) await expect(page.getByRole('heading', { name: '这一桌，正在追分' })).toBeVisible()

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
  await ready(guest)
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
  await open(guest, '/history')
  const games = guest.locator('.history-game')
  await expect(games).toHaveCount(2)
  await expect(games.nth(0)).toContainText('端到端测试局')
  await expect(games.nth(0).locator('.history-scores')).toContainText('甲106')
  await expect(games.nth(1).locator('.history-scores')).toContainText('甲99')

  // 回到首页，最近的房间里有这个房间。
  await open(guest, '/')
  await expect(guest.locator('.recent')).toContainText('端到端测试局')
})

test('联机三人：不填昵称自动起名、人到齐自动开局、每笔给分（包括犯规）都选收分人、撤销、结束、历史页', async ({ browser }) => {
  // 三个独立的浏览器上下文，相当于三台手机。
  const [first, second, third] = [await (await browser.newContext()).newPage(), await (await browser.newContext()).newPage(), await (await browser.newContext()).newPage()]
  const everyone = [first, second, third]
  const allScores = async (values: string[]) => { for (const page of everyone) await expect(scores(page)).toHaveText(values) }

  // 房主不填昵称，自动叫「球友甲」。
  await open(first, '/')
  await first.getByLabel('房间名（选填）').fill('三人测试局')
  await first.getByRole('button', { name: '三人追分' }).click()
  await first.getByRole('button', { name: '创建房间，邀请球友' }).click()
  await expect(first).toHaveURL(/\/room\?room=\d{6}$/)
  await expect(first.getByText('实时同步中')).toBeVisible()
  await expect(first.locator('.player-card.mine h3')).toContainText('球友甲')
  await expect(first.getByText('1 / 3 人已加入')).toBeVisible()
  await expect(first.getByText('三人到齐后自动开始追分')).toBeVisible()

  await first.getByRole('button', { name: /扫码邀请/ }).click()
  const link = await first.getByRole('dialog', { name: '扫码，加入这一桌' }).getByLabel('邀请链接').inputValue()
  await first.keyboard.press('Escape')

  // 第二位也不填昵称，自动叫「球友乙」；人还没到齐，继续等待。
  await open(second, link)
  await second.getByRole('button', { name: '加入这一桌' }).click()
  await expect(second.getByText('实时同步中')).toBeVisible()
  await expect(second.locator('.player-card.mine h3')).toContainText('球友乙')
  await expect(first.getByText('2 / 3 人已加入')).toBeVisible()
  await expect(first.getByRole('heading', { name: '等球友上桌' })).toBeVisible()

  // 第三位自己填了昵称；他一加入人就到齐了，三台手机自动进入比赛，没有人点开始。
  await open(third, link)
  await third.getByLabel('你的昵称').fill('老王')
  await third.getByRole('button', { name: '加入这一桌' }).click()
  for (const page of everyone) await expect(page.getByRole('heading', { name: '这一桌，正在追分' })).toBeVisible()
  await expect(first.locator('.player-card h3')).toContainText(['球友甲', '球友乙', '老王'])
  await allScores(['100分', '100分', '100分'])

  // 老王犯规：不再默认给上家，要从另外两位里选一位收分。
  const dialog = (page: Page) => page.getByRole('dialog', { name: '这笔分给谁？' })
  await third.getByRole('button', { name: /^犯规/ }).click()
  await expect(dialog(third).getByRole('button', { name: /^给 / })).toHaveText(['给 球友甲 1 分', '给 球友乙 1 分'])
  // 先取消一次：不会记分。
  await dialog(third).getByRole('button', { name: '取消给分' }).click()
  await expect(dialog(third)).toBeHidden()
  await expect(third.locator('.event-list li')).toHaveCount(0)
  // 这次选排在他前一位的球友乙。
  await third.getByRole('button', { name: /^犯规/ }).click()
  await dialog(third).getByRole('button', { name: '给 球友乙 1 分' }).click()
  await allScores(['100分', '101分', '99分'])

  // 老王再犯规一次，这次给球友甲：同一个人犯规可以给不同的球友。
  await third.getByRole('button', { name: /^犯规/ }).click()
  await dialog(third).getByRole('button', { name: '给 球友甲 1 分' }).click()
  await allScores(['101分', '101分', '98分'])

  // 球友乙给老王普胜 4 分。
  await second.getByRole('button', { name: /^给普胜/ }).click()
  await expect(dialog(second).getByRole('button', { name: /^给 / })).toHaveText(['给 球友甲 4 分', '给 老王 4 分'])
  await dialog(second).getByRole('button', { name: '给 老王 4 分' }).click()
  await allScores(['101分', '97分', '102分'])

  // 球友乙撤销刚才那一笔。
  await second.getByRole('button', { name: /撤销上一笔/ }).click()
  await second.getByRole('button', { name: '确认撤销' }).click()
  await allScores(['101分', '101分', '98分'])

  // 房主结束本场，三台手机都看到收杆。
  await first.getByRole('button', { name: '结束本场' }).click()
  await first.getByRole('button', { name: '确认结束' }).click()
  for (const page of everyone) await expect(page.getByRole('heading', { name: '这一场，收杆了' })).toBeVisible()

  // 老王刷新页面：自动回到房间，比分还在。
  await third.reload()
  await ready(third)
  await expect(scores(third)).toHaveText(['101分', '101分', '98分'])

  // 历史页里有这一场，默认昵称和比分都对。
  await open(third, '/history')
  const games = third.locator('.history-game')
  await expect(games).toHaveCount(1)
  await expect(games.nth(0)).toContainText('三人测试局')
  await expect(games.nth(0).locator('.history-scores')).toContainText('球友甲101')
  await expect(games.nth(0).locator('.history-scores')).toContainText('老王98')
})
