import { expect, test } from '@playwright/test'

test('单机三人：开局、犯规给上家、普胜选人、撤销、结束、历史页', async ({ page }) => {
  await page.goto('/local?new=1')
  await page.getByPlaceholder('球友 1 的昵称').fill('甲')
  await page.getByPlaceholder('球友 2 的昵称').fill('乙')
  await page.getByPlaceholder('球友 3 的昵称').fill('丙')
  await page.getByLabel('本场名称（选填）').fill('单机测试局')
  await page.getByRole('button', { name: '开始单机记分' }).click()
  const scores = page.locator('.score-number')
  await expect(scores).toHaveText(['100分', '100分', '100分'])

  // 甲犯规，自动给上家（座位是环形的，甲的上家是丙）。
  await page.getByRole('button', { name: '甲给犯规 1 分' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '给 丙 1 分' }).click()
  await expect(scores).toHaveText(['99分', '100分', '101分'])

  // 乙普胜，选择给甲。
  await page.getByRole('group', { name: '选择给分的人' }).getByRole('button', { name: '乙' }).click()
  await page.getByRole('button', { name: '乙给普胜 4 分' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '给 甲 4 分' }).click()
  await expect(scores).toHaveText(['103分', '96分', '101分'])

  // 撤销上一笔。
  await page.getByRole('button', { name: /撤销上一笔/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认撤销' }).click()
  await expect(scores).toHaveText(['99分', '100分', '101分'])

  // 刷新后从本机记录恢复。
  await page.reload()
  await expect(scores).toHaveText(['99分', '100分', '101分'])

  await page.getByRole('button', { name: '结束本场' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认结束' }).click()
  await expect(page.getByRole('heading', { name: '这一场，收杆了' })).toBeVisible()

  await page.goto('/history')
  const game = page.locator('.history-game')
  await expect(game).toHaveCount(1)
  await expect(game).toContainText('单机测试局')
  await expect(game).toContainText('单机')
})
