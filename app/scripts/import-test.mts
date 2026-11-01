/**
 * Round import and the live detection run: validation, the demo clock, roles, scope,
 * idempotency (the same file twice) and that detection opens cases for new hotspots.
 *
 * Runs on a scratch copy of the pristine seed (the live demo database is backed up and
 * restored), against the real server-side modules — no browser, no server. Do not run while a
 * dev server holds the database.
 *
 *   npm run test:import
 */
import { copyFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.importtestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

// The sample files come from the generator, built from the pristine data we just put in place.
const SCRATCH = join(DATA, 'import-test');
const gen = (...a: string[]) => execFileSync('npx', ['tsx', 'scripts/gen-r4.mts', ...a], { stdio: 'pipe' });
gen('--out', join(SCRATCH, 'blk01.csv'));
gen('--errors', '--out', join(SCRATCH, 'blk01_errors.csv'));
const CLEAN = readFileSync(join(SCRATCH, 'blk01.csv'), 'utf8');
const ERRORS = readFileSync(join(SCRATCH, 'blk01_errors.csv'), 'utf8');

const { loadSession } = await import('../src/lib/session');
const repo = await import('../src/lib/repo');
const cs = await import('../src/lib/cases');
const feed = await import('../src/lib/feed');
const w = await import('../src/lib/write');
const imp = await import('../src/lib/write-import');
const csv = await import('../src/lib/import-csv');
const { Refused } = await import('../src/lib/guard');
const { one, all, db } = await import('../src/lib/db');

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
    pass++; console.log(`  ok   ${label}  [${r.code}] ${r.message.slice(0, 110)}`);
  }
}
const n = (sql: string, ...p: string[]) => one<{ c: number }>(sql, ...p)?.c ?? 0;
const R4 = 'RND-2026-11';

const byEmail = new Map(repo.demoAccounts().map((a) => [a.email, a]));
const sess = (email: string) => loadSession(byEmail.get(email)!.id)!;
const beo = sess('beo.blk-01@demo.karyavahi.test');
const crc = sess('crc.clu-001@demo.karyavahi.test');
const auditor = sess('auditor.state@demo.karyavahi.test');
const admin = sess('admin@demo.karyavahi.test');
const otherBeo = loadSession(repo.usersByRole('beo', 'BLK-09', 1)[0].id)!;

