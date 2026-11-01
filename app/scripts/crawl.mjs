#!/usr/bin/env node
/**
 * Fetches every route as every demo role.
 *
 * Record pages use an id that role can actually see, so a 404 means a real problem rather than
 * row-level security doing its job. The scope refusals are checked separately at the end.
 *
 *   node scripts/crawl.mjs [baseUrl]
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const db = new DatabaseSync(join(process.cwd(), '.data', 'karyavahi.db'));

const accounts = db.prepare(`
  select u.id, u.email, ur.role, ur.scope_type, ur.scope_id
    from users u join user_roles ur on ur.user_id = u.id
   where u.is_demo_account = 1 order by u.id`).all();
accounts.push(db.prepare(`
  select u.id, u.email, ur.role, ur.scope_type, ur.scope_id
    from users u join user_roles ur on ur.user_id = u.id
   where ur.role = 'headmaster' limit 1`).get());

/** An id of each kind that this particular account can see, or null. */
function idsFor(a) {
  const q = (sql, ...p) => db.prepare(sql).get(...p)?.id ?? null;
  const scopeCase =
    a.scope_type === 'state' ? q(`select id from cases limit 1`)
    : a.scope_type === 'district' ? q(`select id from cases where district_id = ? limit 1`, a.scope_id)
    : a.scope_type === 'block' ? q(`select id from cases where block_id = ? limit 1`, a.scope_id)
    : a.scope_type === 'cluster' ? q(`select id from cases where cluster_id = ? limit 1`, a.scope_id)
    : q(`select case_id as id from tasks where owner_user_id = ? limit 1`, a.id);
  let complaintId = null;
  try { complaintId = q(`select id from complaints where reporter_user_id = ? or assigned_user_id = ? limit 1`, a.id, a.id); } catch { /* table created by the app on first run */ }
  return {
    complaintId,
    caseId: scopeCase,
    // A case the composer can open, where the role's area has one.
    planCaseId: a.scope_type === 'state' ? q(`select id from cases where status = 'under_investigation' limit 1`)
      : a.scope_type === 'district' ? q(`select id from cases where status = 'under_investigation' and district_id = ? limit 1`, a.scope_id)
      : a.scope_type === 'block' ? q(`select id from cases where status = 'under_investigation' and block_id = ? limit 1`, a.scope_id)
      : null,
    taskId: q(`select id from tasks where owner_user_id = ? limit 1`, a.id)
         ?? (scopeCase ? q(`select id from tasks where case_id = ? limit 1`, scopeCase) : null),
    findingId: scopeCase ? q(`select id from findings where case_id = ? limit 1`, scopeCase) : null,
    schoolId:
      a.scope_type === 'school' ? a.scope_id
      : a.scope_type === 'cluster' ? q(`select id from schools where cluster_id = ? limit 1`, a.scope_id)
      : a.scope_type === 'block' ? q(`select id from schools where block_id = ? limit 1`, a.scope_id)
      : a.scope_type === 'district' ? q(`select id from schools where district_id = ? limit 1`, a.scope_id)
      : q(`select id from schools limit 1`),
    reportId: ['state_admin', 'auditor', 'demo_admin'].includes(a.role)
      ? q(`select id from reports limit 1`)
      : q(`select id from reports where scope_id = ? limit 1`, a.scope_id),
    batchId: ['beo', 'deo', 'state_admin', 'auditor', 'demo_admin'].includes(a.role)
      ? q(`select id from import_batches limit 1`) : null,
  };
}

const heroCase = 'CASE-0184';
const blk09Beo = db.prepare(`
  select u.id from users u join user_roles ur on ur.user_id = u.id
   where ur.role = 'beo' and ur.scope_id = 'BLK-09' limit 1`).get().id;
const IDS = new Map(accounts.map((a) => [a.id, idsFor(a)]));
db.close();

