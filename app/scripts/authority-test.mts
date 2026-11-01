/**
 * Who may move a case, and who may approve a plan.
 *
 * Every legal move has a list of roles that may make it, and the role has to cover the case's
 * area: being able to see a case (a headmaster whose school is in it, an auditor, a task owner)
 * is not authority over it. A plan is approved by someone other than the person who submitted
 * it. The reminder sweep and the demo clock belong to the demo admin.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/authority-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.authtestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

const { loadSession } = await import('../src/lib/session');
const { one, run } = await import('../src/lib/db');
const { Refused, roleCovers } = await import('../src/lib/guard');
const w = await import('../src/lib/write');
const cs = await import('../src/lib/cases');
const plans = await import('../src/lib/plans');
const { TRANSITIONS, TRANSITION_ROLES } = await import('../../src/domain/lifecycle');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };
function refused(label: string, fn: () => unknown, codeWanted?: string) {
  try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
  catch (e) {
    if (!(e instanceof Refused)) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
    if (codeWanted && e.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${e.code}", wanted "${codeWanted}"`); return; }
    pass++; console.log(`  ok   ${label}  [${e.code}]`);
  }
}
const uid = (email: string) => one<{ id: string }>('select id from users where email = ?', email)!.id;
const S = (email: string) => loadSession(uid(email))!;
const hmOf = (school: string) => loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'headmaster' and scope_id = ?`, school)!.user_id)!;
const statusOf = (id: string) => one<{ status: string }>('select status from cases where id = ?', id)!.status;
const failures = (action: string, entity: string) => Number(one<{ c: number }>(
  `select count(*) c from audit_events where action = ? and entity_id = ? and result = 'failure'`, action, entity)?.c ?? 0);

const beo = S('beo.blk-01@demo.karyavahi.test');
const deo = S('deo.rmp@demo.karyavahi.test');
const otherDeo = S('deo.ksg@demo.karyavahi.test');
const state = S('state.lead@demo.karyavahi.test');
const auditor = S('auditor.state@demo.karyavahi.test');
const admin = S('admin@demo.karyavahi.test');

console.log('--- the role map covers every legal move ---');
const missing = Object.entries(TRANSITIONS).flatMap(([from, tos]) =>
  tos.filter((to) => !TRANSITION_ROLES[`${from}>${to}`]).map((to) => `${from}>${to}`));
ok('every move in TRANSITIONS has a role list', missing.length === 0, missing.join(', '));
const extra = Object.keys(TRANSITION_ROLES).filter((k) => { const [f, t] = k.split('>'); return !(TRANSITIONS as Record<string, readonly string[]>)[f]?.includes(t); });
ok('the role map lists no move that TRANSITIONS forbids', extra.length === 0, extra.join(', '));
ok('nobody but an officer may move a case forward on delivery',
  ['approved>assigned', 'assigned>in_progress', 'in_progress>awaiting_verification']
    .every((k) => TRANSITION_ROLES[k]!.every((r) => ['beo', 'deo'].includes(r))));

console.log('\n--- seeing a case is not authority over it ---');
// CASE-0070: in progress, Rampur Sadar block, cluster CLU-001, schools include SCH-00002.
const crc = S('crc.clu-001@demo.karyavahi.test');
const brc = S('brc1.blk-01@demo.karyavahi.test');
const hm = hmOf('SCH-00002');
ok('the headmaster can see CASE-0070', cs.getCase(hm, 'CASE-0070') !== null);
refused('an auditor cannot move a case', () => w.transitionCase(auditor, 'CASE-0070', 'awaiting_verification'), 'role');
refused('a headmaster whose school is in the case cannot move it', () => w.transitionCase(hm, 'CASE-0070', 'awaiting_verification'), 'role');
refused('the cluster coordinator cannot move it', () => w.transitionCase(crc, 'CASE-0070', 'awaiting_verification'), 'role');
refused('the block resource coordinator cannot move it', () => w.transitionCase(brc, 'CASE-0070', 'awaiting_verification'), 'role');
refused('the demo admin cannot move it', () => w.transitionCase(admin, 'CASE-0070', 'awaiting_verification'), 'role');
refused('the state team cannot push delivery along either', () => w.transitionCase(state, 'CASE-0070', 'awaiting_verification'), 'role');
ok('the refusals left the case where it was', statusOf('CASE-0070') === 'in_progress');
ok('each refusal is in the audit trail', failures('case.status_change_refused', 'CASE-0070') >= 6,
  String(failures('case.status_change_refused', 'CASE-0070')));
w.transitionCase(beo, 'CASE-0070', 'awaiting_verification');
ok('the block officer can', statusOf('CASE-0070') === 'awaiting_verification');

const blk01Case = { state_id: 'STA-01', district_id: 'DST-01', block_id: 'BLK-01', cluster_id: 'CLU-001', school_ids: ['SCH-00002'] };
ok('a block role covers a case in its block', roleCovers({ role: 'beo', scope_type: 'block', scope_id: 'BLK-01' }, blk01Case));
ok('a block role does not cover another block', !roleCovers({ role: 'beo', scope_type: 'block', scope_id: 'BLK-02' }, blk01Case));
ok('a school role covers a case naming its school', roleCovers({ role: 'headmaster', scope_type: 'school', scope_id: 'SCH-00002' }, { ...blk01Case, school_ids: '["SCH-00002"]' }));

// A district officer holding an acting charge for another district's block still may not act
// on Rampur Sadar with it: the role that grants the move has to be the one that covers the case.
const acting = { ...otherDeo, roles: [...otherDeo.roles, { role: 'crc' as const, scope_type: 'cluster' as const, scope_id: 'CLU-001', delegated: { id: 'DLG-T', from_user_id: 'x', ends_on: '2099-01-01' } }] };
ok('the acting charge lets them see CASE-0070', cs.getCase(acting, 'CASE-0070') !== null);
refused('an out-of-area DEO with an acting CRC charge cannot move a case in that cluster',
  () => w.transitionCase(acting, 'CASE-0070', 'in_progress', 'sent back'), 'area');

console.log('\n--- a plan is approved by someone other than its submitter ---');
const p184 = cs.getCase(beo, 'CASE-0184')!.current_plan_id!;
const sub184 = cs.caseApprovals(beo, 'CASE-0184').find((a) => a.decision === 'pending');
ok('CASE-0184 was submitted by the block officer', sub184?.submitted_by === beo.user_id, sub184?.submitted_by);
refused('the submitter cannot approve it', () => w.decidePlan(beo, { caseId: 'CASE-0184', planId: p184, decision: 'approved' }), 'own_submission');
refused('nor approve it with edits', () => w.decidePlan(beo, { caseId: 'CASE-0184', planId: p184, decision: 'approved_with_edits' }), 'own_submission');
refused('nor by moving the case directly', () => w.transitionCase(beo, 'CASE-0184', 'approved'), 'own_submission');
ok('the attempts are in the audit trail', failures('plan.approve_refused', 'CASE-0184') >= 3, String(failures('plan.approve_refused', 'CASE-0184')));
ok('the case still waits for a decision', statusOf('CASE-0184') === 'awaiting_approval');
ok("the block officer's approval queue no longer offers it", !cs.approvalQueue(beo).some((q) => q.case.id === 'CASE-0184'));
ok("the district officer's queue does", cs.approvalQueue(deo).some((q) => q.case.id === 'CASE-0184'));
refused("another district's officer cannot approve it", () => w.decidePlan(otherDeo, { caseId: 'CASE-0184', planId: p184, decision: 'approved' }), 'scope');
w.decidePlan(deo, { caseId: 'CASE-0184', planId: p184, decision: 'approved' });
ok('the district officer approves it', statusOf('CASE-0184') === 'approved');
ok('the approval row names the district officer',
  cs.caseApprovals(deo, 'CASE-0184').some((a) => a.decision === 'approved' && a.decided_by === deo.user_id));
{
  const pc = plans.planCase(beo, 'CASE-0184')!;
  refused('the cluster coordinator cannot assign the work', () => w.assignTasks(S('crc.clu-001@demo.karyavahi.test'), { caseId: 'CASE-0184', caseVersion: pc.version, rows: [] }), 'role');
  w.assignTasks(beo, { caseId: 'CASE-0184', caseVersion: pc.version, rows: plans.taskDrafts(pc, p184).map((d) => ({ rowKey: d.rowKey, ownerUserId: d.ownerUserId!, dueDate: d.dueDate })) });
}
ok('the block officer then assigns the work', statusOf('CASE-0184') === 'assigned');

console.log('\n--- submitting and withdrawing ---');
// CASE-0130: block lever, waiting on a decision, submitted by the block officer.
const p130 = cs.getCase(beo, 'CASE-0130')!.current_plan_id!;
refused('sending your own plan back still needs a reason', () => w.decidePlan(beo, { caseId: 'CASE-0130', planId: p130, decision: 'revision_requested' }), 'reason_required');
w.decidePlan(beo, { caseId: 'CASE-0130', planId: p130, decision: 'revision_requested', reason: 'Withdrawing to add a school' });
ok('the submitter may withdraw their own plan', statusOf('CASE-0130') === 'revision_requested');
refused('a headmaster cannot resubmit it', () => w.transitionCase(hmOf(JSON.parse(one<{ s: string }>(`select school_ids s from cases where id = 'CASE-0130'`)!.s)[0]), 'CASE-0130', 'awaiting_approval'), 'role');
w.transitionCase(beo, 'CASE-0130', 'awaiting_approval');
const resub = cs.caseApprovals(beo, 'CASE-0130').filter((a) => a.decision === 'pending');
ok('resubmitting opens exactly one pending approval', resub.length === 1, String(resub.length));
ok('it records who submitted it', resub[0]?.submitted_by === beo.user_id && resub[0]?.plan_id === p130);
ok('the plan is marked submitted again', one<{ status: string }>('select status from case_plans where id = ?', p130)?.status === 'submitted');
ok('the new approval names the lever it was submitted under, and the role that lever needs',
  resub[0]?.lever === 'block' && resub[0]?.required_role === 'beo' && one<{ l: string }>('select lever l from approvals where id = ?', resub[0]!.id)?.l === 'block');
refused('the resubmitter cannot approve it either', () => w.decidePlan(beo, { caseId: 'CASE-0130', planId: p130, decision: 'approved' }), 'own_submission');
w.decidePlan(deo, { caseId: 'CASE-0130', planId: p130, decision: 'approved' });
ok('the district officer approves the resubmitted plan, and the row is decided',
  statusOf('CASE-0130') === 'approved' && cs.caseApprovals(deo, 'CASE-0130').some((a) => a.id === resub[0]?.id && a.decision === 'approved'));

const ui = one<{ id: string; block_id: string }>(`select id, block_id from cases where status = 'under_investigation' limit 1`)!;
const uiBeo = loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'beo' and scope_id = ?`, ui.block_id)!.user_id)!;
run('update cases set current_plan_id = null where id = ?', ui.id);
refused('a case with no plan cannot be submitted for approval', () => w.transitionCase(uiBeo, ui.id, 'awaiting_approval'), 'no_plan');

console.log('\n--- the reminder sweep and the demo clock ---');
refused('a block officer cannot run the reminder sweep', () => w.reminderSweep(beo), 'role');
refused('the state team cannot run it', () => w.reminderSweep(state), 'role');
refused('a CRC cannot run it with a made-up date', () => w.reminderSweep(crc, '2030-01-01'), 'role');
ok('a refused sweep is in the audit trail', failures('demo.sweep_refused', 'reminder_sweep') >= 3);
refused('the demo admin cannot run it for a date that is not a date', () => w.reminderSweep(admin, 'soon'), 'bad_input');
const swept = w.reminderSweep(admin);
ok('the demo admin can run it', typeof swept.remindersSent === 'number');
ok('the system itself (no session) can still run it', typeof w.reminderSweep(null).remindersSent === 'number');
refused('the state team cannot move the demo clock', () => w.setDemoClock(state, '2026-11-20T06:30:00Z'), 'role');
w.setDemoClock(admin, '2026-11-20T06:30:00.000Z');
ok('the demo admin can', one<{ value: string }>(`select value from app_state where key = 'demo_clock'`)?.value.startsWith('2026-11-20') === true);

console.log('\n--- an approval waits on the role its own plan\'s lever needs ---');
{
  const { all } = await import('../src/lib/db');
  const { requiredRoleFor, LEVER_DECIDERS } = await import('../src/lib/guard');
  type Row = { id: string; case_id: string; plan_id: string; required_role: string; lever: string | null; plan_lever: string | null; case_lever: string; decision: string; current: number };
  const rows = all<Row>(`select a.id, a.case_id, a.plan_id, a.required_role, a.lever, i.lever plan_lever, c.lever case_lever, a.decision,
                                (a.plan_id = c.current_plan_id) current
                           from approvals a join cases c on c.id = a.case_id
                           left join case_plans p on p.id = a.plan_id left join interventions i on i.id = p.intervention_id`);
  ok(`every approval (${rows.length}) records the lever it was decided under`, rows.every((r) => !!r.lever), rows.filter((r) => !r.lever).map((r) => r.id).join(', '));
  ok('for the seeded ones that is the lever of the approval\'s own plan', rows.filter((r) => r.plan_lever).every((r) => r.lever === r.plan_lever || r.decision === 'pending'));
  const bad = rows.filter((r) => r.lever && r.required_role !== requiredRoleFor(r.lever as 'block'));
  ok('and every required role agrees with that lever (block: BEO; district and PAB: DEO)', bad.length === 0, bad.map((r) => `${r.id} ${r.lever}/${r.required_role}`).join(', '));
  const moved = rows.filter((r) => r.lever !== r.case_lever);
  ok(`approvals that differ from the case's lever today (${moved.length}) are all for an earlier plan or a PAB referral`,
    moved.every((r) => !r.current || r.case_lever === 'pab'), moved.filter((r) => r.current && r.case_lever !== 'pab').map((r) => r.id).join(', '));
  const pending = rows.filter((r) => r.decision === 'pending');
  ok(`every pending approval (${pending.length}) waits on a role the decision gate accepts for the case`,
    pending.every((r) => LEVER_DECIDERS[r.case_lever as 'block'].includes(r.required_role as 'beo')));
  const old = rows.find((r) => r.lever !== r.case_lever && !r.current)!;
  const shown = cs.caseApprovals(state, old.case_id).find((a) => a.id === old.id)!;
  ok(`the case page shows ${old.id} under its own plan's lever (${old.lever}), not the case's current one (${old.case_lever})`,
    shown.lever === old.lever && shown.required_role === requiredRoleFor(old.lever as 'block'));
}

console.log('\n--- the AI executive briefing follows its permission ---');
{
  const { may } = await import('../src/lib/guard');
  const br = await import('../src/lib/ai/briefing');
  const crc = S('crc.clu-001@demo.karyavahi.test');
  ok('the permission matrix gives it to district and state officers', br.mayReadBriefing(deo) && br.mayReadBriefing(state) && may(deo, 'ai.executive_briefing'));
  ok('…and not to a block officer or a field coordinator, who still have the assistant', !br.mayReadBriefing(beo) && !br.mayReadBriefing(crc) && may(beo, 'ai.assistant'));
  const r = await br.generateBriefing(beo);
  ok('asking for one as a block officer is refused before any model is called', r.status === 'error' && r.message === br.BRIEFING_REFUSAL, JSON.stringify(r));
  ok('and no briefing is handed back from the store either', br.cachedBriefing(beo) === null);
}

{ const { db: dbf } = await import('../src/lib/db'); try { dbf().close(); } catch { /* already closed */ } }
swap(BACKUP, LIVE);
for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