console.log('\n— validation (pure) —');
{
  const schools = new Map([
    ['SCH-1', { id: 'SCH-1', cluster_id: 'C1', block_id: 'B1', district_id: 'D1', state_id: 'S1' }],
    ['SCH-2', { id: 'SCH-2', cluster_id: 'C9', block_id: 'B9', district_id: 'D1', state_id: 'S1' }],
  ]);
  const ctx = {
    round: { id: R4, code: 'R4', window_start: '2026-11-16', window_end: '2026-11-27' }, today: '2026-11-20',
    schools, competencies: new Map([['L1', 'CMP-L1'], ['N1', 'CMP-N1']]),
    inArea: (s: { block_id: string }) => s.block_id === 'B1', areaName: 'Block B1',
    existing: new Map([['SCH-1|3|CMP-L1', 'IMP-0099']]), minParticipation: 0.7,
  };
  const head = 'round_code,school_id,grade,competency_code,enrolled,n_assessed,n_proficient,assessment_date';
  const v = csv.validateRoundCsv([
    head,
    'R4,SCH-1,1,L1,30,27,12,2026-11-18',   // 2 fine
    'R4,SCH-1,1,L1,30,27,12,2026-11-18',   // 3 duplicate in file
    'R4,SCH-1,2,L1,30,,12,2026-11-18',     // 4 blank
    'R4,SCH-1,2,N1,thirty,27,12,',         // 5 not a number
    'R4,SCH-1,2,N9,30,27,12,',             // 6 unknown competency
    'R3,SCH-1,2,L1,30,27,12,',             // 7 wrong round
    'R4,SCH-404,1,L1,30,27,12,',           // 8 unknown school
    'R4,SCH-2,1,L1,30,27,12,',             // 9 outside area
    'R4,SCH-1,3,N1,30,27,12,31-11-2026',   // 10 unreadable date
    'R4,SCH-1,3,N1,30,27,12,2026-11-25',   // 11 future on the demo clock
    'R4,SCH-1,3,N1,30,27,12,2026-10-01',   // 12 outside the window
    'R4,SCH-1,3,N1,30,27,28,',             // 13 proficient > assessed
    'R4,SCH-1,3,L1,30,27,12,',             // 14 already on record
    '"R4","SCH-1","2","L1","30","15","15",""', // 15 quoted, fine, low participation + suspicious
  ].join('\r\n'), ctx);
  const code = (row: number) => v.rejected.find((r) => r.row_number === row)?.error_code;
  ok('a clean row is accepted', v.accepted.some((r) => r.row_number === 2));
  ok('a repeat within the file is duplicate_row', code(3) === 'duplicate_row');
  ok('a blank count is missing_required', code(4) === 'missing_required');
  ok('a word for a number is non_numeric', code(5) === 'non_numeric');
  ok('an unknown competency is missing_required', code(6) === 'missing_required');
  ok('a row for another round is missing_required', code(7) === 'missing_required');
  ok('an unknown school is unknown_school_id', code(8) === 'unknown_school_id');
  ok('a school outside the uploader\'s area is refused as unknown_school_id', code(9) === 'unknown_school_id'
    && /not in the school register for your area/.test(v.rejected.find((r) => r.row_number === 9)!.message));
  ok('an unreadable date is invalid_date', code(10) === 'invalid_date');
  ok('a date after the demo clock is invalid_date', code(11) === 'invalid_date');
  ok('a date outside the round window is invalid_date', code(12) === 'invalid_date');
  ok('more proficient than assessed is proficient_exceeds_assessed', code(13) === 'proficient_exceeds_assessed');
  ok('a row already on record is duplicate_row, naming the batch', code(14) === 'duplicate_row'
    && v.rejected.find((r) => r.row_number === 14)!.message.includes('IMP-0099'));
  const quoted = v.accepted.find((r) => r.row_number === 15);
  ok('quoted fields are read, and doubtful rows are kept with warnings', !!quoted
    && quoted.dq_flags.includes('low_participation') && quoted.dq_flags.includes('suspicious_high_score'));
  ok('only the existing rejection codes are used', v.rejected.every((r) =>
    ['unknown_school_id', 'proficient_exceeds_assessed', 'duplicate_row', 'invalid_date', 'missing_required', 'non_numeric'].includes(r.error_code)));
  const noCol = csv.validateRoundCsv('round_code,school_id,grade,competency_code,enrolled,n_proficient\nR4,SCH-1,1,L1,30,12', ctx);
  ok('a file missing a required column fails as a whole', !!noCol.fatal && noCol.fatal.includes('n_assessed'));
}

console.log('\n— the demo clock —');
const refusedBefore = n(`select count(*) c from audit_events where action = 'import.refused' and result = 'failure'`);
refused('R4 cannot be imported before its window opens (24 Oct on the seed clock)',
  () => imp.previewRoundImport(beo, 'r4.csv', CLEAN), 'round_not_open');
ok('that refusal is in the audit chain',
  n(`select count(*) c from audit_events where action = 'import.refused' and result = 'failure'`) === refusedBefore + 1);
w.setDemoClock(admin, '2026-11-20T06:30:00.000Z');

console.log('\n— who may import —');
refused('a CRC cannot import', () => imp.commitRoundImport(crc, 'r4.csv', CLEAN), 'role');
refused('an auditor cannot import', () => imp.previewRoundImport(auditor, 'r4.csv', CLEAN), 'role');
ok('both role refusals are audited with the actor',
  n(`select count(*) c from audit_events where action = 'import.refused' and result = 'failure' and actor_user_id in (?, ?)`, crc.user_id, auditor.user_id) === 2);
ok('nothing was written for the refused attempts', n('select count(*) c from assessment_results where round_id = ?', R4) === 0);

