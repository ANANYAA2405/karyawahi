/*
 * Karyavahi service worker — hand-written, no build step, no libraries.
 *
 * Registered only in production builds and only for the field roles that land on My day
 * (src/components/OfflineSupport.tsx). What it does, and nothing more:
 *
 *  1. Scripts, styles, fonts and icons (/_next/static/*, /icons/*, the manifest) are kept and
 *     served from the cache first; their names change with every build, so they never go stale.
 *  2. Pages are always fetched from the network first. Only My day (/today) and the task pages
 *     it links to (/tasks/<id>) are saved, each time they load. With no network, the saved copy
 *     is served with a marker the page reads to say "offline — last updated <time>"; any other
 *     page gets a short bilingual "you are offline" page.
 *  3. /api/* is never cached and never touched, nor is any POST (server actions, sign-in), nor the
 *     RSC payloads of client-side navigation.
 *  4. Saved pages belong to one person: they are dropped on sign-out, on sign-in, on the way to
 *     the sign-in pages, and when the page reports a different signed-in user.
 *  5. Proof saved on the phone without signal (IndexedDB, written by src/lib/offline/queue.ts) is
 *     sent by Background Sync where the browser has it. The server keeps one row per client id.
 */
const VERSION = 'kv-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const SHELL = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/icon.svg'];
const PAGE_RE = /^\/(today|tasks\/[A-Za-z0-9-]+)\/?$/;
const SIGNED_OUT_RE = /^\/(login|demo|register)(\/|$)/;
const OWNER_KEY = '/__kv/owner';
const MAX_STATIC = 200;
const MAX_TASK_PAGES = 40;
const FRESH_MS = 5 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kv-') && !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ------------------------------------------------------------------ who the saved pages belong to
async function forgetPages() {
  await caches.delete(PAGES);
  await idbDeleteMeta('user').catch(() => {});
}

async function pagesOwner() {
  const c = await caches.open(PAGES);
  const r = await c.match(OWNER_KEY);
  return r ? r.text() : null;
}

async function claimPages(userId) {
  if (!userId) return;
  if ((await pagesOwner()) !== userId) {
    await caches.delete(PAGES);
    const c = await caches.open(PAGES);
    await c.put(OWNER_KEY, new Response(userId));
  }
}

// ------------------------------------------------------------------ fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method === 'POST' && (url.pathname === '/api/sign-out' || url.pathname === '/api/sign-in')) {
    event.waitUntil(forgetPages()); // and let the request go through untouched
    return;
  }
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === 'navigate') {
    if (SIGNED_OUT_RE.test(url.pathname)) {
      event.waitUntil(forgetPages());
      event.respondWith(fetch(req).catch(() => offlinePage()));
      return;
    }
    event.respondWith(networkFirstPage(event, url));
  }
  // Anything else (RSC payloads, photos, images) goes to the network as if there were no worker.
});

async function cacheFirst(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    c.put(req, res.clone()).then(() => trim(c, MAX_STATIC)).catch(() => {});
  }
  return res;
}

async function trim(c, max) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function isHtml(res) {
  return (res.headers.get('content-type') || '').includes('text/html');
}

async function savePage(path, res) {
  // A redirect (signed out) or an error page is never saved over a good copy.
  if (!res.ok || res.type !== 'basic' || res.redirected || !isHtml(res)) return;
  const body = await res.text();
  const c = await caches.open(PAGES);
  await c.put(path, new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-KV-Saved-At': String(Date.now()) },
  }));
  // The scripts and styles this page needs, so it also runs (not just shows) without signal.
  // A task page saved in the background has never been opened, so its own chunks are not kept yet.
  // Script tags name them as /_next/static/…; the component data names lazily loaded chunks as
  // static/chunks/… without the prefix.
  const found = (body.match(/(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\s\\<>]+/g) || [])
    .map((p) => (p.startsWith('/_next/') ? p : `/_next/${p}`));
  await keepAssets([...new Set(found)]);
}

async function keepAssets(paths) {
  const st = await caches.open(STATIC);
  await Promise.all(paths.map(async (p) => {
    try { if (!(await st.match(p))) await st.add(p); } catch { /* no signal or gone */ }
  }));
  await trim(st, MAX_STATIC);
}

async function savedPage(path) {
  const c = await caches.open(PAGES);
  const hit = await c.match(path);
  if (!hit) return null;
  const at = hit.headers.get('X-KV-Saved-At') || '';
  const html = (await hit.text()).replace(/<head([^>]*)>/i, `<head$1><meta name="kv-offline-copy" content="${at}">`);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-KV-Offline-Copy': at } });
}

