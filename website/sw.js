/* TheDigiCiti — service worker: repeat visits from the device, tolerant of a bad or missing network.
 *
 *   dc/*.js?v=…, assets/** , part-transitions.js   cache-first (the cache is per build, see VERSION)
 *   pages (navigations, prefetched *.html)         network-first; the cached copy if the network fails
 *                                                  or takes longer than NAV_TIMEOUT
 *   calc API GETs (/calc/config, /calc/villa-funds) stale-while-revalidate inside an hour, network-first
 *                                                  up to a day, never anything older than a day
 *
 * VERSION is stamped by _source/build.py on every build (hash of the modules, pages and assets), so a
 * deploy installs a new worker, which takes over at once and deletes every older cache.
 * Kill switch, should this file ever misbehave: deploy a sw.js whose install handler calls
 * self.skipWaiting() and whose activate handler deletes all caches and calls self.registration.unregister().
 */
const VERSION = '92f3228d-5e6a41eb';                      // ← build.py rewrites this line
const CACHE = 'tdc-' + VERSION;
const CALC = 'tdc-calc';                    // API copies outlive a deploy (they carry their own age)
const API = 'https://client-digivilla-production.up.railway.app';
const CALC_PATHS = ['/calc/config', '/calc/villa-funds'];
const CALC_FRESH = 60 * 60 * 1000;          // served straight from the device (and refreshed behind)
const CALC_MAX = 24 * 60 * 60 * 1000;       // never served older than this, even offline
const NAV_TIMEOUT = 4000;                   // slow network: show the copy we have

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([CACHE, CALC]);
    await Promise.all((await caches.keys()).filter((k) => k.startsWith('tdc-') && !keep.has(k)).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (err) { /* unsupported */ } }
    await self.clients.claim();
  })());
});

// The page that installed us hands over what it already loaded (served from the HTTP cache, so no
// extra download) — the very next visit is then answered from here.
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'warm' || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    if (typeof d.page === 'string') {                         // the page itself, for the offline fallback
      try {
        const url = new URL(d.page, self.location.href);
        const key = url.origin + url.pathname;
        if (url.origin === self.location.origin && !(await c.match(key))) {
          const r = await fetch(key, { credentials: 'same-origin' });
          if (r.ok && r.type === 'basic' && /text\/html/.test(r.headers.get('content-type') || '')) await c.put(key, r);
        }
      } catch (err) { /* best effort */ }
    }
    await Promise.all(d.urls.slice(0, 80).map(async (u) => {
      try {
        const url = new URL(u, self.location.href);
        if (url.origin !== self.location.origin || !cacheFirst(url) || await c.match(url.href)) return;
        const r = await fetch(url.href, { credentials: 'same-origin' });
        if (r.ok && r.type === 'basic') await c.put(url.href, r);
      } catch (err) { /* best effort */ }
    }));
  })());
});

function cacheFirst(url) {
  return url.pathname.startsWith('/dc/') || url.pathname.startsWith('/assets/') || url.pathname === '/part-transitions.js';
}

function isCalc(url) {
  return (url.origin === API || url.origin === self.location.origin) && CALC_PATHS.includes(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(page(e, url)); return; }
  // the landing prefetches the story pages: keep those copies too (offline / slow-network fallback)
  if (url.origin === self.location.origin && url.pathname.endsWith('.html')) { e.respondWith(page(e, url)); return; }
  if (isCalc(url)) { e.respondWith(calc(e, req)); return; }
  if (url.origin === self.location.origin && cacheFirst(url) && !req.headers.has('range')) e.respondWith(asset(e, req));
});

async function asset(e, req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type === 'basic' && r.status === 200) e.waitUntil(c.put(req, r.clone()).catch(() => {}));
  return r;
}

async function page(e, url) {
  const key = url.origin + url.pathname;                       // ?utm=… and #chapter share one copy
  const c = await caches.open(CACHE);
  const net = (async () => {
    const r = (await e.preloadResponse) || (await fetch(e.request));
    if (r && r.ok && r.type === 'basic') e.waitUntil(c.put(key, r.clone()).catch(() => {}));   // lifetime already extended below
    return r;
  })();
  e.waitUntil(net.catch(() => {}));                             // keep the copy fresh even if we answered from it
  const cached = async () => (await c.match(key)) || (await c.match(alt(url)));
  let timer;
  const slow = new Promise((res) => { timer = setTimeout(res, NAV_TIMEOUT); });
  try {
    const first = await Promise.race([net, slow.then(cached)]);
    if (first) return first;                                    // network, or the copy after NAV_TIMEOUT
    return await net;                                           // no copy: keep waiting for the network
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  } finally { clearTimeout(timer); }
}

// /story ↔ /story.html, / ↔ /index.html
function alt(url) {
  const p = url.pathname;
  if (p === '/') return url.origin + '/index.html';
  if (p === '/index.html') return url.origin + '/';
  return url.origin + (p.endsWith('.html') ? p.slice(0, -5) : p + '.html');
}

async function calc(e, req) {
  const c = await caches.open(CALC);
  const key = req.url;
  const hit = await c.match(key);
  const age = hit ? Date.now() - (+hit.headers.get('x-tdc-at') || 0) : Infinity;
  const refresh = async () => {
    const r = await fetch(req);
    if (r.ok) {
      const body = await r.clone().arrayBuffer();
      const h = new Headers(r.headers); h.set('x-tdc-at', String(Date.now()));
      await c.put(key, new Response(body, { status: r.status, statusText: r.statusText, headers: h }));
    }
    return r;
  };
  if (hit && age < CALC_FRESH) { e.waitUntil(refresh().catch(() => {})); return hit; }
  try {
    return await refresh();
  } catch (err) {
    if (hit && age < CALC_MAX) return hit;
    if (hit) await c.delete(key);
    throw err;
  }
}
