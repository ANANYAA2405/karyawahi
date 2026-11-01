import 'server-only';
import { all, one, j } from './db';
import type { Session } from './session';
import { moveRefusal, may, roleCovers } from './guard';
import { competency, intervention } from './repo';
import { matchForCase, feasibility, type InterventionMatch } from './studio';
import { today, addDays } from './clock';
import { ROUNDS, settingsAt } from '@domain/catalog';
import { casesPred } from './scope';
import type { CaseStatus, Lever, RoleCode, TaskTemplate } from '@domain/types';

/**
 * The Plan Composer and the task generator, read side.
 *
 * Everything an officer sees before committing comes from here, and write.ts calls the same
 * functions when it saves, so what the preview shows is what gets stored: the same comparison
 * schools, the same threshold, the same list of tasks and default owners.
 *
 * Nothing here predicts an effect. The comparison schools are chosen by a fixed rule (closest
 * baseline result and size, in the same district but another cluster, not already in another
 * open case), and the threshold comes from the settings in force on the day.
 */

/** The statuses in which a case can be given a new plan: before a first submission, after it
 *  was sent back, and after a reopening. */
export const COMPOSABLE: readonly CaseStatus[] = ['under_investigation', 'revision_requested', 'reopened'];

export interface PlanCase {
  id: string; title: string; status: CaseStatus; lever: Lever; version: number;
  state_id: string; district_id: string; block_id: string; cluster_id: string;
  school_ids: string; grade: number; competency_id: string;
  finding_id: string | null; current_plan_id: string | null;
}

/** The case as the composer needs it, or null when it is out of the user's scope. */
export function planCase(s: Session, caseId: string): PlanCase | null {
  const p = casesPred(s, 'c');
  return one<PlanCase>(
    `select c.id, c.title, c.status, c.lever, c.version, c.state_id, c.district_id, c.block_id, c.cluster_id,
            c.school_ids, c.grade, c.competency_id, c.finding_id, c.current_plan_id
       from cases c where c.id = ? and (${p.sql})`, caseId, ...p.params,
  ) ?? null;
}

/** Whether this user may compose a plan for the case, and in plain words why not. The rule is
 *  the one for submitting a plan, because a draft only exists to be submitted. */
export function composeRefusal(s: Session, c: PlanCase): { code: string; message: string } | null {
  if (!COMPOSABLE.includes(c.status)) {
    return { code: 'wrong_status', message: `A plan can be composed while a case is being looked into, sent back or reopened; this one is "${c.status.replace(/_/g, ' ')}".` };
  }
  return moveRefusal(s, c, 'awaiting_approval', null);
}

// ------------------------------------------------------------------ schools
export interface CandidateSchool { id: string; name: string; change_pp: number | null; share: number | null; driver: boolean }

/**
 * The schools a plan may cover: the finding's driver schools, largest share of the drop first,
 * then any other school already on the case. This order is also the order comparison schools
 * are matched in, so it is fixed rather than left to the order a form happens to post.
 */
export function candidateSchools(c: PlanCase): CandidateSchool[] {
  const drivers = c.finding_id
    ? j<{ school_id: string; change_pp: number; contribution_share: number }[]>(
      one<{ d: string }>('select driver_schools d from findings where id = ?', c.finding_id)?.d, [],
    )
    : [];
  drivers.sort((a, b) => b.contribution_share - a.contribution_share || a.school_id.localeCompare(b.school_id));
  const ids = [...new Set([...drivers.map((d) => d.school_id), ...j<string[]>(c.school_ids, [])])];
  if (ids.length === 0) return [];
  const names = new Map(all<{ id: string; name: string }>(
    `select id, name from schools where id in (${ids.map(() => '?').join(',')})`, ...ids,
  ).map((r) => [r.id, r.name]));
  return ids.map((id) => {
    const d = drivers.find((x) => x.school_id === id);
    return { id, name: names.get(id) ?? id, change_pp: d?.change_pp ?? null, share: d?.contribution_share ?? null, driver: !!d };
  });
}

