// Service Worker — PWA 설치를 위한 최소 구현
const CACHE_NAME = 'rm-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Network-first strategy (항상 최신 데이터 우선)
self.addEventListener('fetch', (event) => {
  // API 요청은 캐싱하지 않음
  if (event.request.url.includes('/api/') || event.request.url.includes('/trpc/')) {
    return;
  }
  // 나머지는 network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