const COMMON = [
  '/', '/today', '/beo', '/district', '/state', '/field', '/school', '/admin', '/admin/jobs', '/admin/outbox',
  '/cases', '/cases?status=open', '/cases?status=closed', '/cases?severity=critical',
  '/findings', '/findings?status=rejected_noise', '/findings?status=rejected_data_quality',
  '/tasks', '/tasks?filter=overdue', '/tasks?filter=verified', '/tasks?filter=all',
  '/approvals', '/evidence', '/notifications', '/visits',
  '/schools', '/interventions', '/interventions/INT-01', '/interventions/INT-12',
  '/reports', '/import', '/settings', '/audit', '/audit?result=failure', '/ai-log',
  '/assistant', '/assistant?q=waiting_on_me', '/assistant?q=what_worked', '/assistant?q=worst_now',
  '/assistant?q=detector_refused', '/assistant?q=stuck', '/assistant?q=reopened',
  // redesign
  '/overview', '/admin/demo', '/admin/access', '/search?q=subtraction', '/search?q=CASE-0184',
  '/hotspots', '/hotspots?view=list', '/hotspots?grade=3&subject=N', '/hotspots?level=cluster&selected=CLU-001',
  '/cases?tab=critical', '/cases?tab=approval', '/cases?tab=overdue', '/cases?tab=verification', '/cases?tab=reopened', '/cases?tab=all&order=recent',
  '/interventions?case=CASE-0184', '/interventions?subject=numeracy&lever=block', '/interventions/compare?ids=INT-01,INT-04',
  '/interventions/INT-01?schools=5&budget=5000&teachers=2&weeks=4&attendance=70',
  '/execution', '/execution?tab=overdue', '/execution?tab=soon', '/execution?tab=check', '/execution?tab=blockers', '/execution?tab=workload',
  '/impact', '/impact?state=improved_confirmed', '/reports/new', '/reports/new?type=atr', '/reports/new?type=learning_impact',
  '/reports/new?type=exceptions', '/reports/new?type=review_pack', '/reports/new?type=block_performance',
  '/reports/new?type=intervention_effectiveness', '/reports/new?type=data_quality', '/reports/new?type=executive_summary',
  // geography, complaints, onboarding
  '/hotspots?layer=complaints', '/hotspots?h=urban', '/api/geo/map', '/api/geo/search?q=ram',
  '/complaints', '/complaints?queue=all', '/complaints?queue=overdue', '/complaints?queue=escalated', '/complaints/new', '/complaints/new?category=conduct',
  '/account', '/admin/accounts', '/admin/accounts?tab=users', '/admin/hierarchy', '/admin/geography', '/register', '/register/status',
  // the read-only API for state dashboards: the key manager (state team and demo admin; everyone
  // else is shown a refusal) and the plain-words API guide (every signed-in role)
  '/admin/api-keys', '/developers', '/sources', '/roadmap',
  // user feedback: the review page (state team and demo admin; everyone else is shown a refusal)
  // and "What we changed after testing" (every signed-in role)
  '/admin/feedback', '/admin/feedback?kind=claude_answer&tone=down', '/changes',
];

// Real failure signatures. Next serialises its own 404 component into every page's payload,
// so the words "This page could not be found" are not evidence of anything.
const MARKERS = ['Application error: a server-side exception', 'Internal Server Error', 'SQLITE_ERROR', 'ERR_SQLITE'];

let problems = 0, checked = 0, refusals = 0;

/** fetch that waits out a dev-server restart. `next dev` restarts itself when its memory gets
 *  high, which a crawl of every route can trigger; sessions live in the database, so they survive. */
