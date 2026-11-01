/**
 * End-to-end acceptance checks for the redesigned app, driven through the real UI with the
 * system Chrome (playwright-core, channel 'chrome').
 *
 *   node scripts/e2e-v2.cjs [--ai]      (--ai also runs live model questions; needs ANTHROPIC_API_KEY)
 *
 * Writes to the demo database (a report, a blocker). Run `npm run db:init -- --force` after
 * if you want the pristine seed back.
 */
const { chromium } = require('playwright-core');
const { inflateRawSync } = require('node:zlib');
const BASE = process.env.KV_BASE ?? 'http://localhost:3000';
const WITH_AI = process.argv.includes('--ai');

let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log(`  ok   ${label}`); else { fails++; console.log(`  FAIL ${label} ${extra}`); } };

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const r = await ctx.request.post(`${BASE}/api/sign-in`, { form: { email }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error(`sign-in ${email}: ${r.status()}`);
  // Field staff read in Hindi by default; these checks are written against the English wording.
  await ctx.addCookies([{ name: 'kv_lang', value: 'en', url: BASE }]);
  return ctx;
}

/** Minimal zip reader: returns the list of entry names, inflating one to prove it is valid. */
function zipEntries(buf) {
  const names = [];
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(off + 28), extra = buf.readUInt16LE(off + 30), comment = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString();
    const csize = buf.readUInt32LE(off + 20);
    const lnl = buf.readUInt16LE(local + 26), lex = buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.slice(local + 30 + lnl + lex, local + 30 + lnl + lex + csize));
    names.push({ name, size: data.length, text: name.endsWith('.xml') ? data.toString() : '' });
    off += 46 + nameLen + extra + comment;
  }
  return names;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  require('./no-google-maps.cjs').blockGoogleMaps(browser);
  const errors = [];

  // ---- public pages
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`landing: ${e.message}`));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    ok('landing shows the product statement', await page.getByText('From learning gaps to').count() > 0);
    ok('landing does not list every role', await page.getByText('Auditor').count() === 0);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', 'nobody@demo.karyavahi.test');
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle');
    ok('unknown email is refused with a message', await page.getByRole('alert').count() > 0);
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Enter as block officer/i }).click();
    await page.waitForURL(/\/overview/);
    ok('demo persona signs in to the overview', page.url().endsWith('/overview'));
    await ctx.close();
  }

  // ---- block officer
  const beo = await login(browser, 'beo.blk-01@demo.karyavahi.test');
  const page = await beo.newPage();
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));

  await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
  ok('overview: needs-you-now panel', await page.getByText('Needs you now').count() > 0);
  ok('overview: KPI links to approvals', await page.locator('a[href="/approvals"]').count() > 0);
  ok('overview: no demo-clock controls on the home page', await page.getByText('Reset the demo').count() === 0);

  // Map-first workspace: selection updates the URL in place (no reload) and fills the panel.
  await page.goto(`${BASE}/hotspots?view=list`, { waitUntil: 'networkidle' });
  await page.locator('table tbody').getByRole('button', { name: 'Rampur', exact: true }).click();
  await page.waitForURL(/sel=CLU-/);
  await page.getByText('Most affected competencies').waitFor({ timeout: 15000 });
  ok('hotspots: selecting a cluster opens its detail', await page.getByText('Most affected competencies').count() > 0);
  ok('hotspots: CASE-0184 listed for Rampur cluster', await page.getByText('CASE-0184').count() > 0);
  ok('hotspots: boundary source and simulated-data note shown', await page.getByText(/OpenStreetMap|Illustrative geography/).count() > 0);

  await page.goto(`${BASE}/cases?tab=approval`, { waitUntil: 'networkidle' });
  ok('cases: pending-approval tab lists CASE-0184', await page.getByText('CASE-0184').count() > 0);

  await page.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  ok('case: lifecycle stepper', await page.getByRole('list', { name: 'Case lifecycle' }).count() > 0);
  ok('case: intervention options in the rail', await page.getByText('Intervention options').count() > 0);
  ok('case: similar cases panel', await page.getByText(/Similar cases/).count() > 0);

  await page.goto(`${BASE}/interventions/compare?case=CASE-0184`, { waitUntil: 'networkidle' });
  ok('studio: comparison table with relevance row', await page.getByText('Relevance to CASE-0184').count() > 0);
  await page.goto(`${BASE}/interventions/INT-01?case=CASE-0184&budget=5000&teachers=2&weeks=4&attendance=70`, { waitUntil: 'networkidle' });
  // With the real-data layer INT-01 costs ₹500 a child (PAB rate) times the case schools' UDISE+ Class 3 enrolment.
  const realCosts = require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'data', 'real', 'figures.json'));
  ok('studio: what-if shows a budget shortfall', await page.getByText(realCosts ? /Needs ₹[\d,]+; budget is ₹5,000/ : /Needs ₹12,500/).count() > 0);

  // Report: generate a snapshot through the UI, then export it.
  await page.goto(`${BASE}/reports/new?type=atr`, { waitUntil: 'networkidle' });
  ok('reports: ATR preview built from the ledger', await page.getByText('Cases actioned in the period').count() > 0);
  await page.getByRole('button', { name: 'Generate & save snapshot' }).click();
  await page.waitForURL(/\/reports\/RPT-\d+/, { timeout: 60000 });
  const rid = page.url().match(/RPT-\d+/)[0];
  ok(`reports: snapshot ${rid} saved`, await page.getByText('Report generated').count() > 0);
  const x = await beo.request.get(`${BASE}/api/reports/${rid}/export?format=xlsx`);
  const buf = Buffer.from(await x.body());
  let entries = [];
  try { entries = zipEntries(buf); } catch (e) { errors.push(`xlsx parse: ${e.message}`); }
  ok('reports: xlsx is a valid workbook', entries.some((e) => e.name === 'xl/workbook.xml') && entries.some((e) => e.name.startsWith('xl/worksheets/')));
  const csv = await (await beo.request.get(`${BASE}/api/reports/${rid}/export?format=csv`)).text();
  ok('reports: csv carries the disclaimer', csv.includes('NOT ACTUAL GOVERNMENT STATISTICS'));

  // Blocker: report one on an overdue task this officer can manage.
  await page.goto(`${BASE}/execution?tab=overdue&view=table`, { waitUntil: 'networkidle' });
  const taskLink = page.locator('table a[href^="/tasks/"]').first();
  if (await taskLink.count()) {
    const href = await taskLink.getAttribute('href');
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
    await page.getByText(/Report a blocker…|बाधा दर्ज करें…/).click();
    await page.selectOption('select[name=type]', 'materials_unavailable');
    await page.fill('textarea[name=description]', 'Activity cards not delivered to two schools (e2e test)');
    await page.getByRole('button', { name: /^(Record blocker|दर्ज करें)$/ }).click();
    await page.getByText(/Blocker BLKR-\d+ recorded/).waitFor({ timeout: 20000 }).catch(() => {});
    ok('execution: blocker reported from a task', await page.getByText(/Blocker BLKR-\d+ recorded/).count() > 0);
  } else ok('execution: an overdue task exists to test blockers on', false);

  // Scope: another block's officer cannot open CASE-0184, by page or by export.
  const other = await login(browser, 'beo.blk-09@demo.karyavahi.test');
  const op = await other.newPage();
  await op.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  ok('scope: another BEO is told CASE-0184 is out of scope', await op.getByText(/Outside your scope|आपके दायरे से बाहर/).count() > 0);
  ok('scope: another BEO cannot export the snapshot', (await other.request.get(`${BASE}/api/reports/${rid}/export?format=csv`)).status() === 404);

  // Field role refusals.
  const crc = await login(browser, 'crc.clu-001@demo.karyavahi.test');
  const cp = await crc.newPage();
  await cp.goto(`${BASE}/admin/demo`, { waitUntil: 'networkidle' });
  ok('refusal: CRC cannot use demo controls', await cp.getByText(/Only the demo administrator|केवल डेमो प्रशासक/).count() > 0);

  // ---- complaints through the UI
  {
    const hm = await login(browser, 'hm.sch-00002@demo.karyavahi.test');
    const hp = await hm.newPage();
    hp.on('pageerror', (e) => errors.push(`hm: ${e.message}`));
    await hp.goto(`${BASE}/complaints/new?category=material_shortage`, { waitUntil: 'networkidle' });
    ok('complaint form previews the routing before submit', await hp.getByText(/Goes to/).count() > 0);
    const title = `Reading cards missing (e2e ${Date.now() % 100000})`;
    await hp.fill('input[name=title]', title);
    await hp.fill('textarea[name=description]', 'No reading cards for Class 2 this term; teachers improvising.');
    await hp.getByRole('button', { name: /Submit complaint|शिकायत जमा करें/ }).click();
    await hp.waitForURL(/\/complaints\/CMP-\d+/, { timeout: 30000 });
    const cmpId = hp.url().match(/CMP-\d+/)[0];
    ok(`complaint ${cmpId} submitted and acknowledged-by date shown`, await hp.getByText(/Complaint submitted/).count() > 0);

    const crcCtx = await login(browser, 'crc.clu-001@demo.karyavahi.test');
    const cp2 = await crcCtx.newPage();
    await cp2.goto(`${BASE}/complaints?queue=mine`, { waitUntil: 'networkidle' });
    ok('the designated CRC sees it in “waiting on you”', await cp2.getByText(title).count() > 0);
    await cp2.goto(`${BASE}/complaints/${cmpId}`, { waitUntil: 'networkidle' });
    await cp2.getByRole('button', { name: /^Acknowledge$/ }).click();
    // The Acknowledge button disappears once it is used; the status chip is the confirmation.
    await cp2.getByRole('button', { name: /^Acknowledge$/ }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
    await cp2.reload({ waitUntil: 'networkidle' });
    ok('the CRC acknowledges it in the UI', await cp2.getByText('Acknowledged', { exact: true }).count() > 0 && await cp2.getByRole('button', { name: /^Acknowledge$/ }).count() === 0);
    // The loading screen streams the page before the access check, so a refusal arrives as the
    // not-found page with status 200 rather than 404. What matters is that nothing of it leaks.
    const leaks = (html) => /Visit records entered without visits|coaching visits on dates when no one came/.test(html);
    await cp2.goto(`${BASE}/complaints/CMP-0005`, { waitUntil: 'networkidle' });
    ok('the accused CRC is shown nothing of the restricted complaint about them',
      await cp2.getByText('Nothing at this address').count() > 0 && !leaks(await cp2.content()));
    const deoCtx = await login(browser, 'deo.rmp@demo.karyavahi.test');
    const dres = await deoCtx.request.get(`${BASE}/complaints/CMP-0005`);
    ok('a senior DEO not on its route is shown nothing of it either', [200, 404].includes(dres.status()) && !leaks(await dres.text()));
  }

  // ---- the real map
  {
    const mp = await beo.newPage();
    mp.on('pageerror', (e) => errors.push(`map: ${e.message}`));
    await mp.goto(`${BASE}/hotspots`, { waitUntil: 'networkidle' });
    // Google Maps when a browser key is configured, MapLibre otherwise.
    const mapDrawn = 'canvas.maplibregl-canvas, .gm-style';
    await mp.locator(mapDrawn).first().waitFor({ timeout: 30000 }).catch(() => {});
    ok('the map renders', await mp.locator(mapDrawn).count() > 0);
    ok('map opens at the officer’s block', await mp.getByRole('navigation', { name: 'Geographic breadcrumb' }).getByText('Rampur Sadar').count() > 0);
    await mp.getByRole('toolbar', { name: 'Map tools' }).getByRole('button', { name: 'Layers' }).click();
    await mp.getByRole('checkbox', { name: /Open complaints/ }).check();
    await mp.waitForURL(/layers=[^&]*complaints/);
    ok('turning on the complaints overlay updates the URL in place', /layers=[^&]*complaints/.test(mp.url()));
    const api = await beo.request.get(`${BASE}/api/geo/map?parent=DST-01`);
    ok('the map API refuses the district to a block officer', api.status() === 404);
  }

  // ---- registration → verification → approval
  {
    const anon = await browser.newContext();
    const rp = await anon.newPage();
    const email = `e2e.${Date.now() % 1000000}@demo.karyavahi.test`;
    await rp.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await rp.fill('input[name=full_name]', 'E2E Applicant');
    await rp.fill('input[name=email]', email);
    await rp.selectOption('select[name=role]', 'headmaster');
    const selects = rp.locator('fieldset select');
    await selects.nth(1).selectOption({ label: 'Rampur' });
    await selects.nth(2).selectOption({ label: 'Rampur Sadar' });
    await selects.nth(3).selectOption({ index: 1 });
    await selects.nth(4).selectOption({ index: 1 });
    await rp.fill('input[name=affiliation_ref]', 'EMP-EDU-4471');
    await rp.getByRole('button', { name: 'Submit request' }).click();
    await rp.waitForURL(/\/register\/status/, { timeout: 30000 });
    ok('the status address carries the reference, not the email', !rp.url().includes('email') && !rp.url().includes(encodeURIComponent(email)));
    ok('registration shows the demo verification code', await rp.getByText(/Your code is/).count() > 0);
    await rp.getByRole('button', { name: 'Verify' }).click();
    await rp.getByRole('button', { name: 'Check affiliation' }).waitFor({ timeout: 20000 });
    await rp.getByRole('button', { name: 'Check affiliation' }).click();
    await rp.getByText(/Approval pending/).first().waitFor({ timeout: 20000 }).catch(() => {});
    ok('after the simulated checks the request waits for approval', await rp.getByText(/Approval pending/).count() > 0);
    const signInBefore = await anon.request.post(`${BASE}/api/sign-in`, { form: { email }, maxRedirects: 0 });
    ok('an unapproved applicant cannot sign in', (signInBefore.headers()['location'] ?? '').includes('error='));
    const ap = await beo.newPage();
    await ap.goto(`${BASE}/admin/accounts?tab=queue`, { waitUntil: 'networkidle' });
    const card = ap.locator('li', { hasText: email });
    await card.getByRole('button', { name: /^Approve$/ }).click();
    // Once decided, the card stays in the list with its new status and no decision buttons.
    for (let t = 0; t < 60 && !/account active/i.test(await card.innerText().catch(() => '')); t++) await ap.waitForTimeout(500);
    ok('the block officer approves it', await card.getByRole('button', { name: /^Approve$/ }).count() === 0 && /account active/i.test(await card.innerText()));
    const signInAfter = await anon.request.post(`${BASE}/api/sign-in`, { form: { email }, maxRedirects: 0 });
    ok('the approved account can now sign in', signInAfter.status() === 303 && !(signInAfter.headers()['location'] ?? '').includes('error='));
  }

  // ---- AI (live model)
  if (WITH_AI) {
    const ask = async (ctx, question, context) => {
      const r = await ctx.request.post(`${BASE}/api/ai/chat`, { data: { messages: [{ role: 'user', content: question }], context }, timeout: 240000 });
      const events = (await r.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      return {
        status: r.status(),
        text: events.filter((e) => e.type === 'text').map((e) => e.delta).join(''),
        tools: events.filter((e) => e.type === 'tool_start').map((e) => e.name),
        done: events.find((e) => e.type === 'done'),
        error: events.find((e) => e.type === 'error'),
      };
    };
    const a1 = await ask(beo, 'Which cases need my approval right now, and what is the most urgent one?');
    ok('ai: answers an approvals question', a1.status === 200 && !a1.error && a1.text.length > 40, a1.error?.message ?? '');
    ok('ai: used a retrieval tool', a1.tools.length > 0, a1.tools.join(','));
    ok('ai: cites CASE-0184', (a1.done?.sources ?? []).includes('CASE-0184') || a1.text.includes('CASE-0184'));
    const a2 = await ask(beo, 'Explain this case and what is missing before it can close.', { caseId: 'CASE-0184', path: '/cases/CASE-0184' });
    ok('ai: context-aware case question uses case tools', a2.tools.includes('get_case_details') || a2.tools.includes('get_outcome_evaluation'), a2.tools.join(','));
    const otherCase = 'CASE-0053'; // BLK-09 — outside the Rampur Sadar BEO's scope
    const a3 = await ask(beo, `Give me the full details of ${otherCase}.`);
    ok(`ai: refuses out-of-scope ${otherCase}`, !/(Class \d .* fell|z = )/.test(a3.text) && /scope|access|cannot|not able|unable/i.test(a3.text), a3.text.slice(0, 200));
  }

  ok('no client-side page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall e2e checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