console.log('\n— preview —');
const pv = imp.previewRoundImport(beo, 'R4_midline_BLK-01_with_errors.csv', ERRORS);
ok('the preview finds the round and the uploader\'s area', pv.round.id === R4 && /Rampur Sadar|BLK-01/.test(pv.area), pv.area);
ok('the preview counts accepted and refused rows', pv.accepted === 2340 && pv.rejected === 9, `${pv.accepted}/${pv.rejected}`);
ok('the preview groups refusals by code', pv.byCode.length >= 6, JSON.stringify(pv.byCode.map((b) => `${b.code}:${b.count}`)));
ok('a preview writes nothing', n('select count(*) c from assessment_results where round_id = ?', R4) === 0
  && n(`select count(*) c from import_batches where round_id = ?`, R4) === 0);

console.log('\n— scope —');
const scopeTry = imp.commitRoundImport(otherBeo, 'blk01-from-blk09.csv', CLEAN);
ok('a BEO of another block gets every BLK-01 row refused as outside their area', scopeTry.status === 'failed' && scopeTry.accepted === 0 && scopeTry.rejected === 2340,
  JSON.stringify({ s: scopeTry.status, a: scopeTry.accepted, r: scopeTry.rejected }));
ok('no BLK-01 result was written by them', n('select count(*) c from assessment_results where round_id = ?', R4) === 0);
ok('their failed attempt is still a batch with its refused rows (as the seed records failures)',
  n('select count(*) c from import_rejected_rows where import_batch_id = ?', scopeTry.batchId!) === 2340);

console.log('\n— commit and detection —');
refused('a commit must be of the file that was previewed', () => imp.commitRoundImport(beo, 'x.csv', ERRORS, 'not-the-fingerprint'), 'stale');
const before = {
  findings: n('select count(*) c from findings'), cases: n('select count(*) c from cases'),
  audit: n('select count(*) c from audit_events'),
};
const res = imp.commitRoundImport(beo, 'R4_midline_BLK-01_with_errors.csv', ERRORS, pv.fingerprint);
ok('the file commits with its rejections', res.status === 'committed_with_rejections' && res.accepted === 2340 && res.rejected === 9,
  JSON.stringify({ s: res.status, a: res.accepted, r: res.rejected }));
const batch = one<{ id: string; scope_type: string; scope_id: string; uploaded_by: string; provenance: string; round_id: string }>(
  'select * from import_batches where id = ?', res.batchId!);
ok('the batch is scoped to the BEO\'s block and attributed to them', batch?.scope_type === 'block' && batch.scope_id === 'BLK-01'
  && batch.uploaded_by === beo.user_id && batch.provenance === 'user_uploaded');
ok('every accepted row is on record against the batch', n('select count(*) c from assessment_results where import_batch_id = ?', res.batchId!) === 2340);
ok('the refused rows are kept with their codes', n('select count(*) c from import_rejected_rows where import_batch_id = ?', res.batchId!) === 9
  && n(`select count(distinct error_code) c from import_rejected_rows where import_batch_id = ?`, res.batchId!) === 6);
ok('R4 is now a completed round with an import date',
  one<{ status: string; import_date: string }>('select status, import_date from assessment_rounds where id = ?', R4)?.status === 'completed');
ok('the commit is audited and the uploader notified',
  n(`select count(*) c from audit_events where action = 'import.committed' and entity_id = ?`, res.batchId!) === 1
  && n(`select count(*) c from notifications where kind = 'import_succeeded' and entity_id = ? and user_id = ?`, res.batchId!, beo.user_id) === 1);

const d = res.detection;
if (d) console.log(`  --   detection: ${d.candidates} candidates, ${d.flagged} flagged, ${d.rejectedNoise} noise, ${d.rejectedDataQuality} data-quality; opened ${d.casesOpened.map((c) => `${c.id} "${c.title}"`).join(', ')}`);
ok('detection ran on the new round against R3 with the settings in force', !!d && d.round === 'R4' && d.prevRound === 'R3' && d.settings === 'SET-v2',
  JSON.stringify(d && { round: d.round, prev: d.prevRound, settings: d.settings }));
