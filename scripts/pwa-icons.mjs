// 用 favicon.svg 的图案生成「添加到主屏幕」用的 PNG 图标，改了 favicon 之后运行：node scripts/pwa-icons.mjs
// 圆角版用于普通图标；直角满底版给 iOS（系统自己加圆角）和安卓的 maskable 图标（系统按形状裁切，球在中间 80% 安全区内）。
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = 'apps/web/public';
const svg = readFileSync(`${dir}/favicon.svg`, 'utf8');
const square = svg.replace(/ rx="\d+"/, '');
const icons = [
  { file: 'icon-192.png', size: 192, svg },
  { file: 'icon-512.png', size: 512, svg },
  { file: 'icon-maskable-512.png', size: 512, svg: square },
  { file: 'apple-touch-icon.png', size: 180, svg: square },
];

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const page = await browser.newPage();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `)}`);
  await page.locator('svg').screenshot({ path: `${dir}/${icon.file}`, omitBackground: true });
  console.log(`${dir}/${icon.file}`);
}
await browser.close();