async function networkFirstPage(event, url) {
  const save = PAGE_RE.test(url.pathname);
  try {
    const res = await fetch(event.request);
    if (save) event.waitUntil(savePage(url.pathname.replace(/\/$/, ''), res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    if (save) {
      const copy = await savedPage(url.pathname.replace(/\/$/, ''));
      if (copy) return copy;
    }
    return offlinePage();
  }
}

function offlinePage() {
  const html = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#167D78"><title>ऑफ़लाइन · Offline — Karyavahi</title>
<style>body{margin:0;font-family:system-ui,-apple-system,"Noto Sans Devanagari",sans-serif;background:#F6F4EE;color:#101E38}
main{max-width:30rem;margin:0 auto;padding:3rem 1.25rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{line-height:1.55;color:#4A5568}
a{display:inline-block;margin-top:1rem;padding:.8rem 1.2rem;border-radius:.6rem;background:#167D78;color:#fff;text-decoration:none;font-weight:600}
.en{margin-top:2rem;border-top:1px solid #E6E2D8;padding-top:1.25rem}.demo{font-size:.75rem;color:#8A6416;text-transform:uppercase;letter-spacing:.08em}</style></head>
<body><main><p class="demo">डेमो मोड — काल्पनिक डेटा</p>
<h1>आप ऑफ़लाइन हैं</h1><p>यह पृष्ठ इस फ़ोन पर सहेजा नहीं गया है। "मेरा दिन" और उसके काम बिना सिग्नल के भी खुलते हैं, यदि आपने उन्हें एक बार सिग्नल रहते खोला हो। सबूत फ़ोन पर रखा जाता है और सिग्नल लौटने पर भेजा जाता है।</p>
<a href="/today">मेरा दिन खोलें</a>
<div class="en"><h1>You are offline</h1><p>This page is not saved on this phone. My day and its tasks open without signal once you have opened them with signal. Proof you hand in is kept on the phone and sent when the signal returns.</p>
<a href="/today">Open My day</a></div></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ------------------------------------------------------------------ messages from the page
self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'hello') {
    event.waitUntil(claimPages(m.userId));
  } else if (m.type === 'keep') {
    event.waitUntil(keep(m.userId, m.pages || [], m.assets || []));
  }
});

/** Save My day, the task pages it links to, and the files they load, while there is signal. */
async function keep(userId, pages, assets) {
  await claimPages(userId);
  await keepAssets(assets.map((u) => {
    try { const x = new URL(u); return x.origin === self.location.origin && x.pathname.startsWith('/_next/static/') ? x.pathname + x.search : null; } catch { return null; }
  }).filter(Boolean));
  const wanted = pages.filter((p) => typeof p === 'string' && PAGE_RE.test(p)).slice(0, MAX_TASK_PAGES + 1);
  const pc = await caches.open(PAGES);
  for (const p of wanted) {
    try {
      // A copy saved in the last few minutes is fresh enough; do not re-render every task page
      // on the server each time My day is opened.
      const had = await pc.match(p);
      if (had && Date.now() - Number(had.headers.get('X-KV-Saved-At') || 0) < FRESH_MS) continue;
      const res = await fetch(p, { credentials: 'same-origin', redirect: 'follow' });
      if ((await pagesOwner()) !== userId) return; // someone else signed in meanwhile
      await savePage(p, res);
    } catch { /* no signal: keep what we had */ }
  }
  // Task pages no longer on My day are dropped, so the cache does not grow without end.
  for (const k of await pc.keys()) {
    const p = new URL(k.url).pathname;
    if (p.startsWith('/tasks/') && !wanted.includes(p)) await pc.delete(k);
  }
}

// ------------------------------------------------------------------ background sync of queued proof
// Same database as src/lib/offline/queue.ts: 'karyavahi-offline' v1, stores 'proofs' and 'meta'.
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('karyavahi-offline', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('proofs')) db.createObjectStore('proofs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbDo(store, mode, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

const idbDeleteMeta = (key) => idbDo('meta', 'readwrite', (s) => s.delete(key));

async function patchProof(id, change) {
  const cur = await idbDo('proofs', 'readonly', (s) => s.get(id));
  if (cur) await idbDo('proofs', 'readwrite', (s) => s.put(Object.assign({}, cur, change)));
}

async function tell(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  cs.forEach((c) => c.postMessage(msg));
}

async function sendQueued() {
  const me = await idbDo('meta', 'readonly', (s) => s.get('user'));
  if (!me || !me.value) return; // nobody signed in: never send one person's proof under another's cookie
  const items = ((await idbDo('proofs', 'readonly', (s) => s.getAll())) || [])
    .filter((p) => p.userId === me.value && p.state !== 'refused')
    .sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
  let retry = false;
  for (const p of items) {
    const f = new FormData();
    f.set('client_id', p.id); f.set('task_id', p.taskId); f.set('school_id', p.schoolId || ''); f.set('note', p.note);
    if (p.lat !== null && p.lng !== null) { f.set('lat', String(p.lat)); f.set('lng', String(p.lng)); if (p.accuracy !== null) f.set('accuracy', String(p.accuracy)); }
    if (p.gpsError) f.set('gps_error', p.gpsError);
    f.set('saved_offline_at', p.savedAt);
    if (p.photo) f.set('photo', p.photo, p.photoName || 'photo.jpg');
    let res;
    try {
      res = await fetch('/api/evidence/submit', { method: 'POST', body: f, credentials: 'same-origin' });
    } catch (e) {
      retry = true; break;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      await idbDo('proofs', 'readwrite', (s) => s.delete(p.id));
      await tell({ type: 'proof-sent', id: p.id, result: body });
    } else if (res.status === 401) {
      await patchProof(p.id, { state: 'signed_out', error: body.error || 'Signed out.' });
      break;
    } else if (res.status >= 400 && res.status < 500 && ![408, 425, 429].includes(res.status)) {
      await patchProof(p.id, { state: 'refused', error: body.error || `Refused (${res.status}).`, attempts: (p.attempts || 0) + 1 });
      await tell({ type: 'proof-sent', id: p.id, refused: true });
    } else {
      retry = true; break;
    }
  }
  if (retry) throw new Error('retry later'); // the browser schedules another sync
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'kv-proof-sync') {
    event.waitUntil(self.navigator && self.navigator.locks
      ? self.navigator.locks.request('kv-proof-flush', sendQueued)
      : sendQueued());
  }
});