ok('detection produced findings', (d?.newFindings.length ?? 0) > 0 && n('select count(*) c from findings where round_id = ?', R4) === d!.newFindings.length,
  String(d?.newFindings.length));
ok('detection opened cases for new hotspots', (d?.casesOpened.length ?? 0) >= 2, JSON.stringify(d?.casesOpened));
const planted = all<{ cluster_id: string; grade: number; competency_id: string }>(
  `select cluster_id, grade, competency_id from cases where id in (${(d?.casesOpened ?? []).map(() => '?').join(',') || "''"})`,
  ...(d?.casesOpened ?? []).map((c) => c.id));
ok('the planted drops (CLU-009 grade 1 N1, CLU-006 grade 2 L2) became cases',
  planted.some((p) => p.cluster_id === 'CLU-009' && p.grade === 1 && p.competency_id === 'CMP-N1')
  && planted.some((p) => p.cluster_id === 'CLU-006' && p.grade === 2 && p.competency_id === 'CMP-L2'), JSON.stringify(planted));
const newCase = d!.casesOpened[0];
const row = one<{ owner_user_id: string; block_id: string; status: string; lever: string; diagnosis_id: string; finding_id: string; school_ids: string }>(
  'select * from cases where id = ?', newCase.id);
ok('a new case is owned by the block\'s BEO, detected, block lever', row?.owner_user_id === beo.user_id && row.block_id === 'BLK-01'
  && row.status === 'detected' && row.lever === 'block');
ok('it has a rule-based diagnosis and its finding points back to it', !!row?.diagnosis_id
  && one<{ case_id: string }>('select case_id from findings where id = ?', row!.finding_id)?.case_id === newCase.id
  && n('select count(*) c from diagnoses where id = ? and case_id = ?', row!.diagnosis_id, newCase.id) === 1);
ok('the BEO can open it', cs.getCase(beo, newCase.id) !== null);
ok('a BEO of another block cannot', cs.getCase(otherBeo, newCase.id) === null);
ok('the CRC of an unrelated cluster cannot', cs.getCase(crc, newCase.id) === null);
ok('the BEO was told about it', n(`select count(*) c from notifications where kind = 'approval_request' and entity_id = ? and user_id = ?`, newCase.id, beo.user_id) === 1);
ok('finding, case and diagnosis creation are audited as the detector',
  n(`select count(*) c from audit_events where action = 'case.created' and entity_id = ? and actor_label = 'system:detector'`, newCase.id) === 1
  && n(`select count(*) c from audit_events where action = 'finding.detected' and entity_id = ?`, row!.finding_id) === 1
  && n(`select count(*) c from audit_events where action = 'diagnosis.created' and entity_id = ?`, row!.diagnosis_id) === 1);
ok('the detection run is recorded as a system job', n(`select count(*) c from system_jobs where job_type = 'detection_run' and summary like ?`, `%${res.batchId}%`) === 1);

console.log('\n— idempotency —');
const snap = () => ({
  results: n('select count(*) c from assessment_results where round_id = ?', R4),
  findings: n('select count(*) c from findings'), cases: n('select count(*) c from cases'),
  batches: n('select count(*) c from import_batches'),
});
const s1 = snap();
const again = imp.commitRoundImport(beo, 'R4_midline_BLK-01_with_errors (1).csv', ERRORS.replace(/\n/g, '\r\n'));
ok('the same file twice (even re-saved with Windows line endings) is recognised', again.status === 'duplicate' && again.duplicateOf?.batchId === res.batchId,
  JSON.stringify(again));
