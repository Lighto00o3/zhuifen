import { defineConfig } from '@playwright/test'

// 端到端测试：启动真实的 API 和前端开发服务器，在浏览器里把主要流程走一遍。
// 需要能连上 PostgreSQL（本地读 apps/api/.env，CI 里用环境变量 DATABASE_URL）。
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 每个 IP 每分钟最多创建 5 个房间，测试按顺序跑，避免同时建太多房间被限流。
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // 本地直接用电脑上装的 Chrome，不用另外下载浏览器；CI 里用 npx playwright install 装的 Chromium。
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm run dev -w @zhuifen/api', url: 'http://localhost:3001/api/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run dev -w @zhuifen/web', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
})
