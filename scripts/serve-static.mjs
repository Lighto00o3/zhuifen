// 端到端测试 PWA 用的静态服务器，行为和 Render 静态站点一致：文件存在就返回，否则返回 /index.html。
// 没有后端：/api/ 和 /socket.io/ 一律返回 502，用来确认这些请求不会被 Service Worker 用缓存顶替。
// 用法：node scripts/serve-static.mjs apps/web/.output/public 4173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'apps/web/.output/public';
const port = Number(process.argv[3] ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const isFile = path => stat(path).then(info => info.isFile(), () => false);

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (path.startsWith('/api/') || path.startsWith('/socket.io/')) {
    response.writeHead(502).end();
    return;
  }
  let file = join(root, path);
  if (!await isFile(file)) file = join(file, 'index.html');
  if (!await isFile(file)) file = join(root, 'index.html');
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  response.end(await readFile(file));
}).listen(port, () => console.log(`http://localhost:${port}`));
