/**
 * 快乐学园 PWA service worker（由 publish-github-pages.mjs 写入产物根目录，
 * kx-ff77a5eb4b 替换为 kx-<contentVersion>）。GitHub Pages 子路径部署 + 国内访问慢，
 * 二次访问不再重拉音频/图片；更新策略：
 *  - /assets/：Vite 哈希块，内容不可变 → 缓存优先；
 *  - /static/：音频/图片/笔顺数据，文件名稳定但字节会随内容批次变 → 先回缓存、后台更新（SWR）；
 *  - 页面导航：网络优先，离线回退上次缓存的 index.html（纯前端应用可离线打开）。
 *  - contentVersion 变化 → 新缓存代次 + activate 清旧代，避免旧图残留。
 */
const VERSION = 'kx-ff77a5eb4b'
const ASSET_CACHE = 'kx-assets-' + VERSION
const STATIC_CACHE = 'kx-static-' + VERSION
const PAGE_CACHE = 'kx-pages-' + VERSION
const STATIC_MAX = 1500 // 防无界增长：超出时按键序先删先入的

self.addEventListener('install', function () {
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (n) {
            return n.startsWith('kx-') && !n.endsWith(VERSION)
          })
          .map(function (n) {
            return caches.delete(n)
          }),
      )
    }).then(function () {
      return self.clients.claim()
    }),
  )
})

function isAsset(url) {
  return url.pathname.includes('/assets/')
}
function isStatic(url) {
  return url.pathname.includes('/static/')
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key)
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res && res.ok) {
    await cache.put(request, res.clone())
    trim(cacheName, 300)
  }
  return res
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then(function (res) {
      if (res && res.ok) {
        cache.put(request, res.clone())
        trim(cacheName, STATIC_MAX)
      }
      return res
    })
    .catch(function () {
      return undefined
    })
  return cached || refresh.then(function (res) { return res || Response.error() })
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res && res.ok) cache.put(request, res.clone())
    return res
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    const shell = await cache.match('./') || await caches.match('./')
    if (shell) return shell
    throw err
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request
  if (request.method !== 'GET') return
  if (request.headers.has('range')) return
  let url
  try {
    url = new URL(request.url)
  } catch (err) {
    return
  }
  if (url.origin !== self.location.origin) return

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  } else if (isStatic(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGE_CACHE))
  }
})
