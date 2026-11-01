/**
 * User feedback: saving, validation, length limits, who may read it, the rate limit, the audit
 * row, the CSV export, the AI-log join, and the "What we changed" data file.
 *
 * Part 1 runs against the server-side modules. Part 2 runs when you pass the address of a
 * running server, and checks the same over HTTP: signed-out and cross-site requests are refused,
 * a same-site request is saved, the CSV export is for reviewers only, and the pages answer.
 *
 *   npx tsx --conditions=react-server scripts/feedback-test.mts                          (part 1 only)
 *   npx tsx --conditions=react-server scripts/feedback-test.mts http://localhost:3111    (both)
 *
 * Like api-test: without a server it works on a scratch copy of the pristine seed and puts the
 * live file back afterwards. With a server it works on the live file in place and, at the end,
 * removes exactly what it added (its feedback rows, the AI log rows it made, the audit rows it
 * appended while they are still the tail of the chain, and the counters), then checks the chain.
 */
import { copyFileSync, existsSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.argv[2]?.replace(/\/$/, '');
const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.feedbacktestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database. Run: npm run db:init'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
try { rmSync(BACKUP); } catch { /* none */ }
if (!BASE) { swap(LIVE, BACKUP); swap(PRISTINE, LIVE); }

const { loadSession } = await import('../src/lib/session');
const repo = await import('../src/lib/repo');
const fb = await import('../src/lib/feedback');
const { loadChanges } = await import('../src/lib/changes');
const { logAi } = await import('../src/lib/ai/client');
const feed = await import('../src/lib/feed');
const { Refused } = await import('../src/lib/guard');
const { one, all, run, db } = await import('../src/lib/db');

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

// What to undo at the end (server mode).
const maxFbk = () => n(`select coalesce(max(cast(substr(id, 5) as integer)), 0) c from feedback`);
const maxAii = () => n(`select coalesce(max(cast(substr(id, 5) as integer)), 0) c from ai_interactions where id like 'AII-%'`);
const before = {
  seq: n('select coalesce(max(seq), 0) c from audit_events'),
  auditCounter: n(`select coalesce((select value from app_sequences where name = 'audit'), 0) c`),
  aiCounter: n(`select coalesce((select value from app_sequences where name = 'ai'), 0) c`),
  fbkCounter: n(`select coalesce((select value from app_sequences where name = 'feedback'), 0) c`),
  fbk: maxFbk(),
  aii: maxAii(),
};

const accounts = repo.demoAccounts();
const byEmail = new Map(accounts.map((a) => [a.email, a]));
const sess = (email: string) => {
  const id = byEmail.get(email)?.id ?? one<{ id: string }>('select id from users where lower(email) = ?', email)?.id;
  if (!id) throw new Error(`no account ${email}`);
  return loadSession(id)!;
};
const admin = sess('admin@demo.karyavahi.test');
const stateLead = sess('state.lead@demo.karyavahi.test');
const beo = sess('beo.blk-01@demo.karyavahi.test');
const beo9 = sess('beo.blk-09@demo.karyavahi.test');
const crc = sess('crc.clu-001@demo.karyavahi.test');
const auditor = sess('auditor.state@demo.karyavahi.test');
// No demo login is a headmaster; take the first active headmaster account, as hindi-check does.
const hmAccount = one<{ id: string; full_name: string }>(
  `select u.id, u.full_name from users u join user_roles ur on ur.user_id = u.id where ur.role = 'headmaster' and u.status = 'active' order by u.id limit 1`)!;
const hm = loadSession(hmAccount.id)!;

console.log('\n— the table —');
const cols = all<{ name: string }>(`select name from pragma_table_info('feedback')`).map((r) => r.name);
ok('the feedback table exists with the agreed columns',
  ['id', 'user_id', 'role', 'page_path', 'kind', 'target', 'rating', 'tags', 'comment', 'language', 'created_at'].every((c) => cols.includes(c)), cols.join(','));
ok('it carries its own version marker', one<{ value: string }>(`select value from ext_meta where key = 'feedback_version'`)?.value === 'feedback-v1');

console.log('\n— saving —');
const page = fb.saveFeedback(hm, { kind: 'page', rating: 2, pagePath: '/today?x=1#top', trying: 'Hand in proof for today’s task', comment: 'Photo button was hard to find', language: 'hi' });
const pageRow = one<Record<string, unknown>>('select * from feedback where id = ?', page.id)!;
ok('a headmaster can send the feedback form', /^FBK-\d{6}$/.test(page.id) && !!pageRow);
ok('the row records who, in which role, where, what and when', pageRow.user_id === hm.user_id && pageRow.role === 'headmaster' && pageRow.kind === 'page'
  && pageRow.rating === 2 && pageRow.language === 'hi' && /^\d{4}-\d{2}-\d{2}T/.test(String(pageRow.created_at)), JSON.stringify(pageRow));
ok('the query string and fragment are not kept', pageRow.page_path === '/today');
ok('what they were trying to do and what got in the way are both kept', pageRow.trying === 'Hand in proof for today’s task' && pageRow.comment === 'Photo button was hard to find');
const audit = one<{ action: string; actor_user_id: string; entity_type: string; after_json?: string } & Record<string, string>>(
  `select * from audit_events where entity_type = 'feedback' and entity_id = ?`, page.id);
ok('saving appends an audit row', audit?.action === 'feedback.submit' && audit.actor_user_id === hm.user_id);
ok('the audit row does not copy the comment text', !JSON.stringify(audit).includes('Photo button was hard to find'));

const draft = fb.saveFeedback(beo, { kind: 'claude_draft', rating: 'up', target: 'explain_finding:CASE-0184', pagePath: '/cases/CASE-0184', language: 'en' });
ok('a thumbs up on a Claude draft is saved as +1 against the task and record',
  one<{ rating: number; target: string }>('select rating, target from feedback where id = ?', draft.id)?.rating === 1);

// A chat answer is named by its AI log row; only the person who asked may rate it.
const myAnswer = logAi(beo, { kind: 'ask', model: 'feedback-test', question: 'feedback-test question', tools: [], referencedIds: [], status: 'ok' });
const othersAnswer = logAi(beo9, { kind: 'ask', model: 'feedback-test', question: 'feedback-test question', tools: [], referencedIds: [], status: 'ok' });
const answer = fb.saveFeedback(beo, { kind: 'claude_answer', rating: -1, target: myAnswer, tags: ['wrong_figure', 'too_long', 'wrong_figure'], comment: 'The enrolment figure looked off', pagePath: '/assistant' });
const answerRow = one<{ tags: string; ai_interaction_id: string }>('select tags, ai_interaction_id from feedback where id = ?', answer.id)!;
ok('a thumbs down on a chat answer keeps its AI log id', answerRow.ai_interaction_id === myAnswer);
ok('tags are stored once each', answerRow.tags === JSON.stringify(['wrong_figure', 'too_long']), answerRow.tags);
refused('nobody can rate an answer Claude gave someone else', () => fb.saveFeedback(beo, { kind: 'claude_answer', rating: 1, target: othersAnswer, pagePath: '/assistant' }), 'input');
const draftWithAi = fb.saveFeedback(beo, { kind: 'claude_draft', rating: 1, target: 'suggest_plan:CASE-0184', aiInteractionId: othersAnswer, pagePath: '/cases/CASE-0184' });
ok('a draft rating drops an AI log id that is not the rater\'s own', one<{ a: string | null }>('select ai_interaction_id a from feedback where id = ?', draftWithAi.id)?.a === null);

console.log('\n— validation and length limits —');
refused('an unknown kind is refused', () => fb.saveFeedback(crc, { kind: 'rumour', rating: 1, pagePath: '/today' }), 'input');
refused('a form rating of 0 is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 0, pagePath: '/today' }), 'input');
refused('a form rating of 6 is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 6, pagePath: '/today' }), 'input');
refused('a form rating of 2.5 is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 2.5, pagePath: '/today' }), 'input');
refused('a Claude rating other than up or down is refused', () => fb.saveFeedback(beo, { kind: 'claude_draft', rating: 3, target: 'explain_finding:CASE-0184', pagePath: '/cases' }), 'input');
refused('a draft target that is not task:record is refused', () => fb.saveFeedback(beo, { kind: 'claude_draft', rating: 1, target: 'drop table:CASE-0184', pagePath: '/cases' }), 'input');
refused('a chat rating without an answer id is refused', () => fb.saveFeedback(beo, { kind: 'claude_answer', rating: 1, pagePath: '/assistant' }), 'input');
refused('an unknown tag is refused', () => fb.saveFeedback(beo, { kind: 'claude_answer', rating: -1, target: myAnswer, tags: ['rude'], pagePath: '/assistant' }), 'input');
refused('tags that are not a list are refused', () => fb.saveFeedback(beo, { kind: 'claude_answer', rating: -1, target: myAnswer, tags: 'unclear', pagePath: '/assistant' }), 'input');
refused('a comment of 1001 characters is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 3, pagePath: '/today', comment: 'x'.repeat(1001) }), 'input');
const long = fb.saveFeedback(crc, { kind: 'page', rating: 3, pagePath: '/today', comment: `  ${'क'.repeat(1000)}  ` });
ok('a comment of exactly 1000 characters (Hindi) is kept, trimmed', one<{ l: number }>('select length(comment) l from feedback where id = ?', long.id)?.l === 1000);
refused('an answer about what you were doing over 500 characters is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 3, pagePath: '/today', trying: 'y'.repeat(501) }), 'input');
refused('control characters in a comment are refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 3, pagePath: '/today', comment: 'bell\u0007' }), 'input');
for (const p of ['https://evil.example/x', '//evil.example', 'today', '/to day', `/${'a'.repeat(250)}`]) {
  refused(`a page path of ${JSON.stringify(p.slice(0, 30))} is refused`, () => fb.saveFeedback(crc, { kind: 'page', rating: 3, pagePath: p }), 'input');
}
const empty = fb.saveFeedback(crc, { kind: 'page', rating: 4, pagePath: '/tasks', comment: '   ', trying: '' });
ok('blank answers are stored as nothing, not as spaces', one<{ c: string | null; t: string | null }>('select comment c, trying t from feedback where id = ?', empty.id)?.c === null);
ok('the language falls back to English when unknown', one<{ l: string }>('select language l from feedback where id = ?', empty.id)?.l === 'en');

console.log('\n— who reads it —');
const mine = fb.ownFeedback(hm);
ok('a person reads back their own feedback', mine.some((r) => r.id === page.id));
ok('and only their own', mine.every((r) => r.user_id === hm.user_id) && !mine.some((r) => r.id === draft.id));
ok('a BEO\'s own list does not include the headmaster\'s', !fb.ownFeedback(beo).some((r) => r.id === page.id));
for (const [who, s] of [['a BEO', beo], ['a CRC', crc], ['a headmaster', hm], ['the state auditor', auditor]] as const) {
  ok(`${who} gets an empty review list`, fb.listFeedback(s).length === 0);
  ok(`${who} gets no summary`, fb.feedbackSummary(s) === null);
}
const adminList = fb.listFeedback(admin);
ok('the demo administrator reads everyone\'s feedback', [page.id, draft.id, answer.id].every((id) => adminList.some((r) => r.id === id)));
ok('so does the state programme team', fb.listFeedback(stateLead).length === adminList.length);
ok('the list names the role and the account', adminList.find((r) => r.id === page.id)?.user_name === hmAccount.full_name);
ok('filters work: thumbs down only', fb.listFeedback(admin, { tone: 'down' }).every((r) => (r.kind === 'page' ? r.rating <= 2 : r.rating === -1)));
ok('filters work: by tag', fb.listFeedback(admin, { tag: 'too_long' }).map((r) => r.id).join() === answer.id);
ok('filters work: by kind and role', fb.listFeedback(admin, { kind: 'page', role: 'headmaster' }).every((r) => r.kind === 'page' && r.role === 'headmaster'));
ok('filters work: by page prefix', fb.listFeedback(admin, { page: '/cases' }).every((r) => r.page_path.startsWith('/cases')));

console.log('\n— counts —');
// The BEO changes their mind on the same draft: only the latest rating counts.
const flip = fb.saveFeedback(beo, { kind: 'claude_draft', rating: -1, target: 'explain_finding:CASE-0184', tags: ['unclear'], pagePath: '/cases/CASE-0184' });
const sum = fb.feedbackSummary(admin)!;
const draftCounts = sum.claude.find((c) => c.kind === 'claude_draft')!;
ok('a changed mind replaces the first rating in the counts', draftCounts.up === 1 && draftCounts.down === 1, JSON.stringify(draftCounts));
ok('but both rows are kept', !!one('select 1 x from feedback where id = ?', draft.id) && !!one('select 1 x from feedback where id = ?', flip.id));
ok('pages are grouped by route', sum.byPage.some((p) => p.route === '/cases/[id]'));
ok('the top reasons are counted', sum.tags.find((t) => t.tag === 'unclear')?.c === 1 && sum.tags.find((t) => t.tag === 'wrong_figure')?.c === 1);
ok('the average ease is worked out from the forms', sum.formAvg !== null && sum.forms >= 3);
const forAi = fb.feedbackForInteractions(admin, [myAnswer, othersAnswer]);
ok('the AI log gets the thumbs for each answer', forAi.get(myAnswer)?.down === 1 && !forAi.has(othersAnswer));
ok('but only for reviewers', fb.feedbackForInteractions(beo, [myAnswer]).size === 0);

console.log('\n— export —');
refused('a BEO cannot export feedback', () => fb.feedbackCsv(beo), 'role');
ok('the refused export is audited', n(`select count(*) c from audit_events where action = 'feedback.export' and result = 'failure' and actor_user_id = ? and seq > ?`, beo.user_id, before.seq) === 1);
const formula = fb.saveFeedback(crc, { kind: 'page', rating: 1, pagePath: '/today', comment: '=HYPERLINK("http://evil.example","click")' });
const csv = fb.feedbackCsv(admin);
const lines = csv.trim().split('\r\n');
ok('the CSV starts with the column names', lines[0] === fb.CSV_COLUMNS.join(','));
ok('it has one line per piece of feedback', lines.length - 1 === n('select count(*) c from feedback'), `${lines.length - 1}`);
ok('a comment that looks like a formula is quoted so a spreadsheet does not run it', csv.includes(`"'=HYPERLINK(""http://evil.example"",""click"")"`));
ok('the export is audited', n(`select count(*) c from audit_events where action = 'feedback.export' and result = 'success' and actor_user_id = ? and seq > ?`, admin.user_id, before.seq) === 1);
void formula;

console.log('\n— rate limit —');
const already = fb.recentCount(crc.user_id);
for (let i = already; i < fb.RATE_LIMIT; i++) fb.saveFeedback(crc, { kind: 'page', rating: 4, pagePath: '/today' });
ok(`${fb.RATE_LIMIT} pieces of feedback in ${fb.RATE_WINDOW_MIN} minutes are accepted`, fb.recentCount(crc.user_id) === fb.RATE_LIMIT);
const auditBefore = n('select count(*) c from audit_events');
refused('the next one is refused', () => fb.saveFeedback(crc, { kind: 'page', rating: 4, pagePath: '/today' }), 'rate');
ok('a refused one saves nothing and writes nothing', n('select count(*) c from audit_events') === auditBefore && fb.recentCount(crc.user_id) === fb.RATE_LIMIT);
ok('the limit is per person: a BEO can still send', !!fb.saveFeedback(beo, { kind: 'page', rating: 5, pagePath: '/overview' }).id);
run(`update feedback set created_at = ? where user_id = ?`, new Date(Date.now() - (fb.RATE_WINDOW_MIN + 1) * 60_000).toISOString(), crc.user_id);
ok('once the window has passed, the CRC can send again', !!fb.saveFeedback(crc, { kind: 'page', rating: 4, pagePath: '/today' }).id);

console.log('\n— what we changed —');
const changes = loadChanges();
ok('the committed changes file reads', changes.entries.length >= 1 && changes.skipped === 0);
ok('it holds only the honest placeholder until testing happens', changes.entries.every((e) => e.placeholder) && changes.entries.every((e) => e.feedback_ids.length === 0));
const dir = mkdtempSync(join(tmpdir(), 'kv-changes-'));
const f = join(dir, 'changes.json');
writeFileSync(f, JSON.stringify({ entries: [
  { id: 'CHG-001', date: '2026-11-05', said: 'Headmasters could not find the photo button.', who: '3 headmasters', roles: ['headmaster', 'pirate'], changed: 'The photo button is now first.', link: '/today', feedback_ids: ['FBK-000001', 'nope'] },
  { id: 'CHG-002', date: 'soon', said: 'x', changed: 'y' },
  { id: 'CHG-003', date: '2026-11-06', said: 'Officers wanted a shorter draft.', changed: 'Drafts are shorter.', link: 'https://evil.example' },
] }));
const t = loadChanges(f);
ok('a malformed entry is skipped, not fatal', t.entries.length === 2 && t.skipped === 1);
ok('entries are newest first', t.entries[0].id === 'CHG-003');
ok('a link off this site is dropped', t.entries[0].link === null && t.entries[1].link === '/today');
ok('unknown roles and malformed feedback ids are dropped', t.entries[1].roles.join() === 'headmaster' && t.entries[1].feedback_ids.join() === 'FBK-000001');
ok('a missing file is an empty list', loadChanges(join(dir, 'none.json')).entries.length === 0);
rmSync(dir, { recursive: true, force: true });

// ------------------------------------------------------------------ over HTTP
if (BASE) {
  console.log('\n— over HTTP —');
  const signIn = async (email: string) => {
    const res = await fetch(`${BASE}/api/sign-in`, { method: 'POST', body: new URLSearchParams({ email }), redirect: 'manual' });
    const token = /kv_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (!token) throw new Error(`could not sign in ${email}`);
    return `kv_session=${token}`;
  };
  const host = new URL(BASE).host;
  const postFb = (body: unknown, init: { cookie?: string; headers?: Record<string, string> } = {}) => fetch(`${BASE}/api/feedback`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: BASE, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const good = { kind: 'page', rating: 4, pagePath: '/today', comment: 'feedback-test over http', language: 'hi' };
  const count = () => n('select count(*) c from feedback');

  const c0 = count();
  const out = await postFb(good);
  ok('signed out: 401 and nothing saved', out.status === 401 && count() === c0, `${out.status}`);
  const crcCookie = await signIn('crc.clu-001@demo.karyavahi.test');
  const crossOrigin = await postFb(good, { cookie: crcCookie, headers: { origin: 'https://evil.example' } });
  ok('another site\'s Origin: 403 and nothing saved', crossOrigin.status === 403 && count() === c0, `${crossOrigin.status}`);
  const crossFetch = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: crcCookie, 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(good) });
  ok('a cross-site fetch without Origin: 403', crossFetch.status === 403 && count() === c0, `${crossFetch.status}`);
  const nullOrigin = await postFb(good, { cookie: crcCookie, headers: { origin: 'null' } });
  ok('an opaque (null) Origin: 403', nullOrigin.status === 403);
  const asForm = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: BASE, cookie: crcCookie }, body: JSON.stringify(good) });
  ok('a body that is not JSON is refused (415)', asForm.status === 415 && count() === c0);
  const bad = await postFb('{not json', { cookie: crcCookie });
  ok('broken JSON is refused (400)', bad.status === 400);
  const tooLong = await postFb({ ...good, comment: 'z'.repeat(1001) }, { cookie: crcCookie });
  ok('a comment over 1000 characters is refused (400) with a reason', tooLong.status === 400 && /1000/.test((await tooLong.json()).error ?? ''));
  const spoof = await postFb({ ...good, user_id: admin.user_id, role: 'state_admin' }, { cookie: crcCookie });
  const sj = await spoof.json() as { ok?: boolean; id?: string };
  const saved = one<{ user_id: string; role: string; language: string }>('select user_id, role, language from feedback where id = ?', sj.id ?? '');
  ok('a same-site request is saved under the signed-in user, whatever the body claims', spoof.status === 200 && saved?.user_id === crc.user_id && saved.role === 'crc' && saved.language === 'hi', JSON.stringify(saved));
  ok('and it is audited', n(`select count(*) c from audit_events where action = 'feedback.submit' and entity_id = ?`, sj.id ?? '') === 1);

  // Fill the CRC's window to the limit, then one more over HTTP.
  for (let i = fb.recentCount(crc.user_id); i < fb.RATE_LIMIT; i++) fb.saveFeedback(crc, { kind: 'page', rating: 4, pagePath: '/today' });
  const limited = await postFb(good, { cookie: crcCookie });
  ok('over the limit: 429', limited.status === 429);

  const exp = (cookie?: string, headers: Record<string, string> = {}) => fetch(`${BASE}/api/feedback/export`, { headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' });
  ok('CSV export signed out: 401', (await exp()).status === 401);
  const beoCookie = await signIn('beo.blk-01@demo.karyavahi.test');
  ok('CSV export as a BEO: 403', (await exp(beoCookie)).status === 403);
  ok('CSV export as a CRC: 403', (await exp(crcCookie)).status === 403);
  const adminCookie = await signIn('admin@demo.karyavahi.test');
  const csvRes = await exp(adminCookie);
  const csvText = await csvRes.text();
  ok('CSV export as the demo administrator: a CSV download', csvRes.status === 200 && (csvRes.headers.get('content-type') ?? '').startsWith('text/csv')
    && (csvRes.headers.get('content-disposition') ?? '').includes('attachment') && csvText.includes(fb.CSV_COLUMNS.join(',')));
  ok('the CSV carries the Hindi text intact', csvText.includes('क'.repeat(50)));
  const stateCookie = await signIn('state.lead@demo.karyavahi.test');
  ok('CSV export as the state programme team: 200', (await exp(stateCookie)).status === 200);
  ok('CSV export requested from another site: 403', (await exp(adminCookie, { 'sec-fetch-site': 'cross-site' })).status === 403);
  const filtered = await (await fetch(`${BASE}/api/feedback/export?tag=too_long`, { headers: { cookie: adminCookie } })).text();
  ok('a filtered export returns only matching rows', filtered.trim().split('\r\n').length === 2 && filtered.includes(answer.id));

  const pageAs = async (cookie: string, path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: `${cookie}; kv_lang=en` }, redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  };
  const review = await pageAs(adminCookie, '/admin/feedback');
  ok('the review page shows counts and the list to the demo administrator', review.status === 200 && review.body.includes('Every response') && review.body.includes('Export CSV') && review.body.includes(page.id));
  const reviewBeo = await pageAs(beoCookie, '/admin/feedback');
  ok('a BEO is told who can read feedback, and sees none of it', reviewBeo.status === 200 && reviewBeo.body.includes('Only the state programme team') && !reviewBeo.body.includes(page.id) && !reviewBeo.body.includes('Photo button was hard to find'));
  const changesPage = await pageAs(crcCookie, '/changes');
  ok('every signed-in role can read "What we changed after testing"', changesPage.status === 200 && changesPage.body.includes('What we changed after testing') && changesPage.body.includes('Nothing to report yet'));
  const signedOutChanges = await fetch(`${BASE}/changes`, { redirect: 'manual' });
  ok('signed out, /changes sends you to sign in', signedOutChanges.status >= 300 && signedOutChanges.status < 400 && (signedOutChanges.headers.get('location') ?? '').includes('/login'));
  const shell = await pageAs(crcCookie, '/today');
  ok('the Feedback button is on a signed-in page', shell.body.includes('data-feedback-open'));
  const shellHi = await fetch(`${BASE}/today`, { headers: { cookie: `${crcCookie}; kv_lang=hi` } });
  ok('in Hindi it reads सुझाव दें', (await shellHi.text()).includes('सुझाव दें'));
  void host;
}

// ------------------------------------------------------------------ restore
console.log('\n— restore —');
if (BASE) {
  const appended = all<{ entity_type: string }>('select entity_type from audit_events where seq > ?', before.seq);
  if (appended.every((r) => r.entity_type === 'feedback')) {
    run('delete from audit_events where seq > ?', before.seq);
    run(`update app_sequences set value = ? where name = 'audit'`, before.auditCounter);
  } else {
    console.log('  note: other writes reached the audit chain during the run, so its rows were left in place');
  }
  run(`delete from feedback where cast(substr(id, 5) as integer) > ?`, before.fbk);
  run(`insert into app_sequences (name, value) values ('feedback', ?) on conflict(name) do update set value = excluded.value`, before.fbkCounter);
  run(`delete from ai_interactions where model = 'feedback-test' and cast(substr(id, 5) as integer) > ?`, before.aii);
  if (maxAii() === before.aii) run(`update app_sequences set value = ? where name = 'ai'`, before.aiCounter);
  const chain = feed.verifyAuditChain(auditor);
  ok('the audit chain still verifies after the clean-up', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
  ok('the test\'s feedback is gone', maxFbk() === before.fbk);
  try { db().close(); } catch { /* already closed */ }
  try { rmSync(BACKUP); } catch { /* fine */ }
} else {
  const chain = feed.verifyAuditChain(auditor);
  ok('the audit chain verifies with the feedback rows in it', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
  try { db().close(); } catch { /* already closed */ }
  swap(BACKUP, LIVE);
  try { rmSync(BACKUP); } catch { /* fine */ }
  console.log('  (no server address given: the HTTP checks were skipped)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