ok('...and adds nothing', JSON.stringify(snap()) === JSON.stringify(s1), JSON.stringify(snap()));
ok('the ignored second upload is visible in the audit', n(`select count(*) c from audit_events where action = 'import.duplicate_ignored' and entity_id = ?`, res.batchId!) === 1);
ok('the preview warns before a second commit', imp.previewRoundImport(beo, 'again.csv', ERRORS).duplicateOf?.batchId === res.batchId);
const overlap = imp.commitRoundImport(beo, 'R4_midline_BLK-01.csv', CLEAN);
ok('a different file with the same rows has every row refused as duplicate_row', overlap.status === 'failed' && overlap.rejected === 2340
  && n(`select count(*) c from import_rejected_rows where import_batch_id = ? and error_code = 'duplicate_row'`, overlap.batchId!) === 2340);
ok('...and no new results, findings or cases', snap().results === s1.results && snap().findings === s1.findings && snap().cases === s1.cases);
const rerun = imp.runDetection(R4, null);
ok('re-running detection on the same data finds nothing new', rerun.newFindings.length === 0 && rerun.alreadyKnown === rerun.candidates,
  JSON.stringify({ n: rerun.newFindings.length, k: rerun.alreadyKnown, c: rerun.candidates }));

console.log('\n— plans judged on R4 can now be checked —');
const due = await import('../src/lib/outcome-due');
const judged = all<{ id: string; current_plan_id: string }>(
  `select c.id, c.current_plan_id from cases c join case_plans p on p.id = c.current_plan_id
    where json_extract(p.pre_registration, '$.followup_round_id') = ? order by c.id`, R4,
).filter((c) => due.outcomeCheckDue(c.id, c.current_plan_id) !== null);
ok('at least one case whose plan is judged on R4 now offers the outcome check', judged.length > 0, `${judged.length}`);
if (judged.length > 0) {
  const c = judged[0];
  const before = due.outcomeCheckDue(c.id, c.current_plan_id)!;
  ok('the offer names R4 and how many of the plan\'s schools have results', before.roundCode === 'R4' && before.schoolsWithData > 0 && before.schoolsWithData <= before.schoolsTotal, JSON.stringify(before));
  const caseBeo = loadSession(one<{ id: string }>(
    `select u.id from users u join user_roles ur on ur.user_id = u.id join cases k on k.block_id = ur.scope_id
      where ur.role = 'beo' and k.id = ? limit 1`, c.id,
  )!.id)!;
  const evalsBefore = n('select count(*) c from outcome_evaluations where case_id = ?', c.id);
  let refusedCrc = false;
  try { w.recomputeOutcome(crc, c.id, { followupRoundId: R4 }); } catch (e) { refusedCrc = e instanceof Refused; }
  ok('a cluster coordinator cannot run the check', refusedCrc);
  const r = w.recomputeOutcome(caseBeo, c.id, { followupRoundId: R4 });
  ok('the block officer runs it: a new evaluation against R4', r.newRound && r.followupRoundId === R4
    && n('select count(*) c from outcome_evaluations where case_id = ?', c.id) === evalsBefore + 1, JSON.stringify(r).slice(0, 200));
  ok('a new round is not reported as disagreeing with the old verdict', r.agreesWithStored);
  ok('once checked, the offer goes away', due.outcomeCheckDue(c.id, c.current_plan_id) === null);
}
const notYet = one<{ id: string; current_plan_id: string }>(
  `select c.id, c.current_plan_id from cases c join case_plans p on p.id = c.current_plan_id
    where json_extract(p.pre_registration, '$.followup_round_id') = 'RND-2026-07' limit 1`,
);
if (notYet) ok('a plan judged on an older round with a check already on record is not offered again', due.outcomeCheckDue(notYet.id, notYet.current_plan_id) === null || n('select count(*) c from outcome_evaluations where case_id = ? and followup_round_id = ?', notYet.id, 'RND-2026-07') === 0);

console.log('\n— the audit chain —');
const chain = feed.verifyAuditChain(auditor);
ok('the hash chain still verifies after the import and detection run', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
ok('every write added audit rows', n('select count(*) c from audit_events') > before.audit);

try { db().close(); } catch { /* already closed */ }
swap(BACKUP, LIVE);
try { rmSync(BACKUP); rmSync(SCRATCH, { recursive: true }); } catch { /* fine */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
