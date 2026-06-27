/* SIREN PWA 서비스워커 — 보수적 전략(동적 사이트 보호)
 * - /api/* · 비-GET · 외부 도메인: 절대 캐시 안 함(항상 네트워크)
 * - 페이지(navigate): 네트워크 우선 → 실패 시 캐시 → 그래도 없으면 offline.html
 * - 정적 자산(css/js/img/font): 캐시 우선 + 백그라운드 갱신(stale-while-revalidate)
 * 캐시 무효화: CACHE_VERSION 숫자만 올리면 구버전 전체 폐기.
 */
const CACHE_VERSION = 'v1';
const STATIC_CACHE = 'siren-static-' + CACHE_VERSION;
const PAGE_CACHE = 'siren-pages-' + CACHE_VERSION;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/img/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return /\.(?:css|js|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // 비-GET 통과
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 외부 도메인 통과
  if (url.pathname.startsWith('/api/')) return;           // API 통과(항상 네트워크)

  // 페이지 이동: 네트워크 우선
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // 정적 자산: 캐시 우선 + 백그라운드 갱신
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