/** The chosen schools, deduplicated and in the candidates' order; unknown ids are returned
 *  separately so the caller can refuse them by name. */
export function orderSchools(c: PlanCase, schoolIds: readonly string[]): { ordered: string[]; unknown: string[] } {
  const order = candidateSchools(c).map((x) => x.id);
  const want = new Set(schoolIds);
  return { ordered: order.filter((id) => want.has(id)), unknown: [...want].filter((id) => !order.includes(id)) };
}

// ------------------------------------------------------------------ pre-registration
export type PreRegistration = NonNullable<import('./cases').CasePlan['pre_registration']>;

/** The round the case's finding was measured on, and the next one, which the outcome check
 *  will read. A case without a finding is measured from the latest completed round. */
export function roundsFor(c: PlanCase): { baseline: string; followup: string | null } {
  const found = c.finding_id ? one<{ round_id: string }>('select round_id from findings where id = ?', c.finding_id)?.round_id : null;
  const baseline = found ?? [...ROUNDS].reverse().find((r) => r.status === 'completed')!.id;
  const i = ROUNDS.findIndex((r) => r.id === baseline);
  return { baseline, followup: ROUNDS[i + 1]?.id ?? null };
}

/**
 * What the outcome check will be held to. For each plan school, in order, the closest schools on
 * the baseline result (and, more lightly, on the number enrolled), from the same district but a
 * different cluster, that are not already in another open case or chosen for an earlier school.
 * This is the rule the seed used for every historical plan.
 */
export function preRegistrationFor(c: PlanCase, schoolIds: readonly string[], on = today()): PreRegistration | null {
  const { baseline, followup } = roundsFor(c);
  if (!followup) return null;
  const st = settingsAt(on);
  const metric = 'MET-PCT-PROF';
  const result = (id: string) => one<{ pct: number; enrolled: number }>(
    `select pct_proficient pct, enrolled from assessment_results
      where round_id = ? and school_id = ? and grade = ? and competency_id = ? and metric_id = ?`,
    baseline, id, c.grade, c.competency_id, metric,
  );
  const busy = new Set(all<{ school_ids: string }>(
    `select school_ids from cases where id <> ? and status not in ('closed','dismissed','referred_pab')`, c.id,
  ).flatMap((r) => j<string[]>(r.school_ids, [])));
  const pool = all<{ id: string; pct: number; enrolled: number }>(
    `select s.id, r.pct_proficient pct, r.enrolled
       from schools s join assessment_results r on r.school_id = s.id
      where s.district_id = ? and s.cluster_id <> ? and r.round_id = ? and r.grade = ? and r.competency_id = ? and r.metric_id = ?`,
    c.district_id, c.cluster_id, baseline, c.grade, c.competency_id, metric,
  ).filter((p) => !busy.has(p.id) && !schoolIds.includes(p.id));

  const taken = new Set<string>();
  const comparison: string[] = [];
  for (const sid of schoolIds) {
    const t = result(sid);
    if (!t) continue;
    const dist = (p: { pct: number; enrolled: number }) => Math.abs(p.pct - t.pct) + 0.2 * Math.abs(p.enrolled - t.enrolled);
    const picks = pool.filter((p) => !taken.has(p.id))
      .sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id))
      .slice(0, st.outcome.comparison_schools_per_treated);
    for (const p of picks) { taken.add(p.id); comparison.push(p.id); }
  }
  return {
    grade: c.grade, competency_id: c.competency_id, metric_id: metric,
    baseline_round_id: baseline, followup_round_id: followup,
    comparison_school_ids: comparison,
    success_threshold_pp: st.outcome.success_threshold_pp,
    participation_floor_ratio: st.outcome.participation_floor_ratio,
    settings_version_id: st.id,
  };
}

// ------------------------------------------------------------------ the composer
export interface ComposerView {
  case: PlanCase;
  refusal: { code: string; message: string } | null;
  matches: InterventionMatch[];
  schools: CandidateSchool[];
  /** What the current plan already says, used as the starting point. */
  current: { intervention_id: string; school_ids: string[]; drafted_by: string; status: string } | null;
}

