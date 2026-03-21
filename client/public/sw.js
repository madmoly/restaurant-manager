// 331매장관리 시스템 Service Worker
const CACHE_NAME = "restaurant-mgmt-v1";

// 캐시할 정적 자산 목록
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
];

// 설치 이벤트 - 핵심 자산 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 활성화 이벤트 - 이전 캐시 정리
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 네트워크 요청 처리 - Network First 전략 (API는 항상 네트워크 우선)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API 요청은 캐시하지 않음
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 같은 오리진의 GET 요청만 처리
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공적인 응답을 캐시에 저장
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 반환
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // HTML 요청의 경우 루트 페이지 반환 (SPA 오프라인 지원)
          if (event.request.headers.get("accept")?.includes("text/html")) {
            return caches.match("/");
          }
        });
      })
  );
});
