export default defineNuxtConfig({
  compatibilityDate: '2026-10-11',
  devtools: { enabled: false },
  ssr: process.env.NUXT_SPA !== 'true',
  runtimeConfig: { public: { apiOrigin: '' } },
  vite: {
    // 开发时预先打包这些依赖；否则首次打开页面时 Vite 才发现它们，会重新打包并强制刷新所有页面（端到端测试会因此偶发失败）。
    optimizeDeps: { include: ['gsap', 'qrcode', 'socket.io-client'] },
  },
  css: ['~/assets/main.css'],
  modules: [
    // 设计预览页（pages/design-preview.vue）只在本地开发时使用，构建线上版本时去掉这个路由，不打包也不预渲染。
    (_options, nuxt) => {
      if (nuxt.options.dev) return
      nuxt.hook('pages:extend', pages => {
        const index = pages.findIndex(page => page.path === '/design-preview')
        if (index !== -1) pages.splice(index, 1)
      })
    },
  ],
  app: { head: {
    title: '追分 · 和球友一起记分',
    htmlAttrs: { lang: 'zh-CN' },
    script: [{ src: '/theme-init.js', tagPosition: 'head' }, { src: '/hydration-guard.js', tagPosition: 'head' }],
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    meta: [{ name: 'description', content: '双人或三人追分，扫码加入，一次记分，大家实时看见。' }],
  } },
  nitro: { prerender: { routes: ['/', '/room'] }, devProxy: {
    '/api/': { target: 'http://127.0.0.1:3001/api/', changeOrigin: true },
  } },
})
