/**
 * The read-only API for state dashboards (/api/v1): keys, scope, pagination, what is left out,
 * cookies, the rate limit and the OpenAPI document.
 *
 * Part 1 runs against the server-side modules: who may make keys, that only a hash is kept,
 * that wrong and revoked keys are nobody, and that a key reads through the app's own scope.
 * Part 2 runs when you pass the address of a running server, and checks the same over HTTP.
 *
 *   npx tsx --conditions=react-server scripts/api-test.mts                          (part 1 only)
 *   npx tsx --conditions=react-server scripts/api-test.mts http://localhost:3071    (both)
 *
 * The database is backed up and restored around the run. Without a server the test works on a
 * scratch copy of the pristine seed and puts the live file back afterwards, like import-test.
 * With a server, the server holds the live file, so swapping it would corrupt what the server
 * has open: the test snapshots it (VACUUM INTO), works on it in place, and at the end removes
 * exactly what it added — its keys, their call log, the audit rows it appended (only when they
 * are still the tail of the chain) and the audit counter — then checks the chain still verifies.
 */
import { copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.argv[2]?.replace(/\/$/, '');
const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.apitestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database. Run: npm run db:init'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
try { rmSync(BACKUP); } catch { /* none */ }
if (!BASE) { swap(LIVE, BACKUP); swap(PRISTINE, LIVE); }

const { loadSession } = await import('../src/lib/session');
const repo = await import('../src/lib/repo');
const keys = await import('../src/lib/api/keys');
const cases = await import('../src/lib/cases');
const feed = await import('../src/lib/feed');
const { Refused } = await import('../src/lib/guard');
const { one, all, run, db } = await import('../src/lib/db');
const { DISCLAIMER } = await import('../../src/domain/catalog');

if (BASE) db().exec(`vacuum into '${BACKUP.replaceAll("'", "''")}'`);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
function refused(label: string, fn: () => unknown, codeWanted?: string) {
  try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
  catch (e) {
    const r = e instanceof Refused ? e : null;
    if (!r) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
    if (codeWanted && r.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${r.code}", wanted "${codeWanted}"`); return; }
    pass++; console.log(`  ok   ${label}  [${r.code}]`);
  }
}
const n = (sql: string, ...p: (string | number)[]) => Number(one<{ c: number }>(sql, ...p)?.c ?? 0);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// What to undo at the end (server mode).
const before = {
  seq: n('select coalesce(max(seq), 0) c from audit_events'),
  auditCounter: n(`select coalesce((select value from app_sequences where name = 'audit'), 0) c`),
  callId: n('select coalesce(max(id), 0) c from api_calls'),
};
const made: string[] = [];

const byEmail = new Map(repo.demoAccounts().map((a) => [a.email, a]));
const sess = (email: string) => loadSession(byEmail.get(email)!.id)!;
const stateLead = sess('state.lead@demo.karyavahi.test');
const admin = sess('admin@demo.karyavahi.test');
const beo = sess('beo.blk-01@demo.karyavahi.test');
const deo = sess('deo.rmp@demo.karyavahi.test');
const auditor = sess('auditor.state@demo.karyavahi.test');
const crc = sess('crc.clu-001@demo.karyavahi.test');

console.log('\n— who may make keys —');
for (const [who, s] of [['a BEO', beo], ['a DEO', deo], ['the state auditor', auditor], ['a CRC', crc]] as const) {
  refused(`${who} cannot create an API key`, () => keys.createApiKey(s, { name: 'Should not exist', scopeType: 'block', scopeId: 'BLK-01' }), 'role');
}
ok('each refused attempt is written to the audit chain', n(`select count(*) c from audit_events where action = 'api_key.create' and result = 'failure' and seq > ?`, before.seq) === 4);
refused('a name that is too short is refused', () => keys.createApiKey(stateLead, { name: 'x', scopeType: 'block', scopeId: 'BLK-01' }), 'input');
refused('an area that does not exist is refused', () => keys.createApiKey(stateLead, { name: 'Nowhere key', scopeType: 'block', scopeId: 'BLK-99' }), 'input');
refused('a cluster is not a key area', () => keys.createApiKey(stateLead, { name: 'Cluster key', scopeType: 'cluster', scopeId: 'CLU-001' }), 'input');

const mk = (s: typeof stateLead, name: string, scopeType: string, scopeId: string) => {
  const k = keys.createApiKey(s, { name, scopeType, scopeId });
  made.push(k.id);
  return k;
};
const blockKey = mk(stateLead, 'api-test block BLK-01', 'block', 'BLK-01');
const districtKey = mk(stateLead, 'api-test district DST-01', 'district', 'DST-01');
const stateKey = mk(admin, 'api-test state', 'state', 'STA-01');
const revokedKey = mk(stateLead, 'api-test revoked', 'block', 'BLK-01');
const rateKey = mk(stateLead, 'api-test rate limit', 'block', 'BLK-02');
ok('the state programme team and the demo administrator can create keys', made.length === 5);
ok('keys are kv_demo_ keys, never kv_live_', [blockKey, districtKey, stateKey].every((k) => /^kv_demo_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/.test(k.token)));
ok('two keys never share a secret', new Set(made.map((id) => one<{ h: string }>('select secret_hash h from api_keys where id = ?', id)?.h)).size === made.length);
const stored = one<Record<string, string>>('select * from api_keys where id = ?', blockKey.id)!;
ok('only a hash of the key is stored', stored.secret_hash === sha256(blockKey.token) && !Object.values(stored).some((v) => String(v).includes(blockKey.token.slice(20))));
ok('creating a key is audited', n(`select count(*) c from audit_events where action = 'api_key.create' and result = 'success' and entity_id = ?`, blockKey.id) === 1);

keys.revokeApiKey(stateLead, revokedKey.id);
ok('revoking a key is audited', n(`select count(*) c from audit_events where action = 'api_key.revoke' and entity_id = ?`, revokedKey.id) === 1);
refused('a key cannot be revoked twice', () => keys.revokeApiKey(stateLead, revokedKey.id), 'input');
refused('a BEO cannot revoke a key', () => keys.revokeApiKey(beo, blockKey.id), 'role');

console.log('\n— keys as identities —');
ok('a live key resolves to its row', keys.keyForToken(blockKey.token)?.id === blockKey.id);
ok('the resolved key carries no hash', !('secret_hash' in (keys.keyForToken(blockKey.token) ?? {})));
ok('a revoked key is nobody', keys.keyForToken(revokedKey.token) === null);
const wrongSecret = `${blockKey.token.slice(0, 21)}${'A'.repeat(43)}`;
ok('the right id with a wrong secret is nobody', keys.keyForToken(wrongSecret) === null);
ok('malformed and missing keys are nobody', [null, '', 'kv_live_abc', blockKey.token + 'x', "kv_demo_' or 1=1 --"].every((t) => keys.keyForToken(t) === null));
ok('Bearer parsing takes only the Authorization scheme', keys.bearerToken(`Bearer ${blockKey.token}`) === blockKey.token && keys.bearerToken(`Basic ${blockKey.token}`) === null && keys.bearerToken(null) === null);

const blockSession = keys.apiSession(keys.keyForToken(blockKey.token)!);
const blockCases = cases.listCases(blockSession, { limit: 1000 });
const inBlock = n(`select count(*) c from cases where block_id = 'BLK-01'`);
ok(`a block key reads exactly its block's cases through the app's scope (${inBlock})`, blockCases.length === inBlock && blockCases.every((c) => c.block_id === 'BLK-01'));
const other = one<{ id: string }>(`select id from cases where block_id = 'BLK-09' limit 1`)!.id;
ok('a block key cannot open another block\'s case', cases.getCase(blockSession, other) === null);
ok('a key session owns no tasks, so it sees no case through ownership', n('select count(*) c from tasks where owner_user_id = ?', blockSession.user_id) === 0);

// ------------------------------------------------------------------ HTTP
if (BASE) {
  type Got = { status: number; headers: Headers; text: string; json: Record<string, unknown> | null };
  const get = async (path: string, init: { key?: string; cookie?: string; method?: string; headers?: Record<string, string> } = {}): Promise<Got> => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.key) headers.authorization = `Bearer ${init.key}`;
    if (init.cookie) headers.cookie = init.cookie;
    const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual' });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  };
  const all200: Got[] = [];
  const keep = (g: Got) => { if (g.status === 200) all200.push(g); return g; };
  const demoOk = (g: Got) => g.json?.demo_data === true && g.json?.disclaimer === DISCLAIMER;

  console.log('\n— the OpenAPI document —');
  const doc = await get('/api/v1/openapi.json');
  ok('openapi.json is public and valid JSON', doc.status === 200 && doc.json !== null);
  ok('it is an OpenAPI 3.1 document', typeof doc.json?.openapi === 'string' && (doc.json.openapi as string).startsWith('3.1'));
  ok('it carries the demo marker', doc.json?.['x-demo-data'] === true && doc.json?.['x-disclaimer'] === DISCLAIMER);
  const v1Dir = join(process.cwd(), 'src', 'app', 'api', 'v1');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : f === 'route.ts' ? [p] : []; });
  const served = walk(v1Dir).map((p) => '/' + relative(v1Dir, p).split(sep).slice(0, -1).join('/').replace(/\[(\w+)\]/g, '{$1}'));
  const listed = Object.keys((doc.json?.paths ?? {}) as Record<string, unknown>);
  ok(`every route the code serves is listed (${served.length})`, served.length >= 7 && served.every((p) => listed.includes(p)), `missing: ${served.filter((p) => !listed.includes(p)).join(', ')}`);
  ok('nothing is listed that the code does not serve', listed.every((p) => served.includes(p)), `extra: ${listed.filter((p) => !served.includes(p)).join(', ')}`);
  ok('every listed route is GET only', Object.values((doc.json?.paths ?? {}) as Record<string, Record<string, unknown>>).every((ops) => Object.keys(ops).every((m) => m === 'get')));

  console.log('\n— keys over HTTP —');
  const none = await get('/api/v1/cases');
  ok('no key → 401', none.status === 401);
  ok('the 401 says to authenticate with a bearer key', (none.headers.get('www-authenticate') ?? '').startsWith('Bearer'));
  const revoked = await get('/api/v1/cases', { key: revokedKey.token });
  const wrong = await get('/api/v1/cases', { key: wrongSecret });
  const malformed = await get('/api/v1/cases', { key: 'kv_demo_nonsense' });
  ok('revoked key → 401', revoked.status === 401);
  ok('wrong secret → 401', wrong.status === 401);
  ok('malformed key → 401', malformed.status === 401);
  ok('missing, revoked, wrong and malformed keys get the same answer', new Set([none.text, revoked.text, wrong.text, malformed.text]).size === 1);
  ok('error responses carry the demo marker too', demoOk(none));
  const viaQuery = await get(`/api/v1/cases?api_key=${encodeURIComponent(blockKey.token)}&key=${encodeURIComponent(blockKey.token)}`);
  ok('a key in the query string is not accepted', viaQuery.status === 401);

  console.log('\n— cookies are not keys —');
  const signIn = async (body: Record<string, string>) => {
    const res = await fetch(`${BASE}/api/sign-in`, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' });
    const token = /kv_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (!token) throw new Error(`could not sign in ${JSON.stringify(body)}`);
    return `kv_session=${token}`;
  };
  const stateCookie = await signIn({ email: 'state.lead@demo.karyavahi.test' });
  const adminCookie = await signIn({ email: 'admin@demo.karyavahi.test' });
  const beoCookie = await signIn({ email: 'beo.blk-01@demo.karyavahi.test' });
  ok('a signed-in state officer\'s cookie alone gets 401', (await get('/api/v1/cases', { cookie: stateCookie })).status === 401);
  ok('a signed-in demo admin\'s cookie alone gets 401', (await get('/api/v1/summary', { cookie: adminCookie })).status === 401);
  const both = await get('/api/v1/cases?limit=1', { key: blockKey.token, cookie: stateCookie });
  ok('a cookie sent with a block key does not widen it to the officer\'s state', both.status === 200 && (both.json?.scope as { id: string })?.id === 'BLK-01');
  ok('the API sets no cookie', both.headers.get('set-cookie') === null);

  console.log('\n— read only, no CORS —');
  ok('POST is refused', [405, 404].includes((await get('/api/v1/cases', { key: blockKey.token, method: 'POST' })).status));
  ok('DELETE is refused', [405, 404].includes((await get(`/api/v1/cases/${other}`, { key: blockKey.token, method: 'DELETE' })).status));
  const pre = await get('/api/v1/cases', { method: 'OPTIONS', headers: { origin: 'https://dashboard.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  ok('a cross-site preflight gets no CORS permission', pre.headers.get('access-control-allow-origin') === null);
  ok('responses are not cached', both.headers.get('cache-control') === 'no-store');

  console.log('\n— a block key sees only its block —');
  const bc = keep(await get('/api/v1/cases?limit=200', { key: blockKey.token }));
  const bcData = (bc.json?.data ?? []) as { id: string; area: { block_id: string } }[];
  ok('200 with the demo marker', bc.status === 200 && demoOk(bc));
  ok('the envelope names the key\'s area', (bc.json?.scope as { type: string; id: string })?.type === 'block' && (bc.json?.scope as { id: string }).id === 'BLK-01');
  ok(`it lists exactly the ${inBlock} cases in BLK-01`, bcData.length === inBlock && (bc.json?.page as { total: number })?.total === inBlock);
  ok('every case it lists is in BLK-01', bcData.every((c) => c.area.block_id === 'BLK-01'));
  const mine = keep(await get(`/api/v1/cases/${bcData[0]?.id}`, { key: blockKey.token }));
  ok('it can open a case in its block', mine.status === 200 && (mine.json?.data as { id: string })?.id === bcData[0]?.id);
  const hero = keep(await get('/api/v1/cases/CASE-0184', { key: one<{ b: string }>(`select block_id b from cases where id = 'CASE-0184'`)?.b === 'BLK-01' ? blockKey.token : districtKey.token }));
  ok('a case detail carries finding, plan, task counts and the latest outcome', hero.status === 200 && ['finding', 'plan', 'task_counts', 'latest_outcome', 'stage', 'owner_role'].every((k) => k in ((hero.json?.data ?? {}) as object)));
  const outside = await get(`/api/v1/cases/${other}`, { key: blockKey.token });
  const missing = await get('/api/v1/cases/CASE-9999', { key: blockKey.token });
  ok('another block\'s case → 404', outside.status === 404);
  ok('a case that does not exist → 404', missing.status === 404);
  ok('the two 404s are indistinguishable', outside.text === missing.text);
  const filtered = await get('/api/v1/cases?block=BLK-09', { key: blockKey.token });
  ok('filtering by another block returns nothing, not that block', filtered.status === 200 && (filtered.json?.page as { total: number })?.total === 0);
  const bt = keep(await get('/api/v1/tasks?limit=200', { key: blockKey.token }));
  const btData = (bt.json?.data ?? []) as { case_id: string; owner_role: string }[];
  const blockCaseIds = new Set(all<{ id: string }>(`select id from cases where block_id = 'BLK-01'`).map((r) => r.id));
  ok('its tasks all belong to BLK-01 cases', bt.status === 200 && btData.length > 0 && btData.every((t) => blockCaseIds.has(t.case_id)));
  ok('task owners are roles', btData.every((t) => ['crc', 'brc', 'headmaster', 'beo', 'deo'].includes(t.owner_role)));
  const bo = keep(await get('/api/v1/outcomes?limit=200', { key: blockKey.token }));
  ok('its outcome checks all belong to BLK-01 cases', bo.status === 200 && ((bo.json?.data ?? []) as { case_id: string }[]).every((o) => blockCaseIds.has(o.case_id)));
  const outcome0 = ((bo.json?.data ?? []) as Record<string, unknown>[])[0];
  ok('an outcome check has the DiD, its interval, the category and the rounds', !!outcome0 && 'did_pp' in outcome0 && 'interval' in outcome0 && 'category' in outcome0 && 'rounds' in outcome0);
  const bh = keep(await get('/api/v1/hotspots', { key: blockKey.token }));
  const clustersInBlock = new Set(all<{ id: string }>(`select id from clusters where block_id = 'BLK-01'`).map((r) => r.id));
  ok('its hotspots are the clusters of BLK-01', bh.status === 200 && bh.json?.level === 'cluster' && ((bh.json?.data ?? []) as { id: string }[]).length > 0 && ((bh.json?.data ?? []) as { id: string }[]).every((u) => clustersInBlock.has(u.id)));
  ok('drilling into another block\'s area → 404', (await get('/api/v1/hotspots?within=BLK-09', { key: blockKey.token })).status === 404);
  const bs = keep(await get('/api/v1/summary', { key: blockKey.token }));
  ok('its summary counts its block\'s cases', bs.status === 200 && ((bs.json?.data as { cases: { total: number } })?.cases.total === inBlock));

  console.log('\n— wider keys see more —');
  const dc = keep(await get('/api/v1/cases?limit=1', { key: districtKey.token }));
  const inDistrict = n(`select count(*) c from cases where district_id = 'DST-01'`);
  ok(`a district key sees its district's ${inDistrict} cases`, (dc.json?.page as { total: number })?.total === inDistrict && inDistrict > inBlock);
  ok('a district key can open a case in any of its blocks', (await get(`/api/v1/cases/${one<{ id: string }>(`select id from cases where district_id = 'DST-01' and block_id <> 'BLK-01' limit 1`)!.id}`, { key: districtKey.token })).status === 200);
  ok('a district key cannot open another district\'s case', (await get(`/api/v1/cases/${other}`, { key: districtKey.token })).status === 404);
  const dh = await get('/api/v1/hotspots', { key: districtKey.token });
  ok('a district key\'s hotspots are blocks', dh.json?.level === 'block');
  const total = n('select count(*) c from cases');
  const sc = keep(await get('/api/v1/cases?limit=1', { key: stateKey.token }));
  ok(`a state key sees all ${total} cases`, (sc.json?.page as { total: number })?.total === total);
  ok('a state key can open the BLK-09 case', (await get(`/api/v1/cases/${other}`, { key: stateKey.token })).status === 200);
  ok('a state key\'s hotspots are districts', (await get('/api/v1/hotspots', { key: stateKey.token })).json?.level === 'district');

  console.log('\n— pagination —');
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0, lastSort = '';
  let ordered = true;
  do {
    const p = keep(await get(`/api/v1/cases?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { key: stateKey.token }));
    const d = (p.json?.data ?? []) as { id: string; updated_at: string }[];
    for (const c of d) { if (`${c.updated_at}|${c.id}` < lastSort) ordered = false; lastSort = `${c.updated_at}|${c.id}`; seen.push(c.id); }
    cursor = (p.json?.page as { next_cursor: string | null })?.next_cursor ?? null;
    pages++;
  } while (cursor && pages < 20);
  ok(`following next_cursor walks all ${total} cases in ${pages} pages`, seen.length === total && pages === Math.ceil(total / 50));
  ok('no case appears twice', new Set(seen).size === seen.length);
  ok('pages come in updated_at order', ordered);
  const since = '2026-09-01';
  const ss = await get(`/api/v1/cases?updated_since=${since}&limit=200`, { key: stateKey.token });
  ok('updated_since keeps only later changes', ss.status === 200 && (ss.json?.page as { total: number }).total === n(`select count(*) c from cases where updated_at >= ?`, `${since}T00:00:00.000Z`) && ((ss.json?.data ?? []) as { updated_at: string }[]).every((c) => c.updated_at >= since));
  let tc: string | null = null, tseen = 0, tpages = 0;
  do {
    const p = await get(`/api/v1/tasks?limit=40&block=BLK-01${tc ? `&cursor=${encodeURIComponent(tc)}` : ''}`, { key: districtKey.token });
    tseen += ((p.json?.data ?? []) as unknown[]).length;
    tc = (p.json?.page as { next_cursor: string | null })?.next_cursor ?? null;
    tpages++;
  } while (tc && tpages < 30);
  ok('task pages add up to the block\'s task count', tseen === n(`select count(*) c from tasks t join cases c on c.id = t.case_id where c.block_id = 'BLK-01'`));
  ok('a bad status → 400', (await get('/api/v1/cases?status=bogus', { key: stateKey.token })).status === 400);
  ok('a bad limit → 400', (await get('/api/v1/cases?limit=0', { key: stateKey.token })).status === 400);
  ok('a forged cursor → 400', (await get('/api/v1/cases?cursor=not-a-cursor', { key: stateKey.token })).status === 400);
  ok('a bad date → 400', (await get('/api/v1/cases?updated_since=yesterday', { key: stateKey.token })).status === 400);

  console.log('\n— nothing personal or typed leaks —');
  const FORBIDDEN_KEYS = new Set([
    'owner_user_id', 'user_id', 'submitted_by', 'verified_by', 'reviewed_by', 'decided_by', 'created_by', 'assigned_user_id',
    'full_name', 'name_of_owner', 'email', 'mobile', 'phone', 'phone_number',
    'rationale', 'human_conclusion', 'ai_hypothesis', 'reassign_reason', 'deadline_change_reason', 'rejection_reason',
    'notes', 'note', 'body', 'comments', 'complaints', 'complaint_id', 'description', 'interpretation_note', 'summary_text',
  ]);
  const badKeys = new Set<string>();
  const scan = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEYS.has(k)) badKeys.add(k); scan(x); }
  };
  for (const g of all200) scan(g.json);
  ok(`no response has a personal or free-text field (${all200.length} responses scanned)`, badKeys.size === 0, [...badKeys].join(', '));
  const blob = all200.map((g) => g.text).join('\n');
  ok('no email address appears anywhere', !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(blob));
  ok('no phone number appears anywhere', !/(?<![\d.-])(\+91[ -]?)?[6-9]\d{9}(?!\d)/.test(blob));
  const people = all<{ n: string }>(`select full_name n from users where length(full_name) > 6`).map((r) => r.n);
  ok('no officer\'s name appears anywhere', !people.some((p) => blob.includes(p)), people.find((p) => blob.includes(p)));
  const manualTitles = all<{ t: string }>(`select title t from cases where origin = 'manual'`).map((r) => r.t);
  // The state key's walk over every case covered the manual ones.
  ok('no officer-typed case title appears (manual cases get a generated title)', manualTitles.length > 0 && !manualTitles.some((t) => blob.includes(JSON.stringify(t).slice(1, -1))));
  let threadText: string[] = [];
  try { threadText = all<{ b: string }>(`select body b from case_comments where length(body) > 12`).map((r) => r.b); } catch { /* none */ }
  const complaintText = all<{ t: string }>(`select title t from complaints where length(title) > 12`).map((r) => r.t);
  ok('no discussion or complaint text appears', ![...threadText, ...complaintText].some((t) => blob.includes(JSON.stringify(t).slice(1, -1))));
  ok('every 200 response carries "demo_data": true and the disclaimer', all200.every(demoOk));

  console.log('\n— the rate limit —');
  let firstLimited = -1;
  let retryAfter: string | null = null;
  let limitedBody: Got | null = null;
  for (let i = 1; i <= keys.RATE_LIMIT + 1; i++) {
    const r = await get('/api/v1/cases?limit=1', { key: rateKey.token });
    if (r.status === 429) { firstLimited = i; retryAfter = r.headers.get('retry-after'); limitedBody = r; break; }
    if (r.status !== 200) { firstLimited = -i; break; }
  }
  ok(`the first ${keys.RATE_LIMIT} requests in a minute pass and the next gets 429`, firstLimited === keys.RATE_LIMIT + 1, `first 429 at ${firstLimited}`);
  ok('the 429 says when to retry', retryAfter !== null && /^\d+$/.test(retryAfter) && Number(retryAfter) >= 1 && Number(retryAfter) <= keys.RATE_WINDOW_S, String(retryAfter));
  ok('the 429 carries the demo marker', !!limitedBody && demoOk(limitedBody));
  ok('one key\'s limit does not touch another key', (await get('/api/v1/summary', { key: blockKey.token })).status === 200);

  console.log('\n— the call log —');
  const k1 = one<{ last_used_at: string | null }>('select last_used_at from api_keys where id = ?', blockKey.id);
  ok('using a key moves its last-used time', !!k1?.last_used_at);
  ok('a revoked key\'s attempts do not count as use', one<{ last_used_at: string | null }>('select last_used_at from api_keys where id = ?', revokedKey.id)?.last_used_at === null);
  const logged = all<{ path: string; status: number }>('select path, status from api_calls where key_id = ?', blockKey.id);
  ok('each call is logged with its path and status', logged.length >= 10 && logged.some((r) => r.path === '/api/v1/cases' && r.status === 200) && logged.some((r) => r.status === 404));
  ok('the log keeps no query strings', !all<{ path: string }>('select path from api_calls where id > ?', before.callId).some((r) => r.path.includes('?')));
  const cols = all<{ name: string }>(`select name from pragma_table_info('api_calls')`).map((r) => r.name);
  ok('the log has no column for bodies or headers', cols.every((c) => ['id', 'key_id', 'method', 'path', 'status', 'ts', 'ms'].includes(c)));
  ok('failed authentications are logged without a key id', n('select count(*) c from api_calls where key_id is null and status = 401 and id > ?', before.callId) >= 5);
  ok('the rate-limited calls are logged as 429', n('select count(*) c from api_calls where key_id = ? and status = 429', rateKey.id) === 1);

  console.log('\n— the admin page —');
  const page = async (cookie: string, path = '/admin/api-keys') => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: `${cookie}; kv_lang=en` }, redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  };
  const asState = await page(stateCookie);
  ok('the state programme team sees the key manager', asState.status === 200 && asState.body.includes('API keys for state dashboards') && asState.body.includes('New key'));
  ok('it lists the keys by name and never shows a secret', asState.body.includes('api-test block BLK-01') && !asState.body.includes(blockKey.token.slice(21)));
  const asAdmin = await page(adminCookie);
  ok('the demo administrator sees the key manager', asAdmin.status === 200 && asAdmin.body.includes('New key'));
  const asBeo = await page(beoCookie);
  ok('a BEO is told only the state team may manage keys', asBeo.status === 200 && asBeo.body.includes('Only the state programme team') && !asBeo.body.includes('api-test block BLK-01'));
  const dev = await page(beoCookie, '/developers');
  ok('the developer page explains the API with a curl example', dev.status === 200 && dev.body.includes('curl') && dev.body.includes('Authorization: Bearer'));
}

// ------------------------------------------------------------------ restore
console.log('\n— restore —');
if (BASE) {
  const appended = all<{ entity_type: string }>('select entity_type from audit_events where seq > ?', before.seq);
  if (appended.every((r) => r.entity_type === 'api_key')) {
    run('delete from audit_events where seq > ?', before.seq);
    run(`update app_sequences set value = ? where name = 'audit'`, before.auditCounter);
  } else {
    console.log('  note: other writes reached the audit chain during the run, so its rows were left in place');
  }
  if (made.length) {
    run(`delete from api_calls where key_id in (${made.map(() => '?').join(',')})`, ...made);
    run(`delete from api_keys where id in (${made.map(() => '?').join(',')})`, ...made);
  }
  run('delete from api_calls where key_id is null and id > ?', before.callId);
  const chain = feed.verifyAuditChain(auditor);
  ok('the audit chain still verifies after the clean-up', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
  ok('the test\'s keys are gone', n(`select count(*) c from api_keys where name like 'api-test %'`) === 0);
  try { db().close(); } catch { /* already closed */ }
  try { rmSync(BACKUP); } catch { /* fine */ }
} else {
  const chain = feed.verifyAuditChain(auditor);
  ok('the audit chain verifies with the key rows in it', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
  try { db().close(); } catch { /* already closed */ }
  swap(BACKUP, LIVE);
  try { rmSync(BACKUP); } catch { /* fine */ }
  console.log('  (no server address given: the HTTP checks were skipped)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
