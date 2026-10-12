// Apply the saved appearance before the page paints, including static hosting.
(() => {
  let saved;
  try { saved = localStorage.getItem('zhuifen:theme'); } catch {}
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