async function fetchRetry(url, init) {
  for (let attempt = 1; ; attempt++) {
    try { return await fetch(url, init); }
    catch (e) {
      // The dev server restarts itself under memory pressure; any of these means "try again".
      if (!['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(e?.cause?.code) || attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Signs in once per account the way the browser does, and keeps the session token. */
const tokens = new Map();
async function tokenFor(userId) {
  if (!tokens.has(userId)) {
    const res = await fetchRetry(`${BASE}/api/sign-in`, { method: 'POST', body: new URLSearchParams({ user_id: userId }), redirect: 'manual' });
    const token = /kv_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (res.status !== 303 || !token) throw new Error(`sign-in failed for ${userId}: ${res.status}`);
    tokens.set(userId, token);
  }
  return tokens.get(userId);
}

/** `who` is a user id to sign in as, or { raw } to send that exact cookie value instead. */
async function get(who, route, lang = 'en') {
  const cookie = typeof who === 'object' ? who.raw : await tokenFor(who);
  const res = await fetchRetry(`${BASE}${route}`, {
    headers: { cookie: `kv_session=${cookie}; kv_lang=${lang}` },
    redirect: 'manual',
  });
  const body = res.status < 400 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), body };
}

for (const a of accounts) {
  const ids = IDS.get(a.id);
  const routes = [
    ...COMMON,
    ids.caseId ? `/cases/${ids.caseId}` : null,
    ids.caseId ? `/cases/${ids.caseId}/plan` : null,
    ids.caseId ? `/cases/${ids.caseId}/assign` : null,
    ids.planCaseId ? `/cases/${ids.planCaseId}/plan` : null,
    ids.findingId ? `/findings/${ids.findingId}` : null,
    ids.taskId ? `/tasks/${ids.taskId}` : null,
    ids.schoolId ? `/schools/${ids.schoolId}` : null,
    ids.reportId ? `/reports/${ids.reportId}` : null,
    ids.batchId ? `/import/${ids.batchId}` : null,
    ids.complaintId ? `/complaints/${ids.complaintId}` : null,
  ].filter(Boolean);

  const fails = [];
  for (const lang of ['en', 'hi']) {
    for (const route of routes) {
      const r = await get(a.id, route, lang);
      checked++;
      const hits = MARKERS.filter((m) => r.body.includes(m));
      const okStatus = r.status === 200 || (r.status >= 300 && r.status < 400);
      if (!okStatus || hits.length > 0) {
        fails.push(`${r.status} ${lang} ${route}${r.location ? ` → ${r.location}` : ''} ${hits.join(', ')}`);
      }
    }
  }
  problems += fails.length;
  console.log(`${fails.length === 0 ? 'ok  ' : 'FAIL'} ${a.email.padEnd(38)} ${a.role.padEnd(12)} ${routes.length * 2} routes`);
  for (const f of fails) console.log(`       ${f}`);
}

// --- the refusals that SHOULD happen ---
console.log('\n--- scope refusals ---');
const expectRefusal = async (label, who, route, wanted) => {
  const r = await get(who, route);
  refusals++;
  const text = r.body;
  const ok = typeof wanted === 'number'
    ? r.status === wanted
    : wanted === 'redirect-to-login'
      ? r.status >= 300 && r.status < 400 && (r.location ?? '').includes('/login')
      : text.includes(wanted);
  if (!ok) { problems++; console.log(`  FAIL ${label} (status ${r.status})`); }
  else console.log(`  ok   ${label}`);
};
const crc = accounts.find((a) => a.role === 'crc');
const hm = accounts.find((a) => a.role === 'headmaster');
await expectRefusal('a BEO from another block is told CASE-0184 is out of scope', blk09Beo, `/cases/${heroCase}`, 'Outside your scope');
await expectRefusal('a CRC cannot open the approvals queue', crc.id, '/approvals', 'does not decide plans');
await expectRefusal('a headmaster cannot open the approvals queue', hm.id, '/approvals', 'does not decide plans');
await expectRefusal('a headmaster cannot read the audit trail', hm.id, '/audit', 'cannot read the audit log');
await expectRefusal('a headmaster cannot verify proof', hm.id, '/evidence', 'does not verify proof');
await expectRefusal('a headmaster cannot import data', hm.id, '/import', 'import data');
await expectRefusal('a CRC cannot open the demo admin controls', crc.id, '/admin', 'Only the demo administrator');
await expectRefusal('a CRC cannot open the demo controls page', crc.id, '/admin/demo', 'Only the demo administrator');
await expectRefusal('a BEO cannot pull the district map by changing the parent', IDS.has(accounts.find((a) => a.role === 'beo').id) ? accounts.find((a) => a.role === 'beo').id : crc.id, '/api/geo/map?parent=DST-01', 404);
await expectRefusal('a CRC cannot open account approvals', crc.id, '/admin/accounts', 'does not approve or manage accounts');
await expectRefusal('a CRC cannot read the AI log', crc.id, '/ai-log', 'can read this log');
await expectRefusal('a BEO cannot manage API keys', blk09Beo, '/admin/api-keys', 'Only the state programme team');
await expectRefusal('a CRC cannot manage API keys', crc.id, '/admin/api-keys', 'Only the state programme team');
await expectRefusal('a BEO cannot read user feedback', blk09Beo, '/admin/feedback', 'Only the state programme team and the demo administrator can read feedback');
await expectRefusal('a headmaster cannot read user feedback', hm.id, '/admin/feedback', 'Only the state programme team and the demo administrator can read feedback');
await expectRefusal('an unknown session is sent to sign in', { raw: 'USR-NOPE' }, '/cases', 'redirect-to-login');
await expectRefusal('a cookie holding a real user id is not a session', { raw: blk09Beo }, '/cases', 'redirect-to-login');

console.log(`\n${checked} page loads + ${refusals} refusal checks, ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
