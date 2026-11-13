// 让网站可以「添加到主屏幕」，并在没网时也能打开（单机记分不需要网络）。
// - 页面：先走网络，保证每次发布后拿到最新版本；没网时用存下的副本。
// - /_nuxt/ 下带哈希的脚本和样式内容不会变，存过就直接用。
// - 安装时把各个页面和这次发布的全部脚本、样式都存好（清单由 modules/precache.ts 在构建时写入下面的 PAGES 和 PRECACHE），
//   所以没打开过的页面没网时也能显示。清单变了，这个文件也就变了，浏览器会自动装上新版本。
// - 其他静态文件（图标、head 里的脚本）先用存的，同时在后台更新。
// - 接口和实时连接（/api/、/socket.io/）、/_nuxt/builds/ 下的版本信息以及其他域名的请求一律不经过这里，联机数据始终以服务端为准。
// 要停用离线缓存时，把这个文件换成只执行 self.registration.unregister() 和清缓存的版本并发布即可。
const CACHE = 'zhuifen-v1';
const PAGES = [];
const PRECACHE = [];

self.addEventListener('install', event => {
  // 单个文件失败不影响安装，之后用到时再存。
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled([...new Set(['/', ...PAGES, ...PRECACHE])].map(async path => {
    const response = await fetch(path);
    if (response.ok) await cache.put(path, await settle(response));
  }))));
  self.skipWaiting();
});

// 删掉旧版本留下的带哈希文件，缓存不会越积越多。
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    if (PRECACHE.length) {
      const current = new Set(PRECACHE);
      const cache = await caches.open(CACHE);
      for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith('/_nuxt/') && !current.has(pathname)) await cache.delete(request);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/_nuxt/builds/')) return;

  if (request.mode === 'navigate') event.respondWith(page(request, url));
  else if (url.pathname.startsWith('/_nuxt/')) event.respondWith(immutable(request));
  else event.respondWith(revalidate(event, request));
});

// 页面副本按路径存，不带查询参数：/room?room=123456 和 /room 用同一份，房间号由页面脚本读取。
async function page(request, url) {
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE)).put(key, await settle(response.clone()));
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key) ?? await cache.match('/');
    if (cached) return cached;
    throw error;
  }
}

// 经过跳转（例如 /history 跳到 /history/）得到的页面不能直接拿来回应页面请求，浏览器会报错，存之前去掉跳转标记。
async function settle(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function immutable(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function revalidate(event, request) {
  const cached = await caches.match(request);
  const fresh = fetch(request).then(async response => {
    if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  });
  if (!cached) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return cached;
}