export function composerView(s: Session, caseId: string): ComposerView | null {
  const c = planCase(s, caseId);
  if (!c) return null;
  const match = matchForCase(s, caseId);
  const cur = c.current_plan_id
    ? one<{ intervention_id: string; school_ids: string; drafted_by: string; status: string }>(
      'select intervention_id, school_ids, drafted_by, status from case_plans where id = ?', c.current_plan_id,
    )
    : null;
  return {
    case: c,
    refusal: composeRefusal(s, c),
    matches: match?.matches ?? [],
    schools: candidateSchools(c),
    current: cur ? { ...cur, school_ids: j<string[]>(cur.school_ids, []) } : null,
  };
}

export interface PlanPreview {
  interventionId: string;
  schoolIds: string[];
  preRegistration: PreRegistration | null;
  estimatedCost: number;
  alternatives: string[];
  tasks: { template: TaskTemplate; count: number }[];
}

/**
 * What a per-child, per-teacher or per-school cost is multiplied by: the plan schools' enrolment
 * in the case's class, their teachers in position and how many teach Classes 1–8. With the
 * real-data layer on these are the UDISE+ figures.
 */
export function planCounts(schoolIds: readonly string[], grade: number): { children: number; teachers: number; compositeSchools: number } {
  if (!schoolIds.length) return { children: 0, teachers: 0, compositeSchools: 0 };
  const col = grade === 1 ? 'enrolment_g1' : grade === 2 ? 'enrolment_g2' : 'enrolment_g3';
  const r = one<{ children: number; teachers: number; composite: number }>(
    `select coalesce(sum(${col}), 0) children, coalesce(sum(teachers_in_position), 0) teachers,
            coalesce(sum(case when category = 'primary' then 0 else 1 end), 0) composite
       from schools where id in (${schoolIds.map(() => '?').join(',')})`, ...schoolIds,
  );
  return { children: Number(r?.children ?? 0), teachers: Number(r?.teachers ?? 0), compositeSchools: Number(r?.composite ?? 0) };
}

/** Everything the plan will say once saved. Null when the intervention is unknown. */
export function previewPlan(c: PlanCase, matches: InterventionMatch[], interventionId: string, schoolIds: readonly string[]): PlanPreview | null {
  const iv = intervention(interventionId);
  if (!iv) return null;
  const { ordered } = orderSchools(c, schoolIds);
  const counts = planCounts(ordered, c.grade);
  const { totalCost } = feasibility(iv, {
    schools: ordered.length, budgetInr: null, teachersAvailable: null, weeksAvailable: null,
    attendancePct: null, trainingComplete: false, connectivity: false, ...counts,
  });
  return {
    interventionId,
    schoolIds: ordered,
    preRegistration: preRegistrationFor(c, ordered),
    estimatedCost: totalCost ?? 0,
    alternatives: matches.filter((m) => m.eligible && m.intervention.id !== interventionId).slice(0, 2).map((m) => m.intervention.id),
    tasks: iv.task_templates.map((t) => ({ template: t, count: t.per_school ? ordered.length : 1 })),
  };
}

// ------------------------------------------------------------------ the task generator
export interface OwnerOption { id: string; name: string; note: string }

export interface TaskDraft {
  /** `${template key}|${school id or empty}`, the row's identity in the assignment form. */
  rowKey: string;
  template: TaskTemplate;
  schoolId: string | null;
  schoolName: string | null;
  title_en: string;
  title_hi: string;
  options: OwnerOption[];
  ownerUserId: string | null;
  dueDate: string;
}


/**
 * Who can hold a task of this role on this case. The headmaster of the school; the case's
 * cluster coordinator first, then the block's other coordinators who can cover; the block's
 * resource coordinators, least loaded first; the district officer. Each comes from user_roles,
 * so a person is offered only for the area their role actually covers.
 */
