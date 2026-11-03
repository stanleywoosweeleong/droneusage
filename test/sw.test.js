/* Service worker regression test — no dependencies.
 *
 *   node test/sw.test.js
 *
 * Loads ../sw.js into a mocked worker scope (Cache Storage, fetch, clients,
 * timers) and drives install, activate and fetch events. Mocked APIs, not a
 * real browser: it checks the worker's own logic, not browser behaviour.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const ORIGIN = 'https://example.github.io';
const SCOPE = ORIGIN + '/droneusage/';

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) pass++; else { fail++; console.error('FAIL: ' + name); }
}

/* ---------- minimal mocks ---------- */
const abs = u => new URL(typeof u === 'string' ? u : u.url, SCOPE).href;

class Res {
  constructor(body, opts = {}) {
    this.body = body; this.status = opts.status || 200; this.ok = this.status < 300;
    this.type = opts.type || 'basic'; this.redirected = false;
    const ct = opts.ct || 'text/html; charset=utf-8';
    this.headers = { get: k => (k.toLowerCase() === 'content-type' ? ct : null) };
    this.ct = ct;
  }
  clone() { return new Res(this.body, { status: this.status, type: this.type, ct: this.ct }); }
  text() { return Promise.resolve(this.body); }
}
class Req {
  constructor(u, opts = {}) {
    this.url = abs(u); this.method = (u && u.method) || 'GET';
    this.mode = opts.mode || (u && u.mode) || 'cors';
  }
}

function makeEnv() {
  const store = new Map(); /* one cache name -> Map(url -> Res) */
  const cacheFor = name => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      put: (k, r) => { m.set(abs(k), r.clone()); return Promise.resolve(); },
      match: k => Promise.resolve(m.has(abs(k)) ? m.get(abs(k)).clone() : undefined),
      delete: k => Promise.resolve(m.delete(abs(k))),
      addAll: reqs => Promise.all(reqs.map(r => env.fetch(r).then(res => m.set(abs(r), res)))),
      _map: m
    };
  };
  const listeners = {};
  const timers = [];
  const env = {
    server: {},           /* url -> body served by the network */
    online: true,
    hang: false,          /* network never answers until release() */
    pendingNet: [],
    messages: [],
    fetch(r) {
      const url = abs(r);
      const answer = () => {
        const p = new URL(url).pathname;
        if (!env.online) return Promise.reject(new TypeError('offline'));
        const body = env.server[p];
        return Promise.resolve(body === undefined ? new Res('nf', { status: 404 }) : new Res(body, {
          ct: /\.png$/.test(p) ? 'image/png' : /\.webmanifest$/.test(p) ? 'application/manifest+json' : 'text/html'
        }));
      };
      if (env.hang) return new Promise(res => env.pendingNet.push(() => res(answer())));
      return answer();
    },
    release() { const q = env.pendingNet.splice(0); q.forEach(f => f()); },
    runTimers() { const q = timers.splice(0); q.forEach(f => f()); },
    cache: name => cacheFor(name)._map,
    store
  };
  const self = {
    location: new URL(SCOPE + 'sw.js'),
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting() {},
    clients: {
      claim: () => Promise.resolve(),
      get: id => Promise.resolve({ postMessage: m => env.messages.push({ id, m }) })
    }
  };
  const caches = {
    open: name => Promise.resolve(cacheFor(name)),
    keys: () => Promise.resolve([...store.keys()]),
    delete: name => Promise.resolve(store.delete(name)),
    match: k => {
      for (const m of store.values()) if (m.has(abs(k))) return Promise.resolve(m.get(abs(k)).clone());
      return Promise.resolve(undefined);
    }
  };
  const setTimeout_ = f => { timers.push(f); return timers.length; };
  const clearTimeout_ = () => {};
  new Function('self', 'caches', 'fetch', 'Request', 'setTimeout', 'clearTimeout', SRC)(
    self, caches, env.fetch, Req, setTimeout_, clearTimeout_);

  env.event = (type, extra = {}) => {
    const waits = []; let responded = null;
    const ev = Object.assign({
      waitUntil: p => waits.push(p),
      respondWith: p => { responded = p; }
    }, extra);
    listeners[type](ev);
    return { done: () => Promise.all(waits), response: () => responded };
  };
  env.navigate = (url, clientId = 'c1') =>
    env.event('fetch', { request: new Req(url, { mode: 'navigate' }), resultingClientId: clientId });
  return env;
}

