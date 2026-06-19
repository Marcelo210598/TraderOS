// v2: adiciona handlers de Web Push (alerta de trade do bot/NinjaTrader)
const CACHE = "traderos-v2";
const PRECACHE = ["/", "/dashboard", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  // allSettled: se UM item do precache der 404, o SW ainda instala (senão o push nunca registra)
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((url) => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Push Notifications ──────────────────────────────────────
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    try { data = { body: e.data.text() }; } catch { data = {}; }
  }
  const title = data.title || "TraderOS";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Você tem uma nova notificação",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200],
      tag: data.url || "traderos-notif",
      renotify: true,
      data: { url: data.url || "/notificacoes" },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url ?? "/notificacoes";
  e.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if (c.url.startsWith(self.registration.scope) && "focus" in c) {
            c.navigate(target).catch(() => {});
            return c.focus();
          }
        }
        return clients.openWindow(target);
      })
  );
});

self.addEventListener("fetch", (e) => {
  // API e rotas autenticadas: sempre rede
  if (e.request.url.includes("/api/") || e.request.method !== "GET") return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
