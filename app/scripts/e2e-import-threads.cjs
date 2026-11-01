/**
 * Drives the two newer features through the real UI:
 *
 *   1. the demo admin moves the clock to 20 Nov 2026 (R4's window is open)
 *   2. the Rampur Sadar BEO uploads the R4 sample file, previews it, commits it, sees the
 *      detection run open new cases — and gets "already imported" on a second try
 *   3. on a new case, the BEO mentions the DEO, records a decision, edits a comment and
 *      unfollows/follows; the DEO then finds the mention in their notifications
 *
 * Mutates the database. Reset afterwards with `npm run db:init -- --force` (server stopped).
 *
 *   KV_BASE=http://localhost:3021 node scripts/e2e-import-threads.cjs
 */
let chromium, launchOpts = {};
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); launchOpts = { channel: 'chrome' }; }
const path = require('node:path');
const SHOTS = process.env.KARYAVAHI_SHOTS ?? '/tmp/karyavahi-shots';
require('node:fs').mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.KV_BASE ?? 'http://localhost:3000';
const SAMPLE = path.join(__dirname, '..', 'samples', 'R4_midline_BLK-01_with_errors.csv');

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { fails++; console.log(`  FAIL ${label} ${extra}`); }
};

(async () => {
  const browser = await chromium.launch(launchOpts);
  require('./no-google-maps.cjs').blockGoogleMaps(browser);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const signIn = async (email) => {
    await ctx.clearCookies();
    await ctx.addCookies([{ name: 'kv_lang', value: 'en', url: BASE }]);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', email);
    await page.getByRole('button', { name: /Sign in/ }).first().click();
    await page.waitForLoadState('networkidle');
  };

  // ---- 1. the clock ----
  await signIn('admin@demo.karyavahi.test');
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  const move = page.getByRole('button', { name: /Move the demo clock to 20 Nov 2026/ });
  if (await move.count()) { await move.click(); await page.waitForTimeout(1500); await page.reload({ waitUntil: 'networkidle' }); }
  ok('the demo clock reads 20 Nov 2026', (await page.getByText('20 Nov 2026').count()) > 0);

  // ---- 2. the import ----
  await signIn('beo.blk-01@demo.karyavahi.test');
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', SAMPLE);
  await page.getByRole('button', { name: 'Check the file' }).click();
  const preview = page.getByTestId('import-preview');
  await preview.waitFor({ timeout: 30000 });
  const ptext = await preview.innerText();
  ok('the preview names the round and the BEO\'s block', /R4 · Midline 2026-27/.test(ptext) && /Rampur Sadar/.test(ptext), ptext.slice(0, 200));
  ok('the preview counts 2,340 good rows and 9 refused', ptext.includes('2,340') && /Will be refused\s*9/i.test(ptext), ptext.slice(0, 400));
  ok('the preview lists the refusal reasons', ptext.includes('proficient exceeds assessed') && ptext.includes('unknown school id') && ptext.includes('invalid date'));
  await page.screenshot({ path: `${SHOTS}/f01-import-preview.png`, fullPage: true });

  await page.getByRole('button', { name: /Commit 2,340 rows and run detection/ }).click();
  const result = page.getByTestId('import-result');
  await result.waitFor({ timeout: 60000 });
  const rtext = await result.innerText();
  ok('the commit reports the batch', /Import committed/.test(rtext) && /IMP-\d{4}/.test(rtext), rtext.slice(0, 200));
  ok('the detection run reports R4 against R3', /Detection run: R4 compared with R3/.test(rtext));
  const caseIds = [...new Set((rtext.match(/CASE-\d{4}/g) ?? []))];
  ok('detection opened new cases', caseIds.length >= 2, rtext);
  await page.screenshot({ path: `${SHOTS}/f02-import-result.png`, fullPage: true });

  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', SAMPLE);
  await page.getByRole('button', { name: 'Check the file' }).click();
  await page.getByTestId('import-preview').waitFor({ timeout: 30000 });
  ok('the same file a second time is recognised as already imported', (await page.getByText('Already imported').count()) > 0);
  ok('...and cannot be committed again', await page.getByRole('button', { name: /Commit .* rows and run detection/ }).isDisabled());

  // ---- 3. the thread on a new case ----
  const caseId = caseIds[0];
  await page.goto(`${BASE}/cases/${caseId}`, { waitUntil: 'networkidle' });
  ok('the new case opens for its BEO', (await page.getByRole('heading', { name: /fell .* pts in .* cluster/ }).count()) > 0);
  ok('the case has its discussion', (await page.locator('#discussion').count()) === 1);
  const composer = page.getByTestId('thread-composer');
  const options = await composer.locator('select option').allInnerTexts();
  ok('the mention list offers only people who can see the case (DEO yes, another block\'s BEO no)',
    options.some((o) => /— DEO/.test(o)) && !options.some((o) => /— BEO/.test(o) && !/Qureshi/.test(o)), options.join(' | '));

  // Type @ and a few letters of the DEO's name to bring up the picker.
  const deoOption = options.find((o) => /— DEO/.test(o));
  const deoName = deoOption.split(' — ')[0];
  const box = composer.locator('textarea');
  await box.click();
  await box.pressSequentially(`Please look at the driver schools before the review. @${deoName.slice(0, 4)}`);
  const pickerItem = composer.getByRole('listbox').getByRole('option', { name: new RegExp(deoName) });
  ok('typing @ shows matching people', (await pickerItem.count()) === 1);
  await pickerItem.click();
  ok('choosing adds a mention chip', (await composer.getByText(`@${deoName}`).count()) > 0);
  await composer.getByRole('button', { name: 'Post comment' }).click();
  await composer.getByText(/Comment posted; 1 person was notified/).waitFor({ timeout: 15000 });
  ok('the comment posts and the mention is notified', true);
  await page.waitForLoadState('networkidle');
  ok('the comment shows with its mention', (await page.getByText(`Mentioned: @${deoName}`).count()) > 0);

  await box.fill('Decision: CRC to run a spot assessment in the driver schools this week before any plan is drafted.');
  await composer.getByLabel(/Record this as a decision/).check();
  await composer.getByRole('button', { name: 'Post comment' }).click();
  await composer.getByText(/Decision recorded/).waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle' });
  ok('the decision is marked in the thread', (await page.locator('#discussion').getByText('Decision', { exact: true }).count()) > 0);
  ok('the decision is in the case history', (await page.getByText(/decision recorded/i).count()) > 0);

  const first = page.locator('li[id^="comment-"]').first();
  await first.getByText('Edit', { exact: true }).click();
  const edit = first.locator('form');
  await edit.locator('textarea').fill(`Please look at the driver schools before Friday's review. @${deoName}`);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await edit.getByText('Comment updated.').waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle' });
  ok('an edited comment is marked as edited', (await page.locator('li[id^="comment-"]').first().getByText(/\(edited/).count()) === 1);

  const unfollow = page.getByRole('button', { name: 'Unfollow' });
  ok('the owner starts out following', (await unfollow.count()) === 1);
  await unfollow.click();
  await page.getByRole('status').filter({ hasText: 'You have unfollowed this case' }).waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'You are following this case' }).waitFor({ timeout: 15000 });
  ok('unfollow and follow both work', true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#discussion').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/f03-thread.png`, fullPage: true });

  // ---- the mentioned DEO ----
  await signIn('deo.rmp@demo.karyavahi.test');
  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  ok('the DEO finds the mention in their notifications', (await page.getByText(new RegExp(`mentioned you on ${caseId}`)).count()) > 0);
  await page.screenshot({ path: `${SHOTS}/f04-deo-notifications.png`, fullPage: true });

  ok('no uncaught page errors', errors.length === 0, errors.join('\n'));
  await browser.close();
  console.log(fails === 0 ? '\nall feature checks passed' : `\n${fails} feature check(s) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
