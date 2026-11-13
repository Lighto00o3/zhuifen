import { defineConfig } from '@playwright/test'

// PWA 的端到端测试：开发环境不注册 Service Worker，所以要测线上构建好的静态站点。
// 先构建：NUXT_SPA=true npm run generate -w @zhuifen/web，再运行 npm run test:pwa。
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'pwa.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node scripts/serve-static.mjs apps/web/.output/public 4173', url: 'http://localhost:4173', reuseExistingServer: false },
})