export function ownerOptions(c: PlanCase, role: RoleCode, schoolId: string | null): OwnerOption[] {
  // Each person's open tasks (not yet verified) come back with them, in the same query.
  const holders = (sql: string, ...params: string[]) => all<{ id: string; full_name: string; scope_id: string; open: number }>(
    `select u.id, u.full_name, ur.scope_id,
            (select count(*) from tasks t where t.owner_user_id = u.id and t.verified_at is null) open
       from user_roles ur join users u on u.id = ur.user_id
      where ur.role = ? and u.status = 'active' and ${sql} order by u.id`, role, ...params,
  );
  const load = new Map<string, number>();
  const withLoad = (rows: { id: string; full_name: string; scope_id: string; open: number }[], note: (r: { scope_id: string }) => string) =>
    rows.map((r) => { load.set(r.id, Number(r.open)); return { id: r.id, name: r.full_name, note: `${note(r)} · ${Number(r.open)} open` }; });

  switch (role) {
    case 'headmaster':
      return schoolId ? withLoad(holders(`ur.scope_type = 'school' and ur.scope_id = ?`, schoolId), () => 'headmaster of this school') : [];
    case 'crc': {
      const rows = holders(`ur.scope_type = 'cluster' and ur.scope_id in (select id from clusters where block_id = ?)`, c.block_id);
      rows.sort((a, b) => Number(b.scope_id === c.cluster_id) - Number(a.scope_id === c.cluster_id) || a.id.localeCompare(b.id));
      return withLoad(rows, (r) => (r.scope_id === c.cluster_id ? "this case's cluster" : `covering from ${r.scope_id}`));
    }
    case 'brc': {
      const opts = withLoad(holders(`ur.scope_type = 'block' and ur.scope_id = ?`, c.block_id), () => 'this block');
      return opts.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
    }
    case 'beo':
      return withLoad(holders(`ur.scope_type = 'block' and ur.scope_id = ?`, c.block_id), () => 'this block');
    case 'deo':
      return withLoad(holders(`ur.scope_type = 'district' and ur.scope_id = ?`, c.district_id), () => 'this district');
    default:
      return [];
  }
}

/** A task template's title with the case's class and competency written in. */
export function fillTemplate(c: Pick<PlanCase, 'grade' | 'competency_id'>, text: string): string {
  const comp = competency(c.competency_id);
  return text.replaceAll('{g}', String(c.grade))
    .replaceAll('{comp_hi}', comp?.name_hi ?? c.competency_id)
    .replaceAll('{comp}', (comp?.name_en ?? c.competency_id).toLowerCase());
}

/** The tasks an approved plan turns into, with default owners and due dates. The spot-check
 *  that independently verifies the work comes last, as it did in every seeded plan. */
export function taskDrafts(c: PlanCase, planId: string, on = today()): TaskDraft[] {
  const plan = one<{ intervention_id: string; school_ids: string }>(
    'select intervention_id, school_ids from case_plans where id = ? and case_id = ?', planId, c.id,
  );
  const iv = plan ? intervention(plan.intervention_id) : null;
  if (!plan || !iv) return [];
  const schools = j<string[]>(plan.school_ids, []);
  const names = schools.length
    ? new Map(all<{ id: string; name: string }>(`select id, name from schools where id in (${schools.map(() => '?').join(',')})`, ...schools).map((r) => [r.id, r.name]))
    : new Map<string, string>();
  const fill = (t: string) => fillTemplate(c, t);

  const templates = [...iv.task_templates].sort((a, b) => Number(a.cross_source) - Number(b.cross_source));
  // The independent check has to go to someone who is not delivering the work, so its default
  // skips anyone already suggested for a delivery task (templates are sorted with checks last).
  const deliverers = new Set<string>();
  return templates.flatMap((t) => (t.per_school ? schools : [null]).map((schoolId): TaskDraft => {
    const options = ownerOptions(c, t.owner_role, schoolId);
    const owner = t.cross_source
      ? (options.find((o) => !deliverers.has(o.id)) ?? options[0])?.id ?? null
      : options[0]?.id ?? null;
    if (!t.cross_source && owner) deliverers.add(owner);
    return {
      rowKey: `${t.key}|${schoolId ?? ''}`,
      template: t, schoolId, schoolName: schoolId ? names.get(schoolId) ?? schoolId : null,
      title_en: fill(t.title_en), title_hi: fill(t.title_hi),
      options, ownerUserId: owner,
      dueDate: addDays(on, t.duration_days),
    };
  }));
}

