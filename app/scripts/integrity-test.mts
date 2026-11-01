/**
 * Data integrity: ids are unique and found by index, the audit chain keeps its order whatever
 * the demo clock says, generated ids never collide with seeded ones, and the columns other
 * screens read (closure type, verification status, proof counts) stay true after live writes.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/integrity-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.integritytestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };

try {
  const { loadSession } = await import('../src/lib/session');
  const { one, all, run, nextIdFor } = await import('../src/lib/db');
  const w = await import('../src/lib/write');
  const feed = await import('../src/lib/feed');
  const { logAi } = await import('../src/lib/ai/client');

  const S = (email: string) => loadSession(one<{ id: string }>('select id from users where email = ?', email)!.id)!;
  const beo = S('beo.blk-01@demo.karyavahi.test');
  const auditor = S('auditor.state@demo.karyavahi.test');
  const admin = S('admin@demo.karyavahi.test');

  console.log('--- ids are unique and indexed ---');
  const withId = all<{ name: string }>(
    `select m.name from sqlite_master m where m.type = 'table'
        and exists (select 1 from pragma_table_info(m.name) p where p.name = 'id')`,
  ).map((r) => r.name);
  const unindexed = withId.filter((t) => !all<{ name: string; unique: number }>(`select name, "unique" from pragma_index_list(?)`, t)
    .some((ix) => ix.unique && all<{ name: string }>('select name from pragma_index_info(?)', ix.name).map((c) => c.name).join() === 'id'));
  ok(`every table with an id column (${withId.length}) has a unique index on it`, unindexed.length === 0, unindexed.join(', '));
  const plan = all<{ detail: string }>(`explain query plan select * from tasks where id = 'TSK-00001'`).map((r) => r.detail).join(' ');
  ok('looking a task up by id uses the index, not a scan', /USING (INDEX|PRIMARY KEY|COVERING INDEX)/.test(plan), plan);
  let dup = false;
  try { run(`insert into cases (id) values ('CASE-0184')`); } catch { dup = true; }
  ok('a duplicate case id is refused by the database', dup);

  console.log('\n--- the audit chain has its own order ---');
  const n = Number(one<{ c: number }>('select count(*) c from audit_events')!.c);
  const seqs = one<{ lo: number; hi: number; d: number; nulls: number }>(
    'select min(seq) lo, max(seq) hi, count(distinct seq) d, sum(seq is null) nulls from audit_events')!;
  ok('every seeded row has a sequence number, 1..N with no gaps', seqs.lo === 1 && seqs.hi === n && seqs.d === n && !seqs.nulls,
    JSON.stringify(seqs));
  const v0 = feed.verifyAuditChain(auditor);
  ok('the seeded chain verifies', v0.linked && v0.contentOk && v0.genesisOk);
  ok('verification checks every row, not the first 60,000', v0.checked === n, `${v0.checked} of ${n}`);

  w.setDemoClock(admin, '2026-11-20T06:30:00.000Z');
  w.transitionCase(beo, 'CASE-0070', 'awaiting_verification');
  const later = one<{ seq: number; ts: string }>('select seq, ts from audit_events order by seq desc limit 1')!;
  w.setDemoClock(admin, '2026-10-24T06:30:00.000Z');
  w.transitionCase(beo, 'CASE-0070', 'in_progress', 'Back for another round of proof');
  const v1 = feed.verifyAuditChain(auditor);
  ok('moving the clock back and writing again keeps the chain linked', v1.linked, String(v1.firstBreakAt));
  ok('...and every row still re-hashes', v1.contentOk, String(v1.firstContentBreakAt));
  const newest = one<{ seq: number; ts: string }>('select seq, ts from audit_events order by seq desc limit 1')!;
  ok('rows written after the clock went back follow on in sequence, with their earlier time',
    newest.seq > later.seq && newest.ts < later.ts, JSON.stringify({ later, newest }));

  console.log('\n--- generated ids continue from the seed ---');
  const seqVal = (name: string) => Number(one<{ value: number }>('select value from app_sequences where name = ?', name)?.value ?? -1);
  const maxNum = (table: string, prefix: string) => Number(one<{ m: number }>(
    `select coalesce(max(cast(substr(id, ?) as integer)), 0) m from "${table}" where id like ?`, prefix.length + 1, `${prefix}%`)!.m);
  ok('the import batch counter follows IMP- ids', seqVal('batch') === maxNum('import_batches', 'IMP-'), `${seqVal('batch')} vs ${maxNum('import_batches', 'IMP-')}`);
  ok('the AI log counter follows AII- ids', seqVal('ai') === maxNum('ai_interactions', 'AII-'), `${seqVal('ai')} vs ${maxNum('ai_interactions', 'AII-')}`);
  const fresh = nextIdFor('test_counter', 'cases', 'CASE-', 4);
  ok('a new counter starts after the highest existing id', fresh === `CASE-${String(maxNum('cases', 'CASE-') + 1).padStart(4, '0')}`, fresh);
  const aiId = logAi(beo, { kind: 'chat', model: 'test', question: 'q', tools: [], referencedIds: [], status: 'ok' });
  ok('an AI log row gets the next AII- id from the counter', aiId === `AII-${String(maxNum('ai_interactions', 'AII-')).padStart(6, '0')}` && seqVal('ai') === maxNum('ai_interactions', 'AII-'), aiId);

  console.log('\n--- closing a case keeps its summary columns true ---');
  const pending = one<{ id: string; current_plan_id: string; block_id: string }>(
    `select c.id, c.current_plan_id, c.block_id from cases c
      where c.status = 'outcome_pending'
        and exists (select 1 from outcome_evaluations e where e.case_id = c.id and e.plan_id = c.current_plan_id)
      limit 1`);
  if (pending) {
    // Make its evaluation eligible, as a passing next round would.
    run(`update outcome_evaluations set closure_eligible = 1, category = 'improved_confirmed', closure_blockers = '[]'
          where case_id = ? and plan_id = ?`, pending.id, pending.current_plan_id);
    const officer = loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'beo' and scope_id = ?`, pending.block_id)!.user_id)!;
    {
      w.transitionCase(officer, pending.id, 'closed');
      const c = one<{ status: string; closure_type: string | null; verification_status: string }>(
        'select status, closure_type, verification_status from cases where id = ?', pending.id)!;
      ok(`${pending.id} closed`, c.status === 'closed');
      ok('its closure type is the outcome it closed on', c.closure_type === 'improved_confirmed', String(c.closure_type));
      ok('its verification status says verified', c.verification_status === 'verified', c.verification_status);
    }
  } else { fail++; console.log('  FAIL no outcome_pending case with an evaluation to close'); }
  const ver = one<{ version: number }>(`select version from cases where id = 'CASE-0070'`);
  ok('each move bumps the case version', (ver?.version ?? 0) >= 2, String(ver?.version));

  console.log('\n--- rejected proof does not count towards a task ---');
  // TSK-00010 needs 3 pieces; it has 3 on file, 2 of them rejected, and was sent back.
  const owner = loadSession(one<{ owner_user_id: string }>(`select owner_user_id from tasks where id = 'TSK-00010'`)!.owner_user_id)!;
  w.submitEvidence(owner, { taskId: 'TSK-00010', note: 'Attendance register photographed for week 3' });
  const t = one<{ status: string }>(`select status from tasks where id = 'TSK-00010'`)!;
  ok('one new piece on top of one accepted is still 2 of 3, so the task is not submitted', t.status === 'in_progress', t.status);

  console.log('\n--- recompute uses the terms locked at approval ---');
  const { settingsById } = await import('../../src/domain/catalog');
  ok('settings can be looked up by the version a plan locked', settingsById('SET-v1')?.outcome.min_participation === 0.7);
} catch (e) {
  fail++; console.log(`  FAIL the test crashed — ${(e as Error).stack}`);
} finally {
  { const { db: dbf } = await import('../src/lib/db'); try { dbf().close(); } catch { /* already closed */ } }
  swap(BACKUP, LIVE);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
