/* 无人机药量计算 · DroneDose — service worker
   Network-first with a timeout. Bump CACHE here AND APP_VERSION in
   index.html on every deploy. */
const CACHE = "dronedose-v33";
const NETWORK_TIMEOUT_MS = 3000; /* weak orchard signal: fall back to cache instead of hanging */
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  /* No catch: if the files cannot be cached the install must FAIL, so the
     browser retries next visit and the page can tell the user offline use
     is not ready. A swallowed error leaves a "working" worker with an empty
     cache. */
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Only a good same-origin response may be served as fresh or stored.
   A 404/5xx from the host, or a captive-portal page, must never replace
   the cached app. */
function usable(res) {
  return res && res.ok && res.type === "basic" && !res.redirected;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const fromCache = () =>
    caches.match(req).then(hit =>
      hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)
    );

  const fromNetwork = fetch(req).then(res => {
    if (!usable(res)) throw new Error("bad response " + (res && res.status));
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}).then(() => res);
  });

  const work = new Promise((resolve, reject) => {
    let settled = false;
    const finish = res => { if (!settled) { settled = true; resolve(res); } };

    const timer = setTimeout(() => {
      fromCache().then(hit => { if (hit) finish(hit); });
    }, NETWORK_TIMEOUT_MS);

    fromNetwork.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then(hit => {
          if (hit) finish(hit);
          else if (!settled) { settled = true; reject(new Error("offline and not cached")); }
        });
      });
  });

  /* keep the worker alive so a slow network reply still refreshes the cache */
  event.waitUntil(fromNetwork.catch(() => {}));
  event.respondWith(work);
});
