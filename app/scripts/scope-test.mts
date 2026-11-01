/**
 * Reads stay inside the reader's area: district auditors, import batches and their rejected
 * rows (directly, through the AI and in reports), the accounts list, and the people a user
 * may name in a complaint or set as someone's manager.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/scope-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.scopetestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };

try {
  const { loadSession } = await import('../src/lib/session');
  const { one, all } = await import('../src/lib/db');
  const { Refused } = await import('../src/lib/guard');
  const feed = await import('../src/lib/feed');
  const cmp = await import('../src/lib/complaints');
  const org = await import('../src/lib/org');
  const { runTool } = await import('../src/lib/ai/tools');
  const { buildReport } = await import('../src/lib/reports');

  const refused = (label: string, fn: () => unknown, code?: string) => {
    try { fn(); ok(label, false, 'was allowed'); }
    catch (e) { ok(label, e instanceof Refused && (!code || e.code === code), `${(e as Refused).code}: ${(e as Error).message}`); }
  };
  const S = (email: string) => loadSession(one<{ id: string }>('select id from users where email = ?', email)!.id)!;
  const userIn = (role: string, district: string) => one<{ user_id: string }>(
    `select ur.user_id from user_roles ur join blocks b on b.id = ur.scope_id where ur.role = ? and b.district_id = ? limit 1`, role, district)!.user_id;
  const stateAud = S('auditor.state@demo.karyavahi.test');
  const rmpAud = S('auditor.rmp@demo.karyavahi.test');   // DST-01
  const ksgAud = S('auditor.ksg@demo.karyavahi.test');   // DST-02
  const beo = S('beo.blk-01@demo.karyavahi.test');       // BLK-01, DST-01

  console.log('--- a district auditor reads their district, the state auditor reads everything ---');
  const caseIn = (d: string) => one<{ id: string }>(`select c.id from cases c where c.district_id = ? and exists (select 1 from audit_events a where a.entity_type = 'case' and a.entity_id = c.id) limit 1`, d)!.id;
  const own = caseIn('DST-01'), other = caseIn('DST-02');
  ok('the district auditor sees audit entries for a case in their district', feed.auditFor(rmpAud, 'case', own).length > 0);
  ok("they do not see another district's case entries", feed.auditFor(rmpAud, 'case', other).length === 0);
  ok('the state auditor sees both', feed.auditFor(stateAud, 'case', own).length > 0 && feed.auditFor(stateAud, 'case', other).length > 0);
  const total = Number(one<{ c: number }>('select count(*) c from audit_events')!.c);
  ok('the state auditor can read the whole trail', feed.countAudit(stateAud) === total, `${feed.countAudit(stateAud)} of ${total}`);
  ok('a district auditor reads only part of it', feed.countAudit(rmpAud) < total && feed.countAudit(rmpAud) > 0, String(feed.countAudit(rmpAud)));
  ok('no account or system entries for a district auditor', feed.listAudit(rmpAud, { limit: 5000 }).every((a) => a.entity_type === 'case'));

  const aiUser = (d: string) => one<{ user_id: string }>(
    `select ai.user_id from ai_interactions ai join user_roles ur on ur.user_id = ai.user_id join blocks b on b.id = ur.scope_id where b.district_id = ? limit 1`, d)?.user_id;
  const rmpAi = feed.listAi(rmpAud, { limit: 5000 });
  const ksgUser = aiUser('DST-02');
  ok("a district auditor sees AI questions from their district's officers", aiUser('DST-01') !== undefined && rmpAi.some((r) => r.user_id === aiUser('DST-01')));
  ok("but not another district's", ksgUser !== undefined && !rmpAi.some((r) => r.user_id === ksgUser));
  ok('the state auditor sees every AI question', feed.listAi(stateAud, { limit: 5000 }).length >= rmpAi.length);

  const otherReport = one<{ id: string }>(`select r.id from reports r where r.scope_id = 'DST-02' limit 1`);
  if (otherReport) {
    ok("a district auditor cannot open another district's report", feed.getReport(rmpAud, otherReport.id) === null);
    ok('the state auditor can', feed.getReport(stateAud, otherReport.id) !== null);
  } else console.log('  --   (no report scoped to DST-02)');

  const restricted = one<{ id: string; district_id: string }>(`select id, district_id from complaints where confidentiality = 'restricted' limit 1`)!;
  ok(`the ${restricted.district_id} auditor sees the restricted complaint there`, cmp.complaintAccess(rmpAud, restricted.id) !== null);
  ok('another district\'s auditor does not', cmp.complaintAccess(ksgAud, restricted.id) === null);
  ok('the state auditor does', cmp.complaintAccess(stateAud, restricted.id) !== null);

  console.log('\n--- imports stay in the officer\'s area ---');
  // IMP-0039 is a district batch for DST-02; its 37 stored rejected rows fall in six of its blocks.
  const DST02 = 'IMP-0039';
  const stateBatch = one<{ id: string }>(`select id from import_batches where scope_type = 'state' limit 1`)!.id;
  const beoBatches = feed.listImports(beo, { limit: 500 });
  ok("a block officer in DST-01 does not see DST-02's import batch", !beoBatches.some((b) => b.id === DST02) && feed.getImport(beo, DST02) === null);
  ok('nor its rejected rows', feed.importRejections(beo, DST02).length === 0);
  ok('they do see a state-wide batch, which covers their block', beoBatches.some((b) => b.id === stateBatch));
  const codes = (s: typeof beo) => feed.rejectionCodeCounts(s).reduce((n, r) => n + Number(r.c), 0);
  ok('their rejection-code counts include none of DST-02\'s rows', codes(beo) === 0, String(codes(beo)));

  const beo07 = loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'beo' and scope_id = 'BLK-07'`)!.user_id)!;
  const mine = feed.importRejections(beo07, DST02);
  const blockOf = (id: string) => one<{ block_id: string }>('select block_id from schools where id = ?', id)?.block_id;
  // 8 of the 37 were rejected because their school id matches no school: they hold no school's
  // data, so whoever can see the batch sees them, to correct them.
  const unknown = Number(one<{ c: number }>(`select count(*) c from import_rejected_rows r where r.import_batch_id = ? and not exists (select 1 from schools sc where sc.id = json_extract(r.raw, '$.school_id'))`, DST02)!.c);
  const blk07Rows = Number(one<{ c: number }>(`select count(*) c from import_rejected_rows r join schools sc on sc.id = json_extract(r.raw, '$.school_id') where sc.block_id = 'BLK-07'`)!.c);
  ok('a DST-02 block officer sees the batch', feed.getImport(beo07, DST02) !== null);
  ok('but of the rows naming real schools, only those in their own block',
    mine.length === blk07Rows + unknown && mine.every((r) => blockOf(r.raw.school_id) === 'BLK-07' || blockOf(r.raw.school_id) === undefined),
    `${mine.length} vs ${blk07Rows} + ${unknown} unknown`);
  ok('and only those in their counts', codes(beo07) === blk07Rows + unknown, `${codes(beo07)} vs ${blk07Rows} + ${unknown}`);
  ok('the state auditor sees all 37', feed.importRejections(stateAud, DST02).length === 37 && codes(stateAud) === 37);
  ok('the DST-02 auditor sees all of their district\'s rows', feed.importRejections(ksgAud, DST02).length === 37);
  ok('the DST-01 auditor sees none', feed.importRejections(rmpAud, DST02).length === 0);

  const tool = JSON.stringify(runTool(beo, 'get_data_quality_issues', {}).result);
  ok('the AI data-quality tool lists no batch outside their area', !tool.includes(DST02) && !tool.includes('IMP-0038'));
  const dq = JSON.stringify(buildReport(beo, { type: 'data_quality' }));
  ok('the data-quality report lists no batch outside their area', !dq.includes(DST02) && !dq.includes('IMP-0038'));

  console.log('\n--- the accounts list shows only people inside your area ---');
  const listed = org.usersInArea(beo);
  ok('a block officer sees people in their block', listed.some((u) => u.role === 'headmaster'));
  ok('but not the district officer, the state team or auditors above them', !listed.some((u) => ['deo', 'state_admin', 'auditor', 'demo_admin'].includes(u.role)),
    [...new Set(listed.map((u) => u.role))].join(','));
  ok('nor anyone in another block', listed.every((u) => u.scope_type === 'block' ? u.scope_id === 'BLK-01' : true));

  console.log('\n--- names a user can put into a complaint or a reporting line ---');
  const hm = loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'headmaster' and scope_id = 'SCH-00002'`)!.user_id)!;
  const stranger = userIn('beo', 'DST-02');
  refused('a conduct complaint cannot name someone outside your reporting line', () => cmp.createComplaint(hm, {
    category: 'conduct', title: 'Conduct concern', description: 'An officer behaved improperly during a visit.',
    priority: 'medium', severity: 'medium', restricted: true, accusedUserId: stranger,
  }), 'input');
  const farCase = one<{ id: string }>(`select id from cases where district_id = 'DST-02' limit 1`)!.id;
  refused('a complaint cannot link a case you cannot see', () => cmp.createComplaint(hm, {
    category: one<{ key: string }>(`select key from complaint_categories where confidential_default = 0 limit 1`)!.key,
    title: 'Linked to a far case', description: 'Trying to attach a case from another district.',
    priority: 'low', severity: 'low', caseId: farCase,
  }), 'scope');
  const crcOfHm = one<{ user_id: string }>(`select user_id from user_roles where role = 'crc' and scope_id = 'CLU-001'`)!.user_id;
  refused('a block officer cannot make someone report to an officer outside their block',
    () => org.setManager(beo, hm.user_id, S('state.lead@demo.karyavahi.test').user_id, 'test'), 'scope');
  org.setManager(beo, hm.user_id, crcOfHm, 'Report to the cluster coordinator');
  ok('they can choose someone inside it', org.managerOf(hm.user_id) === crcOfHm);
  refused('nor can a manager be junior to the person', () => org.setManager(beo, crcOfHm, hm.user_id, 'test'), 'input');
} catch (e) {
  fail++; console.log(`  FAIL the test crashed — ${(e as Error).stack}`);
} finally {
  { const { db: dbf } = await import('../src/lib/db'); try { dbf().close(); } catch { /* already closed */ } }
  swap(BACKUP, LIVE);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
