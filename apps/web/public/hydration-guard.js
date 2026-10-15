// 页面先显示预渲染好的 HTML，等脚本下载完、Vue 接管（水合）之后按钮才能用。线上一般等不到按钮显示就已经水合完了，
// 但开发环境（脚本没有打包）或页面脚本下载卡住时，会有一段按钮点不动的时间（见 docs/optimization.md 第 29 条）：
// 期间点的按钮先按顺序记下来（同一个按钮连点只记一次），水合完成后由 app/plugins/hydrated.client.ts 补上；
// 同时拦住表单的原生提交，免得页面刷新、填好的内容丢失。
// 万一脚本出错一直没有完成水合，20 秒后不再拦截，恢复浏览器原来的行为。
(() => {
  const root = document.documentElement;
  const queue = [];
  const deadline = Date.now() + 20000;
  const waiting = () => !root.dataset.hydrated && Date.now() < deadline;
  window.__pendingClicks = queue;
  addEventListener('click', event => {
    if (!waiting()) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (queue[queue.length - 1] !== button) queue.push(button);
    if (queue.length > 5) queue.shift();
  }, true);
  addEventListener('submit', event => { if (waiting()) event.preventDefault(); }, true);
})();
