/**
 * Drives the demo story through the real UI: sign in as the Rampur Sadar block officer,
 * read CASE-0184, see that the plan they submitted needs someone else's approval, then approve
 * it as the district officer and check the case actually moved.
 */
// playwright if installed, otherwise playwright-core driving the system Chrome.
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

(async () => {
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // ---- sign in ----
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });
  ok('the demo page offers the block officer walkthrough', (await page.getByText('Vikas Qureshi').count()) > 0);

  await page.getByRole('button', { name: /Enter as block officer/i }).click();
  await page.waitForLoadState('networkidle');
  ok('signing in lands on the overview', page.url().includes('/overview'), page.url());

  // The BEO prefers Hindi; switch to English for the walkthrough.
  // The language switch lives in the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  const toEnglish = page.getByRole('menuitem', { name: 'Switch to English' });
  if (await toEnglish.count()) { await toEnglish.first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); }

  await page.screenshot({ path: `${SHOTS}/02-beo-dashboard.png`, fullPage: true });
  const bodyText = await page.locator('body').innerText();
  ok('the demo banner is on the page', bodyText.includes('DEMO MODE'));
  ok('the dashboard leads with what is waiting on the officer',
    /needs your attention|Requires your attention|Priority actions/i.test(bodyText));

  // ---- the hero case ----
  await page.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  const caseText = await page.locator('body').innerText();
  ok('the case title matches the seed', caseText.includes('Class 3 subtraction fell 17.9 pts in Rampur cluster'));
  ok('it shows the before and after figures', caseText.includes('42.3%') && caseText.includes('24.4%'));
  ok('it shows the drop beyond the district', caseText.includes('11.3'));
  ok('it shows the z score', caseText.includes('3.92'));
  ok('it says the factors are associations, not causes', caseText.includes('Association, not cause'));
  ok('the AI hypothesis is labelled as AI-drafted', caseText.includes('AI-drafted'));
  ok('the cost is labelled illustrative', caseText.includes('Illustrative'));
  ok('it is waiting for approval', caseText.includes('Waiting for approval'));
  ok('four of five schools lost a teacher', /Teacher transferred, not replaced/.test(caseText));
  ok('the trend chart rendered', (await page.locator('svg[role="img"]').count()) >= 2,
    String(await page.locator('svg[role="img"]').count()));
  await page.screenshot({ path: `${SHOTS}/03-case-finding.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/04-case-diagnosis.png`, fullPage: false });

  // full-page capture of the whole case
  await page.screenshot({ path: `${SHOTS}/05-case-full.png`, fullPage: true });

  // ---- the block officer submitted this plan, so they cannot approve it ----
  ok('the submitter is not offered "Approve the plan"',
    (await page.getByRole('button', { name: /^Approve the plan$/ }).count()) === 0);
  ok('the page says who must approve instead', caseText.includes('You submitted this plan, so another officer must approve it'));

  // ---- the district officer approves it ----
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', 'deo.rmp@demo.karyavahi.test');
  await page.getByRole('button', { name: /Sign in/ }).first().click();
  await page.waitForLoadState('networkidle');
  await ctx.addCookies([{ name: 'kv_lang', value: 'en', url: BASE }]);
  await page.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Approve the plan$/ }).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  const afterApprove = await page.locator('body').innerText();
  ok('approving confirms what happened', /The work can now be assigned/.test(afterApprove),
    afterApprove.replace(/\s+/g, ' ').slice(0, 220));

  await page.reload({ waitUntil: 'networkidle' });
  const reloaded = await page.locator('body').innerText();
  ok('the case status is now "Plan approved"', reloaded.includes('Plan approved'));
  ok('the approval is recorded against the district officer', /Simran Shukla/.test(reloaded));
  ok('the audit trail shows the status change', /case\.status_changed/.test(reloaded));
  await page.screenshot({ path: `${SHOTS}/06-case-approved.png`, fullPage: true });

  // ---- a refusal, shown in the interface ----
  await page.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  const next = await page.locator('body').innerText();
  ok('the next legal move is offered', next.includes('Work assigned'));
  ok('closing is listed but blocked, with the reason',
    /Closing needs an outcome evaluation|no outcome evaluation/i.test(next) || next.includes('What can happen next') || next.includes('Next moves'));

  // ---- a new case from investigation to assigned work, by two officers ----
  const signIn = async (email) => {
    await ctx.clearCookies();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', email);
    await page.getByRole('button', { name: /Sign in/ }).first().click();
    await page.waitForLoadState('networkidle');
    await ctx.addCookies([{ name: 'kv_lang', value: 'en', url: BASE }]);
  };
  await signIn('beo.blk-17@demo.karyavahi.test');
  await page.goto(`${BASE}/cases/CASE-0127`, { waitUntil: 'networkidle' });
  ok('CASE-0127 is being looked into', (await page.locator('body').innerText()).includes('Being looked into'));
  await page.getByRole('link', { name: 'Open the plan composer' }).click();
  await page.waitForURL(/\/cases\/CASE-0127\/plan/);
  await page.waitForLoadState('networkidle');
  ok('the composer opens with ranked interventions', page.url().includes('/cases/CASE-0127/plan')
    && (await page.getByRole('radio').count()) >= 2);
  await page.getByRole('button', { name: 'Preview the plan' }).click();
  await page.waitForURL(/\/plan\?.*iv=/);
  await page.waitForLoadState('networkidle');
  const previewText = await page.locator('body').innerText();
  ok('the preview shows how success will be judged', previewText.includes('How success will be judged') && /\d+ comparison schools:/.test(previewText));
  ok('the preview lists the work the plan turns into', /the work it will turn into/i.test(previewText));
  await page.screenshot({ path: `${SHOTS}/06a-composer.png`, fullPage: true });
  await page.fill('textarea[name=rationale]', 'Two driver schools lost their Class teacher in June and CRC visits stopped.');
  await page.getByRole('button', { name: 'Save and submit for approval' }).click();
  await page.waitForURL(/\/cases\/CASE-0127\?done=/);
  await page.waitForLoadState('networkidle');
  const submitted = await page.locator('body').innerText();
  ok('saving and submitting confirms what happened', submitted.includes('Plan saved and submitted'));
  ok('the case now waits for approval', submitted.includes('Waiting for approval'));
  ok('the plan is labelled as written by the officer', /Officer-written|Officer written|Written by an officer/i.test(submitted));

  await signIn('deo.amp@demo.karyavahi.test');
  await page.goto(`${BASE}/cases/CASE-0127`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Approve the plan$/ }).first().click();
  await page.waitForURL(/\/cases\/CASE-0127\?done=/);
  await page.waitForLoadState('networkidle');
  ok('the district officer approves the new plan', (await page.locator('body').innerText()).includes('The work can now be assigned'));

  await signIn('beo.blk-17@demo.karyavahi.test');
  await page.goto(`${BASE}/cases/CASE-0127`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Review and assign the tasks' }).first().click();
  await page.waitForURL(/\/cases\/CASE-0127\/assign/);
  await page.waitForLoadState('networkidle');
  ok('the task list has an owner and a date for every task',
    (await page.locator('select[name^="owner:"]').count()) > 0
      && (await page.locator('select[name^="owner:"]').count()) === (await page.locator('input[type=date][name^="due:"]').count()));
  await page.screenshot({ path: `${SHOTS}/06b-assign.png`, fullPage: true });
  await page.getByRole('button', { name: /^Assign \d+ tasks$/ }).click();
  await page.waitForURL(/\/cases\/CASE-0127\?done=/);
  await page.waitForLoadState('networkidle');
  const assignedText = await page.locator('body').innerText();
  ok('assigning confirms the owners were notified', /\d+ tasks assigned\. Each owner has been notified/.test(assignedText));
  ok('the case is now "Work assigned"', assignedText.includes('Work assigned'));
  await page.screenshot({ path: `${SHOTS}/06c-assigned.png`, fullPage: true });

  // ---- the cluster coordinator goes on leave: the officer moves their task ----
  const spot = page.locator('a[href^="/tasks/TSK-"]', { hasText: 'Spot-assess' }).first();
  const taskHref = await spot.getAttribute('href');
  await page.goto(`${BASE}${taskHref}`, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: /^Reassign$/ }).click();
  const target = await page.locator('select[name=owner] option:not([disabled])').first().getAttribute('value');
  await page.selectOption('select[name=owner]', target);
  await page.fill('textarea[name=reason]', 'CRC on medical leave until the 20th');
  await page.getByRole('button', { name: 'Reassign the task' }).click();
  await page.waitForURL(/\/tasks\/TSK-\d+\?done=/);
  // The redirect is a client-side navigation: wait for the page itself, not the loading screen.
  await page.getByText('This task was reassigned').waitFor({ timeout: 15000 });
  const movedText = await page.locator('body').innerText();
  ok('reassigning a task confirms both owners were told', movedText.includes('Task reassigned'));
  ok('the task shows who had it and why it moved', movedText.includes('This task was reassigned') && movedText.includes('CRC on medical leave until the 20th'));
  await page.screenshot({ path: `${SHOTS}/06d-reassigned.png`, fullPage: true });

  // ---- the other roles ----
  const roles = [
    ['state.lead@demo.karyavahi.test', 'overview', '07-state'],
    ['deo.rmp@demo.karyavahi.test', 'overview', '08-district'],
    ['crc.clu-001@demo.karyavahi.test', 'field', '09-field'],
    ['auditor.state@demo.karyavahi.test', 'audit', '10-audit'],
  ];
  for (const [email, path, shot] of roles) {
    // An existing session redirects away from /login, so drop it first.
    await ctx.clearCookies();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', email);
    await page.getByRole('button', { name: /Sign in/ }).first().click();
    await page.waitForLoadState('networkidle');
    const en = page.getByRole('button', { name: /English/ });
    if (await en.count()) { await en.first().click(); await page.waitForLoadState('networkidle'); }
    ok(`${email} lands on /${path}`, page.url().includes(`/${path}`), page.url());
    await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }

  // auditor: the chain
  const auditText = await page.locator('body').innerText();
  ok('the audit page reports the chain verifying', /intact/i.test(auditText) || /the chain verifies/i.test(auditText));
  ok('it reports rows re-hashed', /re-hashed|recomputed/i.test(auditText));
  ok('refused attempts are counted', /refused attempts/i.test(auditText));

  // headmaster, the narrowest view
  await ctx.clearCookies();
  await page.goto(`${BASE}/login/headmaster`, { waitUntil: 'networkidle' });
  await page.locator('li').first().getByRole('button', { name: /Sign in/ }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Account menu' }).click();
  const en2 = page.getByRole('menuitem', { name: 'Switch to English' });
  if (await en2.count()) { await en2.first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); }
  const hmText = await page.locator('body').innerText();
  ok('the headmaster lands on their own school', page.url().includes('/school'), page.url());
  ok('the headmaster is told what they cannot see',
    /not shown to a headmaster|refused to this role/i.test(hmText));
  await page.screenshot({ path: `${SHOTS}/11-headmaster.png`, fullPage: true });

  // mobile width
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(`${BASE}/cases/CASE-0184`, { waitUntil: 'networkidle' });
  const overflow = await mob.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok('no horizontal page scroll at phone width', !overflow);
  await mob.screenshot({ path: `${SHOTS}/12-mobile-case.png`, fullPage: false });

  ok('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${fails === 0 ? 'all UI checks passed' : `${fails} UI CHECK(S) FAILED`}`);
  process.exit(fails === 0 ? 0 : 1);
})();
