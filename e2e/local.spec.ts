import { expect, test } from '@playwright/test'
import { open, ready } from './helpers'

test('单机三人：开局、犯规和普胜都选收分人、撤销、结束、历史页', async ({ page }) => {
  await open(page, '/local?new=1')
  await page.getByLabel('第 1 位球友').fill('甲')
  await page.getByLabel('第 2 位球友').fill('乙')
  await page.getByLabel('第 3 位球友').fill('丙')
  await page.getByLabel('本场名称（选填）').fill('单机测试局')
  await page.getByRole('button', { name: '开始单机记分' }).click()
  const scores = page.locator('.score-number')
  await expect(scores).toHaveText(['100分', '100分', '100分'])

  // 甲犯规：不再默认给上家，从另外两位里选一位收分。
  await page.getByRole('button', { name: '甲给犯规 1 分' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^给 / })).toHaveText(['给 乙 1 分', '给 丙 1 分'])
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
  await ready(page)
  await expect(scores).toHaveText(['99分', '100分', '101分'])

  await page.getByRole('button', { name: '结束本场' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认结束' }).click()
  await expect(page.getByText('这一场，收杆了')).toBeVisible()

  await open(page, '/history')
  const game = page.locator('.history-game')
  await expect(game).toHaveCount(1)
  await expect(game).toContainText('单机测试局')
  await expect(game).toContainText('单机')
})

test('单机不填昵称：自动叫球友甲、乙、丙，填了的保留；双人犯规只能给对手', async ({ page }) => {
  // 三人：只填第二位，其余两位自动起名。
  await open(page, '/local?new=1')
  await page.getByLabel('第 2 位球友').fill('老王')
  await page.getByRole('button', { name: '开始单机记分' }).click()
  await expect(page.locator('.player-card h3')).toHaveText(['球友甲', '老王', '球友乙'])

  // 双人：都不填。
  await open(page, '/local?new=1')
  await page.getByRole('button', { name: '双人追分' }).click()
  await page.getByRole('button', { name: '开始单机记分' }).click()
  await expect(page.locator('.player-card h3')).toHaveText(['球友甲', '球友乙'])
  await page.getByRole('button', { name: '球友甲给犯规 1 分' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^给 / })).toHaveText(['给 球友乙 1 分'])
  await page.getByRole('dialog').getByRole('button', { name: '给 球友乙 1 分' }).click()
  await expect(page.locator('.score-number')).toHaveText(['99分', '101分'])
})