/** Whether this user may turn the approved plan into tasks, and why not otherwise. */
export function assignRefusal(s: Session, c: PlanCase): { code: string; message: string } | null {
  if (c.status !== 'approved') {
    return { code: 'wrong_status', message: `Tasks are assigned once the plan is approved; this case is "${c.status.replace(/_/g, ' ')}".` };
  }
  const r = moveRefusal(s, c, 'assigned', null);
  if (r) return r;
  if (!may(s, 'task.assign')) return { code: 'role', message: 'Your role cannot assign tasks.' };
  return null;
}

// ------------------------------------------------------------------ reassignment
/** Task states in which the work can still move to someone else. Once proof is in, or checked,
 *  the task stays with the person who did it. */
export const REASSIGNABLE = ['assigned', 'acknowledged', 'in_progress', 'sent_back'] as const;

/**
 * Whether giving this task to this person would break the independent check: the check's owner
 * must not deliver any of the plan's work, and nobody delivering the work may hold the check.
 */
export function breaksIndependence(planId: string, taskId: string, crossSource: boolean, userId: string): boolean {
  return (one<{ c: number }>(
    `select count(*) c from tasks where plan_id = ? and id <> ? and owner_user_id = ? and cross_source = ?`,
    planId, taskId, userId, crossSource ? 0 : 1,
  )?.c ?? 0) > 0;
}

export interface ReassignTask {
  id: string; case_id: string; plan_id: string; school_id: string | null; owner_user_id: string;
  owner_role: RoleCode; cross_source: number; status: string; version: number;
}

/** Whether this user may reassign the task: a block or district officer whose role covers the
 *  case, while the task has no proof waiting or accepted. */
export function reassignRefusal(s: Session, c: PlanCase, t: ReassignTask): { code: string; message: string } | null {
  const officer = s.roles.filter((r) => r.role === 'beo' || r.role === 'deo');
  if (officer.length === 0 || !may(s, 'task.assign')) {
    return { code: 'role', message: 'Only the block or district officer can give a task to someone else.' };
  }
  if (!officer.some((r) => roleCovers(r, c))) {
    return { code: 'area', message: "Your role does not cover this case's area." };
  }
  if (!(REASSIGNABLE as readonly string[]).includes(t.status)) {
    return {
      code: 'wrong_status',
      message: t.status === 'verified'
        ? 'This task is done and verified, so it stays with the person who did it.'
        : 'Proof for this task is waiting to be checked. Decide on it first; then the task can move if it is sent back.',
    };
  }
  return null;
}

/** Everything the task page needs to offer reassignment, or null when the task is out of scope. */
export function reassignView(s: Session, taskId: string): { task: ReassignTask; refusal: { code: string; message: string } | null; options: (OwnerOption & { blocked: string | null })[] } | null {
  const t = one<ReassignTask>(
    `select t.id, t.case_id, t.plan_id, t.school_id, t.owner_user_id, t.owner_role, t.cross_source, t.status, t.version
       from tasks t where t.id = ?`, taskId,
  );
  const c = t ? planCase(s, t.case_id) : null;
  if (!t || !c) return null;
  const options = ownerOptions(c, t.owner_role, t.school_id)
    .filter((o) => o.id !== t.owner_user_id)
    .map((o) => ({
      ...o,
      blocked: breaksIndependence(t.plan_id, t.id, !!t.cross_source, o.id)
        ? (t.cross_source ? 'delivers work on this plan' : 'holds the independent check')
        : null,
    }));
  return { task: t, refusal: reassignRefusal(s, c, t), options };
}
