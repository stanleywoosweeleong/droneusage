/* 无人机药量计算 · DroneDose — service worker
   Network-first with a timeout. NO VERSION TO BUMP: deploying a changed
   index.html is enough.

   - Every online fetch revalidates with the server (cache: "no-cache", so
     GitHub Pages' 10-minute HTTP cache cannot hide a deploy) and the good
     response overwrites the cached copy. The cache therefore always holds
     the newest build that this device has seen.
   - If the page had to be answered from the cache (offline, or the network
     took longer than the timeout) and the network copy that arrives later
     is different, the page is told so it can offer a reload.
   - The page shows "App updated" itself by fingerprinting its own code
     (see APP_FINGERPRINT in index.html).

   Edit this file only when the worker's behaviour changes; the browser
   reinstalls it whenever its bytes change. */
const CACHE = "dronedose-app";
const CACHE_PREFIX = "dronedose-";
const NETWORK_TIMEOUT_MS = 3000; /* weak orchard signal: fall back to cache instead of hanging */
/* ONE cache entry for the page. "/droneusage/", "/droneusage/index.html"
   and "/droneusage/?source=share" are the same app; keeping a copy per URL
   let an online visit refresh one copy while the installed app (start_url
   ./index.html) launched another, older one offline. */
const PAGE_KEY = "./index.html";
const ASSETS = [
  PAGE_KEY,
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
     cache. cache: "reload" skips the HTTP cache so a fresh install never
     stores a stale copy. */
  event.waitUntil(caches.open(CACHE).then(c =>
    c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", event => {
  /* Remove only this app's old caches (including the old numbered
     dronedose-vNN ones): other GitHub Pages projects on the same hostname
     share Cache Storage. Also drop the "./" page entry older workers kept:
     the page now lives under PAGE_KEY only, and a second copy went stale. */
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then(c => c.delete("./"))
      .then(() => self.clients.claim())
  );
});

/* Only a good same-origin response may be served as fresh or stored.
   A 404/5xx from the host, or a captive-portal page, must never replace
   the cached app. */
function usable(res) {
  return res && res.ok && res.type === "basic" && !res.redirected;
}

function tellPage(clientId) {
  if (!clientId) return;
  return self.clients.get(clientId).then(c => {
    if (c) c.postMessage({ type: "dronedose-update-ready" });
  });
}

function isHtml(res) {
  return (res.headers.get("content-type") || "").indexOf("text/html") !== -1;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const isPage = req.mode === "navigate";
  /* Clone of the cached page actually handed to the user, if any. A newer
     build is announced by comparing against THIS, not against whatever
     the cache holds under the request URL. */
  let servedCopy = null;

  const fromCache = () => isPage
    ? caches.match(PAGE_KEY).then(hit => hit || caches.match(req))
    : caches.match(req);

  const fromNetwork = fetch(new Request(req, { cache: "no-cache" })).then(res => {
    if (!usable(res)) throw new Error("bad response " + (res && res.status));
    const copy = res.clone();
    /* Every HTML navigation, whatever its URL or query, refreshes the one
       page entry. A non-HTML navigation (an icon opened directly) is
       stored under its own URL and must not overwrite the page. */
    const page = isPage && isHtml(res);
    const store = caches.open(CACHE).then(c => {
      if (!page) return c.put(req, copy);
      const newText = copy.clone().text();
      return c.put(PAGE_KEY, copy).then(() => {
        if (!servedCopy) return;
        return Promise.all([servedCopy.text(), newText]).then(([oldText, text]) => {
          if (oldText !== text) return tellPage(event.resultingClientId || event.clientId);
        });
      });
    }).catch(() => {});
    return { res, store };
  });

  const work = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (res, cached) => {
      if (settled) return;
      settled = true;
      if (cached && isPage) servedCopy = res.clone();
      resolve(res);
    };

    const timer = setTimeout(() => {
      fromCache().then(hit => { if (hit) finish(hit, true); });
    }, NETWORK_TIMEOUT_MS);

    fromNetwork.then(({ res }) => { clearTimeout(timer); finish(res, false); })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then(hit => {
          if (hit) finish(hit, true);
          else if (!settled) { settled = true; reject(new Error("offline and not cached")); }
        });
      });
  });

  /* keep the worker alive so a slow network reply still refreshes the cache */
  event.waitUntil(fromNetwork.then(({ store }) => store).catch(() => {}));
  event.respondWith(work);
});
