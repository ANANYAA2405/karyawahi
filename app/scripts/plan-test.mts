/**
 * The Plan Composer and the task generator, end to end in the write layer.
 *
 * A block officer composes a plan for a case under investigation and submits it; the district
 * officer approves it, which locks the terms of the outcome check; the block officer turns it
 * into tasks. Along the way: who may do each step, what is refused and recorded, that the stored
 * plan matches the preview, and that every task goes to someone who covers its school.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/plan-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.plantestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

let pass = 0, fail = 0;
try {
  const { loadSession } = await import('../src/lib/session');
  const { one, all, j } = await import('../src/lib/db');
  const { Refused } = await import('../src/lib/guard');
  const w = await import('../src/lib/write');
  const cs = await import('../src/lib/cases');
  const plans = await import('../src/lib/plans');
  const feed = await import('../src/lib/feed');
  const { today, addDays } = await import('../src/lib/clock');

  const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };
  const refused = (label: string, fn: () => unknown, codeWanted?: string) => {
    try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
    catch (e) {
      if (!(e instanceof Refused)) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
      if (codeWanted && e.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${e.code}" (${e.message}), wanted "${codeWanted}"`); return; }
      pass++; console.log(`  ok   ${label}  [${e.code}]`);
    }
  };
  const uid = (email: string) => one<{ id: string }>('select id from users where email = ?', email)!.id;
  const S = (email: string) => loadSession(uid(email))!;
  const CASE = 'CASE-0127';
  const caseRow = () => one<{ status: string; version: number; current_plan_id: string; lever: string; school_ids: string }>(
    'select status, version, current_plan_id, lever, school_ids from cases where id = ?', CASE)!;
  const failures = (action: string) => Number(one<{ c: number }>(
    `select count(*) c from audit_events where action = ? and entity_id = ? and result = 'failure'`, action, CASE)?.c ?? 0);

  // CASE-0127: under investigation, block lever, Amroha district, block BLK-17, cluster CLU-126,
  // with an AI draft that was never submitted.
  const beo = S('beo.blk-17@demo.karyavahi.test');
  const deo = S('deo.amp@demo.karyavahi.test');
  const otherBeo = S('beo.blk-18@demo.karyavahi.test');
  const crc = S('crc.clu-126@demo.karyavahi.test');
  const brc = S('brc1.blk-17@demo.karyavahi.test');
  const state = S('state.lead@demo.karyavahi.test');
  const auditor = S('auditor.state@demo.karyavahi.test');

  console.log('--- the composer view ---');
  const start = caseRow();
  ok(`${CASE} starts under investigation with an unsubmitted AI draft`, start.status === 'under_investigation'
    && one<{ status: string; drafted_by: string }>('select status, drafted_by from case_plans where id = ?', start.current_plan_id)?.drafted_by === 'ai_draft');
  const view = plans.composerView(beo, CASE)!;
  ok('the block officer may compose a plan', view.refusal === null, JSON.stringify(view.refusal));
  ok('the cluster coordinator is told why not', plans.composerView(crc, CASE)?.refusal?.code === 'role');
  const eligible = view.matches.filter((m) => m.eligible);
  ok('the ranked matches offer at least two eligible interventions', eligible.length >= 2, String(eligible.length));
  ok('the candidate schools are the driver schools, largest share first',
    view.schools.length >= 2 && view.schools.every((x) => x.driver)
      && view.schools.every((x, i, a) => i === 0 || (a[i - 1].share ?? 0) >= (x.share ?? 0)));

  // Prefer an intervention where a resource coordinator both delivers and checks, so the
  // independence rule gets exercised below.
  const both = eligible.find((m) => m.intervention.task_templates.some((t) => t.owner_role === 'brc' && !t.cross_source)
    && m.intervention.task_templates.some((t) => t.owner_role === 'brc' && t.cross_source));
  const pick = both ?? eligible[0];
  const ivId = pick.intervention.id;
  console.log(`       composing with ${ivId} (${pick.intervention.name})`);
  const schools = view.schools.map((x) => x.id).slice(0, Math.max(2, view.schools.length - 1));
  const pc = plans.planCase(beo, CASE)!;
  const preview = plans.previewPlan(pc, view.matches, ivId, [...schools].reverse())!;
  ok('the preview puts the schools back in the candidate order', JSON.stringify(preview.schoolIds) === JSON.stringify(schools));
  const pre = preview.preRegistration!;
  ok('the outcome check reads the next round after the finding', pre.baseline_round_id === 'RND-2026-07' && pre.followup_round_id === 'RND-2026-11', `${pre.baseline_round_id} → ${pre.followup_round_id}`);
  ok('two comparison schools per plan school', pre.comparison_school_ids.length === 2 * schools.length, String(pre.comparison_school_ids.length));
  const compRows = all<{ id: string; district_id: string; cluster_id: string }>(
    `select id, district_id, cluster_id from schools where id in (${pre.comparison_school_ids.map(() => '?').join(',')})`, ...pre.comparison_school_ids);
  ok('comparison schools are in the same district but another cluster',
    compRows.length === pre.comparison_school_ids.length && compRows.every((r) => r.district_id === 'DST-03' && r.cluster_id !== 'CLU-126'));
  const busy = new Set(all<{ school_ids: string }>(`select school_ids from cases where id <> ? and status not in ('closed','dismissed','referred_pab')`, CASE)
    .flatMap((r) => j<string[]>(r.school_ids, [])));
  ok('no comparison school is in another open case', pre.comparison_school_ids.every((id) => !busy.has(id)));
  ok('the threshold comes from the settings in force', pre.success_threshold_pp === 8 && pre.settings_version_id === 'SET-v2', `${pre.success_threshold_pp} ${pre.settings_version_id}`);

  console.log('\n--- who may compose, and what is refused ---');
  const good = { caseId: CASE, interventionId: ivId, schoolIds: schools, rationale: 'Teacher left two of these schools; CRC visits stopped in June.', caseVersion: start.version };
  refused('the cluster coordinator cannot compose a plan', () => w.draftPlan(crc, good), 'role');
  refused('the block resource coordinator cannot', () => w.draftPlan(brc, good), 'role');
  refused('the state team cannot', () => w.draftPlan(state, good), 'role');
  refused('an auditor cannot', () => w.draftPlan(auditor, good), 'role');
  refused("another block's officer cannot", () => w.draftPlan(otherBeo, good), 'scope');
  const excluded = view.matches.find((m) => !m.eligible)!;
  refused(`an intervention that does not fit is refused (${excluded.intervention.id})`, () => w.draftPlan(beo, { ...good, interventionId: excluded.intervention.id }), 'ineligible');
  refused('an unknown intervention is refused', () => w.draftPlan(beo, { ...good, interventionId: 'INT-99' }), 'not_found');
  refused('a school from outside the case is refused', () => w.draftPlan(beo, { ...good, schoolIds: [...schools, 'SCH-00001'] }), 'school_out_of_case');
  refused('a plan with no schools is refused', () => w.draftPlan(beo, { ...good, schoolIds: [] }), 'no_schools');
  refused('a plan needs a stated reason', () => w.draftPlan(beo, { ...good, rationale: 'ok' }), 'reason_required');
  refused('a stale form is refused', () => w.draftPlan(beo, { ...good, caseVersion: start.version - 1 }), 'stale');
  ok('role refusals are in the audit trail', failures('plan.draft_refused') >= 4, String(failures('plan.draft_refused')));
  ok('nothing changed on the case', caseRow().current_plan_id === start.current_plan_id && caseRow().version === start.version);

  console.log('\n--- saving the draft ---');
  const { planId } = w.draftPlan(beo, { ...good, schoolIds: [...schools].reverse() });
  const plan = one<{ case_id: string; cycle: number; version: number; intervention_id: string; school_ids: string; drafted_by: string; status: string; pre_registration: string; created_by: string; alternatives: string; estimated_cost_inr: number }>(
    'select * from case_plans where id = ?', planId)!;
  ok('a new plan row is written for the case', plan.case_id === CASE && plan.intervention_id === ivId);
  ok('it is officer-written, a draft, and records who wrote it', plan.drafted_by === 'officer' && plan.status === 'draft' && plan.created_by === beo.user_id);
  ok('it is the next version in the same cycle', plan.cycle === 1 && plan.version === 2, `cycle ${plan.cycle} v${plan.version}`);
  ok('its schools are stored in the candidate order', plan.school_ids === JSON.stringify(schools));
  ok('the stored comparison schools and threshold are exactly the preview', plan.pre_registration === JSON.stringify(pre));
  ok('alternatives and an illustrative cost are recorded', j<string[]>(plan.alternatives, []).length === 2 && plan.estimated_cost_inr === preview.estimatedCost);
  ok('the unsubmitted AI draft is marked superseded', one<{ status: string }>('select status from case_plans where id = ?', start.current_plan_id)?.status === 'superseded');
  const afterDraft = caseRow();
  ok('the case now points at the new plan, one version on', afterDraft.current_plan_id === planId && afterDraft.version === start.version + 1);
  ok('the case takes the intervention\'s lever', afterDraft.lever === pick.intervention.lever);
  ok('the draft is in the audit trail', feed.auditFor(auditor, 'case_plan', planId).some((a) => a.action === 'plan.drafted' && a.result === 'success'));
  ok('and on the case timeline', cs.caseTimeline(beo, CASE).some((e) => e.kind === 'plan_drafted'));
  refused('the form the officer started from is now stale', () => w.draftPlan(beo, good), 'stale');

  console.log('\n--- submitting and approving ---');
  w.transitionCase(beo, CASE, 'awaiting_approval');
  const approval = cs.caseApprovals(beo, CASE).find((a) => a.decision === 'pending');
  ok('submitting opens a pending approval in the officer\'s name', approval?.submitted_by === beo.user_id && approval?.plan_id === planId);
  const snapshot = j<{ pre_registration?: unknown }>(one<{ o: string }>('select original_plan o from approvals where id = ?', approval!.id)?.o, {});
  ok('the approval keeps a copy of the terms being approved', JSON.stringify(snapshot.pre_registration) === JSON.stringify(pre));
  refused('a submitted plan cannot be recomposed', () => w.draftPlan(beo, { ...good, caseVersion: caseRow().version }), 'wrong_status');
  // A block-lever plan is refused to its submitter by maker-checker; a district-lever one is
  // refused to any block officer by the lever, before maker-checker is reached.
  refused('the officer who submitted it cannot approve it', () => w.decidePlan(beo, { caseId: CASE, planId, decision: 'approved' }),
    pick.intervention.lever === 'block' ? 'own_submission' : 'lever');
  w.decidePlan(deo, { caseId: CASE, planId, decision: 'approved' });
  ok('the district officer approves it', caseRow().status === 'approved');
  ok('approving left the terms exactly as submitted', one<{ p: string }>('select pre_registration p from case_plans where id = ?', planId)?.p === JSON.stringify(pre));
  ok("the plan's schools are now the case's schools", caseRow().school_ids === JSON.stringify(schools));

  console.log('\n--- turning the plan into tasks ---');
  refused('the case cannot be marked assigned without tasks', () => w.transitionCase(beo, CASE, 'assigned'), 'no_tasks');
  const pa = plans.planCase(beo, CASE)!;
  const drafts = plans.taskDrafts(pa, planId);
  const expected = pick.intervention.task_templates.reduce((n, t) => n + (t.per_school ? schools.length : 1), 0);
  ok(`one task per template, per school where the template says so (${expected})`, drafts.length === expected, String(drafts.length));
  ok('every task has a suggested owner', drafts.every((d) => d.ownerUserId));
  ok('titles have the class and competency written in', drafts.every((d) => !/[{}]/.test(d.title_en + d.title_hi)));
  ok('the independent check comes last', drafts.at(-1)!.template.cross_source);
  const hmOk = drafts.filter((d) => d.template.owner_role === 'headmaster').every((d) =>
    one<{ c: number }>(`select count(*) c from user_roles where user_id = ? and role = 'headmaster' and scope_id = ?`, d.ownerUserId, d.schoolId)?.c === 1);
  ok("headmaster tasks go to that school's headmaster", hmOk);
  const crcDraft = drafts.find((d) => d.template.owner_role === 'crc');
  if (crcDraft) ok("cluster tasks default to the case's own cluster coordinator", crcDraft.ownerUserId === crc.user_id);
  const deliverers = new Set(drafts.filter((d) => !d.template.cross_source).map((d) => d.ownerUserId));
  ok('the default for the independent check is not delivering any of the work', drafts.filter((d) => d.template.cross_source).every((d) => !deliverers.has(d.ownerUserId)));

  const rows = () => drafts.map((d) => ({ rowKey: d.rowKey, ownerUserId: d.ownerUserId!, dueDate: d.dueDate }));
  const v = pa.version;
  refused('the cluster coordinator cannot assign the work', () => w.assignTasks(crc, { caseId: CASE, caseVersion: v, rows: rows() }), 'role');
  refused('nor can a resource coordinator', () => w.assignTasks(brc, { caseId: CASE, caseVersion: v, rows: rows() }), 'role');
  refused("nor another block's officer", () => w.assignTasks(otherBeo, { caseId: CASE, caseVersion: v, rows: rows() }), 'scope');
  refused('a task cannot be dropped', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: rows().slice(1) }), 'bad_input');
  refused('a task cannot be listed twice', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: [...rows(), rows()[0]] }), 'bad_input');
  refused('a task the plan does not have cannot be added', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: [...rows(), { rowKey: 'invented|', ownerUserId: beo.user_id, dueDate: today() }] }), 'bad_input');
  const hmRow = drafts.findIndex((d) => d.template.owner_role === 'headmaster');
  if (hmRow >= 0) {
    const wrongHm = one<{ user_id: string }>(`select user_id from user_roles where role = 'headmaster' and scope_id = 'SCH-00001'`)!.user_id;
    refused("a school's task cannot go to another school's headmaster",
      () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: rows().map((r, i) => (i === hmRow ? { ...r, ownerUserId: wrongHm } : r)) }), 'owner');
  }
  refused('a due date in the past is refused', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: rows().map((r, i) => (i === 0 ? { ...r, dueDate: addDays(today(), -1) } : r)) }), 'bad_input');
  refused('a due date that is not a date is refused', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: rows().map((r, i) => (i === 0 ? { ...r, dueDate: 'soon' } : r)) }), 'bad_input');
  const check = drafts.findIndex((d) => d.template.cross_source);
  const sameRoleDeliverer = drafts.find((d) => !d.template.cross_source && d.template.owner_role === drafts[check].template.owner_role);
  if (sameRoleDeliverer) {
    refused('the independent check cannot go to someone delivering the work',
      () => w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: rows().map((r, i) => (i === check ? { ...r, ownerUserId: sameRoleDeliverer.ownerUserId! } : r)) }), 'not_independent');
  } else console.log('       (this intervention has no delivery task of the checker\'s role; independence not exercised)');
  refused('a stale form is refused', () => w.assignTasks(beo, { caseId: CASE, caseVersion: v - 1, rows: rows() }), 'stale');
  ok('refused assignments wrote no tasks', (one<{ c: number }>('select count(*) c from tasks where plan_id = ?', planId)?.c ?? 0) === 0);
  ok('and are in the audit trail', failures('plan.assign_refused') >= 2, String(failures('plan.assign_refused')));

  // The officer changes one owner (where there is a choice) and one date, then assigns.
  const checkers = new Set(drafts.filter((d) => d.template.cross_source).map((d) => d.ownerUserId));
  const alt = (d: (typeof drafts)[number]) => d.options.find((o) => o.id !== d.ownerUserId && !checkers.has(o.id));
  const swapAt = drafts.findIndex((d) => !d.template.cross_source && alt(d));
  const later = addDays(drafts[0].dueDate, 3);
  const final = rows().map((r, i) => ({
    ...r,
    ...(i === swapAt ? { ownerUserId: alt(drafts[i])!.id } : {}),
    ...(i === 0 ? { dueDate: later } : {}),
  }));
  const notesBefore = Number(one<{ c: number }>(`select count(*) c from notifications where kind = 'assignment' and entity_type = 'task'`)?.c ?? 0);
  const { taskIds } = w.assignTasks(beo, { caseId: CASE, caseVersion: v, rows: final });
  ok(`${taskIds.length} tasks are created`, taskIds.length === drafts.length);
  const made = all<{ id: string; template_key: string; school_id: string | null; owner_user_id: string; due_date: string; original_due_date: string; status: string; cycle: number; cross_source: number }>(
    `select * from tasks where plan_id = ? order by id`, planId);
  ok('each is assigned, in the plan\'s cycle', made.every((t) => t.status === 'assigned' && t.cycle === 1));
  ok('each has the owner and date the officer settled on', made.every((t) => {
    const r = final.find((x) => x.rowKey === `${t.template_key}|${t.school_id ?? ''}`)!;
    return t.owner_user_id === r.ownerUserId && t.due_date === r.dueDate && t.original_due_date === r.dueDate;
  }));
  ok('exactly one independent check is among them', made.filter((t) => t.cross_source === 1).length === 1);
  ok('the case moves to "Work assigned"', caseRow().status === 'assigned');
  const notesAfter = Number(one<{ c: number }>(`select count(*) c from notifications where kind = 'assignment' and entity_type = 'task'`)?.c ?? 0);
  ok('every owner is notified of their task', notesAfter - notesBefore === taskIds.length, `${notesAfter - notesBefore}`);
  const assignedAudit = all<{ after: string }>(`select after from audit_events where action = 'task.assigned' and entity_id in (${taskIds.map(() => '?').join(',')})`, ...taskIds);
  ok('every task is in the audit trail', assignedAudit.length === taskIds.length);
  if (swapAt >= 0) ok('a changed owner records who was suggested', assignedAudit.some((a) => a.after.includes('suggested_owner_user_id')));
  ok('the case timeline says how many tasks went to how many people', cs.caseTimeline(beo, CASE).some((e) => e.kind === 'tasks_assigned'));
  refused('the same plan cannot be assigned twice', () => w.assignTasks(beo, { caseId: CASE, caseVersion: caseRow().version, rows: final }), 'wrong_status');
  const someHm = made.find((t) => t.school_id)?.owner_user_id;
  if (someHm) ok('a headmaster with a task can open the case', cs.getCase(loadSession(someHm)!, CASE) !== null);

  console.log('\n--- reassigning a task ---');
  // On the plan just assigned: one resource coordinator delivers, the other holds the check.
  const brcDelivery = made.find((t) => !t.cross_source && one<{ r: string }>('select owner_role r from tasks where id = ?', t.id)?.r === 'brc');
  const brcCheck = made.find((t) => t.cross_source === 1);
  const tv = (id: string) => one<{ version: number }>('select version from tasks where id = ?', id)!.version;
  if (brcDelivery && brcCheck) {
    refused('delivery work cannot go to the person holding the independent check',
      () => w.reassignTask(beo, { taskId: brcDelivery.id, newOwnerUserId: brcCheck.owner_user_id, reason: 'BRC on election duty', taskVersion: tv(brcDelivery.id) }), 'not_independent');
    refused('nor can the check go to the person delivering the work',
      () => w.reassignTask(beo, { taskId: brcCheck.id, newOwnerUserId: brcDelivery.owner_user_id, reason: 'BRC on election duty', taskVersion: tv(brcCheck.id) }), 'not_independent');
  }

  // A live seeded task: CASE-0070, Rampur Sadar, its cluster coordinator's delivery task.
  const rBeo = S('beo.blk-01@demo.karyavahi.test');
  const rDeo = S('deo.rmp@demo.karyavahi.test');
  const T = 'TSK-00895';
  const before = one<{ owner_user_id: string; status: string; version: number; plan_id: string }>('select owner_user_id, status, version, plan_id from tasks where id = ?', T)!;
  const rpc = plans.planCase(rBeo, 'CASE-0070')!;
  const otherCrc = plans.ownerOptions(rpc, 'crc', null).find((o) => o.id !== before.owner_user_id)!;
  const hmHere = one<{ user_id: string }>(`select user_id from user_roles where role = 'headmaster' and scope_id = 'SCH-00002'`)!.user_id;
  const base = { taskId: T, newOwnerUserId: otherCrc.id, reason: 'CRC on medical leave until the 20th', taskVersion: before.version };
  ok(`${T} is in progress with the cluster coordinator`, before.status === 'in_progress' && !!otherCrc);
  refused('the cluster coordinator cannot reassign their own task', () => w.reassignTask(loadSession(before.owner_user_id)!, base), 'role');
  refused('a resource coordinator cannot reassign it', () => w.reassignTask(S('brc1.blk-01@demo.karyavahi.test'), base), 'role');
  refused('a headmaster on the case cannot', () => w.reassignTask(loadSession(hmHere)!, base), 'role');
  refused("another block's officer cannot", () => w.reassignTask(otherBeo, base), 'scope');
  refused('a reason is required', () => w.reassignTask(rBeo, { ...base, reason: '' }), 'reason_required');
  refused('it cannot be "reassigned" to the same person', () => w.reassignTask(rBeo, { ...base, newOwnerUserId: before.owner_user_id }), 'same_owner');
  refused('a cluster task cannot go to a headmaster', () => w.reassignTask(rBeo, { ...base, newOwnerUserId: hmHere }), 'owner');
  refused('a stale form is refused', () => w.reassignTask(rBeo, { ...base, taskVersion: before.version - 1 }), 'stale');
  const doneTask = one<{ id: string; version: number }>(`select t.id, t.version from tasks t join cases c on c.id = t.case_id where c.block_id = 'BLK-01' and t.status = 'verified' limit 1`)!;
  refused('a verified task stays with whoever did it', () => w.reassignTask(rBeo, { ...base, taskId: doneTask.id, taskVersion: doneTask.version }), 'wrong_status');
  ok('refusals by the wrong role are in the audit trail',
    Number(one<{ c: number }>(`select count(*) c from audit_events where action = 'task.reassign_refused' and entity_id = ?`, T)?.c) >= 3);
  ok('nothing changed on the task', one<{ o: string }>('select owner_user_id o from tasks where id = ?', T)?.o === before.owner_user_id);

  const notes0 = Number(one<{ c: number }>(`select count(*) c from notifications where entity_id = ?`, T)?.c ?? 0);
  w.reassignTask(rBeo, base);
  const after = one<{ owner_user_id: string; status: string; acknowledged_at: string | null; reassigned_from: string; reassign_reason: string; version: number }>(
    'select owner_user_id, status, acknowledged_at, reassigned_from, reassign_reason, version from tasks where id = ?', T)!;
  ok('the block officer moves it to another cluster coordinator', after.owner_user_id === otherCrc.id);
  ok('the previous owner and the reason are kept on the task', after.reassigned_from === before.owner_user_id && after.reassign_reason === base.reason);
  ok('started work goes back to "assigned" for the new owner to acknowledge', after.status === 'assigned' && after.acknowledged_at === null);
  ok('the task is one version on', after.version === before.version + 1);
  ok('both the new and the previous owner are notified', Number(one<{ c: number }>(`select count(*) c from notifications where entity_id = ?`, T)?.c) - notes0 === 2);
  ok('it is in the audit trail with the reason', feed.auditFor(auditor, 'task', T).some((a) => a.action === 'task.reassigned' && a.reason === base.reason));
  ok('and on the case timeline', cs.caseTimeline(rBeo, 'CASE-0070').some((e) => e.kind === 'task_reassigned' && e.related_entity === T));
  ok('the new owner can open the task', cs.taskById(loadSession(otherCrc.id)!, T) !== null);
  w.reassignTask(rDeo, { ...base, newOwnerUserId: before.owner_user_id, reason: 'Back from leave early', taskVersion: after.version });
  ok('the district officer can move it back', one<{ o: string }>('select owner_user_id o from tasks where id = ?', T)?.o === before.owner_user_id);

  console.log('\n--- the audit chain still verifies ---');
  const chain = feed.verifyAuditChain(auditor);
  ok('links and contents hold', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
} catch (e) {
  fail++;
  console.log(`  FAIL the test crashed: ${(e as Error).stack}`);
} finally {
  const { db } = await import('../src/lib/db');
  try { db().close(); } catch { /* already closed */ }
  swap(BACKUP, LIVE);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
