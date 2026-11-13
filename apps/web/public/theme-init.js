// Apply the saved appearance before the page paints, including static hosting.
(() => {
  let saved;
  try { saved = localStorage.getItem('zhuifen:theme'); } catch {}
  const theme = saved === 'light' || saved === 'dark'
    ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  // 手机状态栏颜色跟着页面背景（和 main.css 里的 --page 一致），切换白天/夜间模式时由 app.vue 更新。
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = theme === 'dark' ? '#202421' : '#f4f5f4';
  document.head.append(meta);
})();
