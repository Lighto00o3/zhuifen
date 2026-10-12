export default defineNuxtConfig({
  compatibilityDate: '2026-10-11',
  devtools: { enabled: false },
  ssr: process.env.NUXT_SPA !== 'true',
  runtimeConfig: { public: { apiOrigin: '' } },
  vite: {
    optimizeDeps: { include: ['qrcode', 'socket.io-client'] },
  },
  css: ['~/assets/main.css'],
  app: { head: {
    title: '追分 · 和球友一起记分',
    htmlAttrs: { lang: 'zh-CN' },
    script: [{ src: '/theme-init.js', tagPosition: 'head' }],
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    meta: [{ name: 'description', content: '双人或三人追分，扫码加入，一次记分，大家实时看见。' }],
  } },
  nitro: { prerender: { routes: ['/', '/room', '/design-preview'] }, devProxy: {
    '/api/': { target: 'http://127.0.0.1:3001/api/', changeOrigin: true },
  } },
})
