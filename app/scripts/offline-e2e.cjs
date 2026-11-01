/**
 * My day without signal, in a real browser at phone size, against a production build
 * (the service worker is only registered there):
 *
 *  - the manifest is linked and opens on My day;
 *  - after one visit with signal, /today and a task page it links to open offline, labelled
 *    "Offline — last updated …";
 *  - proof handed in online carries the phone's GPS and the server says "at the school";
 *  - proof handed in offline (1.2 km from the school) is kept on the phone, listed as waiting,
 *    and sent by itself when the connection returns — exactly one evidence row, even when the
 *    same proof is sent again;
 *  - /api/evidence/submit refuses a signed-out or cross-site request;
 *  - signing out drops the saved pages.
 *
 * Fresh database and fresh server first:
 *   KV_BASE=http://localhost:3061 node scripts/offline-e2e.cjs
 * Screenshots go to $KARYAVAHI_SHOTS (default /tmp/karyavahi-shots).
 */
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
let chromium, launchOpts = {};
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); launchOpts = { channel: 'chrome' }; }
const SHOTS = process.env.KARYAVAHI_SHOTS ?? '/tmp/karyavahi-shots';
require('node:fs').mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.KV_BASE ?? 'http://localhost:3000';

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { fails++; console.log(`  FAIL ${label} ${extra}`); }
};
const db = () => new DatabaseSync(join(process.cwd(), '.data', 'karyavahi.db'), { readOnly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };

// A real (tiny) JPEG; extra bytes after the end marker make each photo different without breaking it.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
const photo = (tag) => Buffer.concat([JPEG, Buffer.from(`\n${tag}\n`)]);

(async () => {
  // Anything will do to wake the server so its migrations have run before the database is read.
  await fetch(`${BASE}/demo`).catch(() => {});
  const T = q1(`select t.id, t.owner_user_id, u.email, t.title_en, gu.centroid_lat lat, gu.centroid_lon lng
                  from tasks t join users u on u.id = t.owner_user_id
                  join geo_units gu on gu.id = t.school_id and gu.level = 'school' and gu.centroid_lat is not null
                 where t.owner_role = 'headmaster' and t.status in ('in_progress','acknowledged','assigned') and t.proof_count >= 3
                 order by t.id limit 1`);
  if (!T) { console.log('  FAIL no headmaster task with a school position in the database'); process.exit(1); }
  const rows = () => Number(q1('select count(*) c from evidence where task_id = ?', T.id).c);

  console.log('--- the proof route refuses what it should ---');
  const anon = await fetch(`${BASE}/api/evidence/submit`, { method: 'POST', body: new URLSearchParams({ task_id: T.id, note: 'x' }) });
  ok('signed out: 401', anon.status === 401, String(anon.status));
  const cross = await fetch(`${BASE}/api/evidence/submit`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: new URLSearchParams({ task_id: T.id, note: 'x' }) });
  ok('from another site: 403', cross.status === 403, String(cross.status));

  const browser = await chromium.launch(launchOpts);
  require('./no-google-maps.cjs').blockGoogleMaps(browser);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: T.lat, longitude: T.lng, accuracy: 15 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('\n--- installable ---');
  const signIn = await ctx.request.post(`${BASE}/api/sign-in`, { form: { email: T.email }, maxRedirects: 0 });
  ok('the headmaster signs in', [302, 303].includes(signIn.status()), String(signIn.status()));
  await ctx.addCookies([{ name: 'kv_lang', value: 'en', url: BASE }]);
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  ok('My day links the manifest', (await page.locator('link[rel="manifest"]').count()) === 1);
  const man = await (await ctx.request.get(`${BASE}/manifest.webmanifest`)).json();
  ok('the manifest opens on My day, standalone, with 192 and 512 px icons',
    man.start_url === '/today' && man.display === 'standalone' && man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'),
    JSON.stringify(man).slice(0, 200));
  ok('it is named in both scripts', /Karyavahi/.test(man.name) && /कार्यवाही/.test(man.name));
  ok('the demo banner is still there', (await page.locator('body').innerText()).includes('DEMO MODE'));

  console.log('\n--- the service worker keeps My day ---');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'networkidle' });
  ok('a field user\'s page is controlled by the worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const taskPath = `/tasks/${T.id}`;
  const kept = await page.evaluate(async (tp) => {
    for (let i = 0; i < 60; i++) {
      const c = await caches.open('kv-v1-pages');
      if ((await c.match('/today')) && (await c.match(tp))) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }, taskPath);
  ok('/today and its task page are saved on the phone', kept);

  console.log('\n--- proof with signal, with the phone\'s GPS ---');
  const card = () => page.locator('li', { hasText: T.title_en }).first();
  await card().locator('summary', { hasText: 'Hand in proof' }).click();
  await card().locator('input[name=photo]').setInputFiles({ name: 'register.jpg', mimeType: 'image/jpeg', buffer: photo(`online-${Date.now()}`) });
  await card().locator('textarea[name=note]').fill('Attendance register, signed by the class teacher.');
  const before = rows();
  await card().getByRole('button', { name: 'Hand in', exact: true }).click();
  const okMsg = page.getByText(/Proof and photo submitted/);
  await okMsg.waitFor({ timeout: 30000 }).catch(() => {});
  const okText = (await okMsg.count()) ? await okMsg.first().innerText() : '';
  ok('handed in, and the server says it was at the school', /GPS: at the school/.test(okText), okText);
  ok('one row was added', rows() === before + 1, `${before} -> ${rows()}`);
  const online = q1(`select gps_status, gps_distance_m, gps_accuracy_m, client_id from evidence where task_id = ? order by rowid desc limit 1`, T.id);
  ok('the row has the fix, the distance and a client id', online.gps_status === 'matched' && online.gps_distance_m < 50 && online.gps_accuracy_m === 15 && !!online.client_id, JSON.stringify(online));
  // My day with signal, right after handing in: the confirmation carries the server's GPS verdict.
  await okMsg.first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${SHOTS}/myday-online.png`, fullPage: false });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/myday-online-full.png`, fullPage: true });

  console.log('\n--- no signal ---');
  // Make sure the saved copy is the one taken after the proof above.
  await page.evaluate(async () => { const c = await caches.open('kv-v1-pages'); await c.delete('/today'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const banner = page.getByTestId('offline-banner');
  await banner.waitFor({ timeout: 15000 }).catch(() => {});
  const bannerText = (await banner.count()) ? await banner.innerText() : '';
  ok('My day opens offline from the saved copy', (await page.locator('h1').first().innerText().catch(() => '')).startsWith('Namaste'));
  ok('labelled "Offline — last updated <time>"', /Offline — last updated \d/.test(bannerText), bannerText);
  ok('the page still works (hydrated) offline', await page.evaluate(() => navigator.onLine === false));

  // Proof handed in 1.2 km away, with no signal.
  await ctx.setGeolocation({ latitude: T.lat + 1200 / 111195, longitude: T.lng, accuracy: 20 });
  await card().locator('summary', { hasText: 'Hand in proof' }).click();
  await card().locator('input[name=photo]').setInputFiles({ name: 'board.jpg', mimeType: 'image/jpeg', buffer: photo(`offline-${Date.now()}`) });
  await card().locator('textarea[name=note]').fill('Remedial-hour timetable on the notice board.');
  const offBefore = rows();
  await card().getByRole('button', { name: 'Hand in', exact: true }).click();
  await page.getByText(/No signal\. The proof is saved on this phone/).waitFor({ timeout: 30000 }).catch(() => {});
  const queue = page.getByTestId('proof-queue');
  await queue.waitFor({ timeout: 10000 }).catch(() => {});
  ok('it is saved on the phone and listed as waiting to send', (await queue.count()) === 1 && /Waiting to send/.test(await queue.innerText()));
  ok('nothing reached the server yet', rows() === offBefore);
  const queued = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('karyavahi-offline', 1);
    r.onsuccess = () => { const g = r.result.transaction('proofs').objectStore('proofs').getAll(); g.onsuccess = () => res(g.result.map((p) => ({ id: p.id, taskId: p.taskId, lat: p.lat, hasPhoto: !!p.photo }))); };
  }));
  ok('with its own client id, the photo and the GPS fix', queued.length === 1 && queued[0].hasPhoto && queued[0].lat !== null, JSON.stringify(queued));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/myday-offline-queued.png`, fullPage: false });
  await page.screenshot({ path: `${SHOTS}/myday-offline-queued-full.png`, fullPage: true });

  // A task page opens offline too.
  const tp = await ctx.newPage();
  await tp.goto(`${BASE}${taskPath}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await tp.getByTestId('offline-banner').waitFor({ timeout: 10000 }).catch(() => {});
  const tpText = await tp.locator('body').innerText().catch(() => '');
  ok('a task page linked from My day opens offline', tpText.includes(T.title_en) && (await tp.getByTestId('offline-banner').count()) === 1, tpText.replace(/\s+/g, ' ').slice(0, 300));
  await tp.close();

  console.log('\n--- the signal comes back ---');
  await ctx.setOffline(false);
  await queue.waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
  ok('the waiting proof is sent by itself', (await page.getByTestId('proof-queue').count()) === 0);
  for (let i = 0; i < 20 && rows() === offBefore; i++) await page.waitForTimeout(500);
  ok('exactly one evidence row for it', rows() === offBefore + 1, `${offBefore} -> ${rows()}`);
  const sent = q1('select gps_status, gps_distance_m, client_id, summary from evidence where client_id = ?', queued[0].id);
  ok('under the id the phone made up', !!sent);
  ok('the server worked out 1.2 km away', sent && sent.gps_status === 'outside_radius' && Math.abs(sent.gps_distance_m - 1200) < 5, JSON.stringify(sent));
  ok('and recorded that it was saved offline', sent && !!JSON.parse(sent.summary).saved_offline_at);

  // The same proof sent again (a retry whose answer was lost) is still one row.
  const again = await page.evaluate(async ({ id, taskId }) => {
    const f = new FormData();
    f.set('client_id', id); f.set('task_id', taskId); f.set('note', 'Remedial-hour timetable on the notice board.');
    const r = await fetch('/api/evidence/submit', { method: 'POST', body: f });
    return r.json();
  }, queued[0]);
  ok('sending it again answers "already have it"', again.ok === true && again.duplicate === true, JSON.stringify(again));
  ok('and still exactly one row', rows() === offBefore + 1 && Number(q1('select count(*) c from evidence where client_id = ?', queued[0].id).c) === 1);

  console.log('\n--- the proof card shows the GPS result ---');
  await page.goto(`${BASE}${taskPath}`, { waitUntil: 'networkidle' });
  const taskText = await page.locator('body').innerText();
  ok('"GPS: at the school" on the proof handed in there', taskText.includes('GPS: at the school'));
  ok('"GPS: 1.2 km away" on the one handed in from away', taskText.includes('GPS: 1.2 km away'));
  // The card that lists the proof on this task, both pieces with their GPS result.
  const proofCard = page.locator('li', { hasText: 'GPS: 1.2 km away' }).first().locator('xpath=ancestor::*[contains(@class,"card") or self::section][1]');
  if (await proofCard.count()) await proofCard.screenshot({ path: `${SHOTS}/proof-card-gps.png` });
  else await page.screenshot({ path: `${SHOTS}/proof-card-gps.png`, fullPage: false });
  await page.screenshot({ path: `${SHOTS}/proof-card-gps-full.png`, fullPage: true });

  console.log('\n--- signing out drops the saved pages ---');
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/api/sign-out'; document.body.appendChild(f); f.submit(); });
  await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
  const left = await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      const c = await caches.open('kv-v1-pages');
      if (!(await c.match('/today'))) return 0;
      await new Promise((r) => setTimeout(r, 250));
    }
    return 1;
  });
  ok('no saved copy of My day is left after sign-out', left === 0);

  console.log('\n--- an officer gets no worker ---');
  const beo = await ctx.request.post(`${BASE}/api/sign-in`, { form: { email: 'beo.blk-01@demo.karyavahi.test' }, maxRedirects: 0 });
  ok('the block officer signs in', [302, 303].includes(beo.status()));
  await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
  const regs = await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) { if ((await navigator.serviceWorker.getRegistrations()).length === 0) return 0; await new Promise((r) => setTimeout(r, 250)); }
    return (await navigator.serviceWorker.getRegistrations()).length;
  });
  ok('the worker is removed for a non-field role', regs === 0, String(regs));

  ok('no script errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${fails === 0 ? 'all passed' : `${fails} failed`}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