const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }

function deploy(env, page) {
  Object.assign(env.server, {
    '/droneusage/': page, '/droneusage/index.html': page,
    '/droneusage/manifest.webmanifest': '{}', '/droneusage/icon-192.png': 'png',
    '/droneusage/icon-512.png': 'png', '/droneusage/icon-512-maskable.png': 'png'
  });
}
async function install(env) {
  await env.event('install').done();
  await env.event('activate').done();
}

(async () => {
  /* 1. An online visit to "/" must refresh the page the installed app
        launches offline (start_url ./index.html). */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    deploy(env, 'BUILD_B');
    const v = env.navigate(SCOPE);
    await settle(); await v.done();
    check('online visit to / serves B', (await (await v.response()).text()) === 'BUILD_B');
    env.online = false;
    const l = env.navigate(SCOPE + 'index.html');
    await settle();
    check('offline launch of index.html gets B, not stale A', (await (await l.response()).text()) === 'BUILD_B');
    const l2 = env.navigate(SCOPE);
    await settle();
    check('offline visit to / also gets B', (await (await l2.response()).text()) === 'BUILD_B');
  }

  /* 2. A slow navigation to an uncached URL is answered with the cached
        page; when the newer build arrives the page must be told. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    deploy(env, 'BUILD_B');
    env.hang = true;
    const v = env.navigate(SCOPE + '?source=share', 'share-client');
    await settle();
    env.runTimers(); /* network exceeded the timeout */
    await settle();
    check('slow uncached URL served cached A', (await (await v.response()).text()) === 'BUILD_A');
    env.release();
    await settle(); await v.done();
    check('reload offered after B arrives for fallback page',
      env.messages.length === 1 && env.messages[0].id === 'share-client' &&
      env.messages[0].m.type === 'dronedose-update-ready');
    check('cached page is now B', env.cache('dronedose-app').get(SCOPE + 'index.html').body === 'BUILD_B');
  }

  /* 3. No notice when the slow network brings the same build. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    env.hang = true;
    const v = env.navigate(SCOPE);
    await settle(); env.runTimers(); await settle();
    env.release(); await settle(); await v.done();
    check('no reload notice when build unchanged', env.messages.length === 0);
  }

  /* 4. No notice when the network answered in time (page is already new). */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    deploy(env, 'BUILD_B');
    const v = env.navigate(SCOPE);
    await settle(); await v.done();
    check('no reload notice when served from network', env.messages.length === 0);
  }

  /* 5. A non-HTML navigation (icon opened directly) must not overwrite the page. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    const v = env.navigate(SCOPE + 'icon-192.png');
    await settle(); await v.done();
    check('icon navigation leaves cached page intact',
      env.cache('dronedose-app').get(SCOPE + 'index.html').body === 'BUILD_A');
  }

  /* 6. Bad responses never replace the cached page. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    await install(env);
    delete env.server['/droneusage/'];
    const v = env.navigate(SCOPE);
    await settle(); await v.done();
    check('404 falls back to cached page', (await (await v.response()).text()) === 'BUILD_A');
    check('404 does not overwrite cache', env.cache('dronedose-app').get(SCOPE + 'index.html').body === 'BUILD_A');
  }

  /* 7. Activation removes old dronedose- caches and the legacy "./" entry,
        and leaves other projects' caches alone. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    env.cache('dronedose-v12').set(SCOPE, new Res('OLD'));
    env.cache('other-project').set(ORIGIN + '/other/', new Res('X'));
    env.cache('dronedose-app').set(SCOPE, new Res('LEGACY'));
    await install(env);
    check('old numbered cache deleted', !env.store.has('dronedose-v12'));
    check('other project cache kept', env.store.has('other-project'));
    check('legacy "./" page entry removed', !env.cache('dronedose-app').has(SCOPE));
  }

  /* 8. Install fails loudly when an asset cannot be fetched. */
  {
    const env = makeEnv();
    deploy(env, 'BUILD_A');
    env.online = false;
    let failed = false;
    await env.event('install').done().catch(() => { failed = true; });
    check('install rejects when offline', failed);
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
