import 'server-only';
import { all, one, j, bool, num, type Param } from './db';
import { and, casesPred, canSeeCase, findingsPred, tasksPred, evidencePred, type Pred } from './scope';
import type { Session } from './session';
import { independentOf } from './duty';
import { requiredRoleFor } from './guard';
import { isOverdue, today, addDays } from './clock';
import type {
  CaseStatus, Severity, Lever, OutcomeCategory, DqCheck, DriverSchool, FactorObservation,
  FactorCode, OutcomeSchoolRow, EvidenceType, TaskStatus, RoleCode,
} from '@domain/types';

// ---------------------------------------------------------------- row shapes
export interface CaseRow {
  id: string; title: string; origin: 'detected' | 'manual';
  finding_id: string | null; diagnosis_id: string | null;
  state_id: string; district_id: string; block_id: string; cluster_id: string;
  school_ids: string; grade: number; competency_id: string;
  severity: Severity; lever: Lever; status: CaseStatus;
  owner_user_id: string; current_plan_id: string | null;
  created_at: string; updated_at: string; due_date: string | null;
  verification_status: string; reopen_count: number;
  closure_type: OutcomeCategory | null; closed_at: string | null; pab_cycle: string | null;
}

export interface Case extends Omit<CaseRow, 'school_ids'> { school_ids: string[] }

export interface FindingRow {
  id: string; round_id: string; prev_round_id: string; district_id: string; block_id: string;
  cluster_id: string; grade: number; competency_id: string; metric_id: string;
  prev_value_pct: number; curr_value_pct: number; change_pp: number; district_change_pp: number;
  relative_change_pp: number; z_score: number; n_prev: number; n_curr: number;
  schools_reporting: number; schools_total: number; participation_rate: number;
  dq_checks: string; detection_method: string; thresholds: string; settings_version_id: string;
  status: string; case_id: string | null; driver_schools: string;
  measured_prev_window_end: string; measured_curr_window_end: string;
  detected_at: string; severity: Severity;
}

export interface Finding extends Omit<FindingRow, 'dq_checks' | 'driver_schools' | 'thresholds'> {
  dq_checks: DqCheck[];
  driver_schools: DriverSchool[];
  thresholds: { materiality_pp: number; z_threshold: number };
}

export interface Diagnosis {
  id: string; case_id: string; finding_id: string | null;
  observations: FactorObservation[];
  ranked_factors: { factor: FactorCode; label: string; schools_flagged: number; of_driver_schools: number; rank: number }[];
  ai_hypothesis: string; ai_hypothesis_model: string;
  human_conclusion: string | null; human_conclusion_by: string | null;
  created_at: string; method_note: string;
}

export interface CasePlan {
  id: string; case_id: string; cycle: number; version: number; intervention_id: string;
  alternatives: string[]; school_ids: string[]; rationale: string;
  drafted_by: 'ai_draft' | 'officer'; ai_model: string | null;
  pre_registration: {
    grade: number; competency_id: string; metric_id: string;
    baseline_round_id: string; followup_round_id: string; comparison_school_ids: string[];
    success_threshold_pp: number; participation_floor_ratio: number; settings_version_id: string;
  } | null;
  estimated_cost_inr: number; cost_is_illustrative: boolean;
  status: string; created_at: string; created_by: string;
}

export interface Approval {
  id: string; case_id: string; plan_id: string; required_role: RoleCode;
  submitted_by: string; submitted_at: string; decision: string;
  decided_by: string | null; decided_at: string | null; reason: string | null;
  original_plan: Record<string, unknown>; edited_plan: Record<string, unknown> | null;
  ai_drafted: boolean;
  /** The lever this plan was submitted under, which sets required_role (see requiredRoleFor).
   *  Not the case's lever today: that moves with each new plan and with a PAB referral. */
  lever: Lever | null;
}

export interface Task {
  id: string; case_id: string; plan_id: string; cycle: number; template_key: string;
  title_en: string; title_hi: string; school_id: string | null;
  owner_user_id: string; owner_role: RoleCode;
  proof_type: EvidenceType; proof_count: number; cross_source: boolean;
  status: TaskStatus; assigned_at: string; due_date: string; original_due_date: string;
  acknowledged_at: string | null; started_at: string | null; submitted_at: string | null;
  verified_at: string | null; reminder_sent_at: string | null; escalated_at: string | null;
  /** The day-after-due overdue nudge (added by the reminders migration in ext/schema.ts). */
  breach_nudged_at?: string | null;
  is_overdue: boolean; reassigned_from: string | null; reassign_reason: string | null;
  deadline_change_reason: string | null;
}

export interface Evidence {
  id: string; task_id: string; case_id: string; school_id: string | null;
  evidence_type: EvidenceType; file_name: string | null; sha256: string | null;
  visit_id: string | null; summary: Record<string, unknown>;
  submitted_by: string; submitted_role: RoleCode; submitted_at: string;
  gps_status: string; channel: string; status: 'pending' | 'verified' | 'rejected';
  verified_by: string | null; verified_at: string | null;
  verification_method: string | null; rejection_reason: string | null;
  /** The phone's fix and the server's distance to the school (proof-sync migration; null on older rows). */
  gps_distance_m?: number | null; gps_accuracy_m?: number | null;
}

export interface OutcomeEvaluation {
  id: string; case_id: string; plan_id: string; cycle: number; grade: number; competency_id: string;
  baseline_round_id: string; followup_round_id: string;
  treated: OutcomeSchoolRow[]; comparison: OutcomeSchoolRow[];
  treated_baseline_mean: number | null; treated_followup_mean: number | null;
  comparison_baseline_mean: number | null; comparison_followup_mean: number | null;
  treated_change_pp: number | null; comparison_change_pp: number | null;
  did_pp: number | null; ci_low_pp: number | null; ci_high_pp: number | null; ci_method: string;
  success_threshold_pp: number;
  participation_check: { treated_baseline: number | null; treated_followup: number | null; floor: number; passed: boolean };
  category: OutcomeCategory;
  delivery_verified: boolean; cross_source_verified: boolean; closure_eligible: boolean;
  closure_blockers: string[]; interpretation_note: string; is_illustrative: boolean;
  settings_version_id: string; evaluated_at: string;
  reviewed_by: string | null; reviewed_at: string | null;
}

export interface CaseEvent {
  id: string; case_id: string; ts: string; actor_user_id: string | null; actor_label: string;
  kind: string; summary: string; from_status: CaseStatus | null; to_status: CaseStatus | null;
  related_entity: string | null;
}

// ---------------------------------------------------------------- parsers
const toCase = (r: CaseRow): Case => ({ ...r, school_ids: j(r.school_ids, [] as string[]) });

const toFinding = (r: FindingRow): Finding => ({
  ...r,
  dq_checks: j(r.dq_checks, [] as DqCheck[]),
  driver_schools: j(r.driver_schools, [] as DriverSchool[]),
  thresholds: j(r.thresholds, { materiality_pp: 0, z_threshold: 0 }),
});

const toTask = (r: Record<string, unknown>): Task => ({
  ...(r as unknown as Task),
  cross_source: bool(r.cross_source),
  // Recomputed against the demo clock, not trusted from the seed column.
  is_overdue: isOverdue(r.due_date as string, r.submitted_at as string | null),
});

const toEvidence = (r: Record<string, unknown>): Evidence => ({
  ...(r as unknown as Evidence),
  summary: j(r.summary, {} as Record<string, unknown>),
});

const toPlan = (r: Record<string, unknown>): CasePlan => ({
  ...(r as unknown as CasePlan),
  alternatives: j(r.alternatives, [] as string[]),
  school_ids: j(r.school_ids, [] as string[]),
  pre_registration: j(r.pre_registration, null as CasePlan['pre_registration']),
  cost_is_illustrative: bool(r.cost_is_illustrative),
});

const toApproval = (r: Record<string, unknown>): Approval => ({
  ...(r as unknown as Approval),
  lever: (r.lever as Lever | null) ?? null,
  required_role: r.lever ? requiredRoleFor(r.lever as Lever) : (r.required_role as RoleCode),
  original_plan: j(r.original_plan, {} as Record<string, unknown>),
  edited_plan: j(r.edited_plan, null as Record<string, unknown> | null),
  ai_drafted: bool(r.ai_drafted),
});

const toOutcome = (r: Record<string, unknown>): OutcomeEvaluation => ({
  ...(r as unknown as OutcomeEvaluation),
  treated: j(r.treated, [] as OutcomeSchoolRow[]),
  comparison: j(r.comparison, [] as OutcomeSchoolRow[]),
  participation_check: j(r.participation_check, { treated_baseline: null, treated_followup: null, floor: 0, passed: false }),
  closure_blockers: j(r.closure_blockers, [] as string[]),
  delivery_verified: bool(r.delivery_verified),
  cross_source_verified: bool(r.cross_source_verified),
  closure_eligible: bool(r.closure_eligible),
  is_illustrative: bool(r.is_illustrative),
  did_pp: num(r.did_pp), ci_low_pp: num(r.ci_low_pp), ci_high_pp: num(r.ci_high_pp),
});

const toDiagnosis = (r: Record<string, unknown>): Diagnosis => ({
  ...(r as unknown as Diagnosis),
  observations: j(r.observations, [] as FactorObservation[]),
  ranked_factors: j(r.ranked_factors, [] as Diagnosis['ranked_factors']),
});

// ---------------------------------------------------------------- case reads
export interface CaseFilter {
  status?: CaseStatus[];
  open?: boolean;
  severity?: Severity[];
  lever?: Lever;
  blockId?: string;
  districtId?: string;
  clusterId?: string;
  ownerUserId?: string;
  competencyId?: string;
  grade?: number;
  q?: string;
  /** Cases with at least one task past its due date and not yet submitted. */
  overdue?: boolean;
  /** Cases reopened at least once. */
  reopened?: boolean;
  limit?: number;
  offset?: number;
  order?: 'severity' | 'recent' | 'due' | 'oldest';
}

const OPEN = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];

function caseFilterPred(s: Session, f: CaseFilter): Pred {
  const parts: Pred[] = [casesPred(s, 'c')];
  if (f.status?.length) parts.push({ sql: `c.status in (${f.status.map(() => '?').join(',')})`, params: [...f.status] });
  if (f.open) parts.push({ sql: `c.status in (${OPEN.map(() => '?').join(',')})`, params: [...OPEN] });
  if (f.severity?.length) parts.push({ sql: `c.severity in (${f.severity.map(() => '?').join(',')})`, params: [...f.severity] });
  if (f.lever) parts.push({ sql: 'c.lever = ?', params: [f.lever] });
  if (f.blockId) parts.push({ sql: 'c.block_id = ?', params: [f.blockId] });
  if (f.districtId) parts.push({ sql: 'c.district_id = ?', params: [f.districtId] });
  if (f.clusterId) parts.push({ sql: 'c.cluster_id = ?', params: [f.clusterId] });
  if (f.ownerUserId) parts.push({ sql: 'c.owner_user_id = ?', params: [f.ownerUserId] });
  if (f.competencyId) parts.push({ sql: 'c.competency_id = ?', params: [f.competencyId] });
  if (f.grade) parts.push({ sql: 'c.grade = ?', params: [f.grade] });
  if (f.q) parts.push({ sql: '(c.title like ? or c.id like ?)', params: [`%${f.q}%`, `%${f.q}%`] });
  if (f.overdue) parts.push({ sql: 'exists (select 1 from tasks ot where ot.case_id = c.id and ot.submitted_at is null and ot.due_date < ?)', params: [today()] });
  if (f.reopened) parts.push({ sql: 'c.reopen_count > 0', params: [] });
  return and(...parts);
}

const ORDER = {
  severity: `case c.severity when 'critical' then 1 when 'high' then 2 else 3 end, c.updated_at desc`,
  recent: 'c.updated_at desc',
  oldest: 'c.created_at asc',
  due: 'c.due_date is null, c.due_date asc',
};

export function listCases(s: Session, f: CaseFilter = {}): Case[] {
  const p = caseFilterPred(s, f);
  return all<CaseRow>(
    `select c.* from cases c where ${p.sql} order by ${ORDER[f.order ?? 'severity']} limit ? offset ?`,
    ...p.params, f.limit ?? 50, f.offset ?? 0,
  ).map(toCase);
}

export function countCases(s: Session, f: CaseFilter = {}): number {
  const p = caseFilterPred(s, f);
  return Number(one<{ c: number }>(`select count(*) c from cases c where ${p.sql}`, ...p.params)?.c ?? 0);
}

/** Case counts by status within the user's scope — the shape every dashboard needs. */
export function caseStatusCounts(s: Session, f: CaseFilter = {}): Record<string, number> {
  const p = caseFilterPred(s, f);
  const rows = all<{ status: string; c: number }>(
    `select c.status, count(*) c from cases c where ${p.sql} group by c.status`, ...p.params,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.c)]));
}

export function caseSeverityCounts(s: Session, f: CaseFilter = {}): Record<string, number> {
  const p = caseFilterPred(s, f);
  const rows = all<{ severity: string; c: number }>(
    `select c.severity, count(*) c from cases c where ${p.sql} group by c.severity`, ...p.params,
  );
  return Object.fromEntries(rows.map((r) => [r.severity, Number(r.c)]));
}

export function getCase(s: Session, id: string): Case | null {
  const p = casesPred(s, 'c');
  const r = one<CaseRow>(`select c.* from cases c where c.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toCase(r) : null;
}

/** True when the case exists but is out of scope — lets the UI say "outside your scope"
 *  instead of "not found", which is what the Postgres function does. */
export function caseExists(id: string): boolean {
  return one<{ c: number }>('select count(*) c from cases where id = ?', id)?.c === 1;
}

// ---------------------------------------------------------------- case parts
export function caseFinding(s: Session, caseId: string): Finding | null {
  const p = canSeeCase(s, 'f.case_id');
  const r = one<FindingRow>(
    `select f.* from findings f where f.case_id = ? and (${p.sql})`, caseId, ...p.params,
  );
  return r ? toFinding(r) : null;
}

export function findingById(s: Session, id: string): Finding | null {
  const p = findingsPred(s, 'f');
  const r = one<FindingRow>(`select f.* from findings f where f.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toFinding(r) : null;
}

export function caseDiagnosis(s: Session, caseId: string): Diagnosis | null {
  const p = canSeeCase(s, 'd.case_id');
  const r = one<Record<string, unknown>>(
    `select d.* from diagnoses d where d.case_id = ? and (${p.sql})`, caseId, ...p.params,
  );
  return r ? toDiagnosis(r) : null;
}

export function casePlans(s: Session, caseId: string): CasePlan[] {
  const p = canSeeCase(s, 'pl.case_id');
  return all<Record<string, unknown>>(
    `select pl.* from case_plans pl where pl.case_id = ? and (${p.sql}) order by pl.cycle, pl.version`,
    caseId, ...p.params,
  ).map(toPlan);
}

export function planById(s: Session, id: string): CasePlan | null {
  const p = canSeeCase(s, 'pl.case_id');
  const r = one<Record<string, unknown>>(`select pl.* from case_plans pl where pl.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toPlan(r) : null;
}

export function caseApprovals(s: Session, caseId: string): Approval[] {
  const p = canSeeCase(s, 'a.case_id');
  return all<Record<string, unknown>>(
    `select a.* from approvals a where a.case_id = ? and (${p.sql}) order by a.submitted_at`,
    caseId, ...p.params,
  ).map(toApproval);
}

export function caseTasks(s: Session, caseId: string): Task[] {
  const p = tasksPred(s, 't');
  return all<Record<string, unknown>>(
    `select t.* from tasks t where t.case_id = ? and (${p.sql}) order by t.cycle, t.due_date, t.id`,
    caseId, ...p.params,
  ).map(toTask);
}

export function taskById(s: Session, id: string): Task | null {
  const p = tasksPred(s, 't');
  const r = one<Record<string, unknown>>(`select t.* from tasks t where t.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toTask(r) : null;
}

export function caseEvidence(s: Session, caseId: string): Evidence[] {
  const p = evidencePred(s, 'e');
  return all<Record<string, unknown>>(
    `select e.* from evidence e where e.case_id = ? and (${p.sql}) order by e.submitted_at desc`,
    caseId, ...p.params,
  ).map(toEvidence);
}

export function taskEvidence(s: Session, taskId: string): Evidence[] {
  const p = evidencePred(s, 'e');
  return all<Record<string, unknown>>(
    `select e.* from evidence e where e.task_id = ? and (${p.sql}) order by e.submitted_at desc`,
    taskId, ...p.params,
  ).map(toEvidence);
}

export function evidenceById(s: Session, id: string): Evidence | null {
  const p = evidencePred(s, 'e');
  const r = one<Record<string, unknown>>(`select e.* from evidence e where e.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toEvidence(r) : null;
}

export function caseOutcomes(s: Session, caseId: string): OutcomeEvaluation[] {
  const p = canSeeCase(s, 'oe.case_id');
  return all<Record<string, unknown>>(
    `select oe.* from outcome_evaluations oe where oe.case_id = ? and (${p.sql}) order by oe.cycle desc, oe.evaluated_at desc`,
    caseId, ...p.params,
  ).map(toOutcome);
}

export function caseTimeline(s: Session, caseId: string): CaseEvent[] {
  const p = canSeeCase(s, 'ce.case_id');
  return all<CaseEvent>(
    `select ce.* from case_events ce where ce.case_id = ? and (${p.sql}) order by ce.ts desc, ce.id desc`,
    caseId, ...p.params,
  );
}

/** Everything the case page renders, in one place. */
export interface CaseBundle {
  case: Case;
  finding: Finding | null;
  diagnosis: Diagnosis | null;
  plans: CasePlan[];
  currentPlan: CasePlan | null;
  approvals: Approval[];
  tasks: Task[];
  evidence: Evidence[];
  outcomes: OutcomeEvaluation[];
  timeline: CaseEvent[];
}

export function caseBundle(s: Session, id: string): CaseBundle | null {
  const c = getCase(s, id);
  if (!c) return null;
  const plans = casePlans(s, id);
  return {
    case: c,
    finding: c.finding_id ? findingById(s, c.finding_id) : null,
    diagnosis: caseDiagnosis(s, id),
    plans,
    currentPlan: plans.find((p) => p.id === c.current_plan_id) ?? null,
    approvals: caseApprovals(s, id),
    tasks: caseTasks(s, id),
    evidence: caseEvidence(s, id),
    outcomes: caseOutcomes(s, id),
    timeline: caseTimeline(s, id),
  };
}

// ---------------------------------------------------------------- findings
export interface FindingFilter {
  status?: string[]; blockId?: string; districtId?: string; clusterId?: string;
  roundId?: string; severity?: Severity[]; limit?: number; order?: 'worst' | 'recent';
}

export function listFindings(s: Session, f: FindingFilter = {}): Finding[] {
  const parts: Pred[] = [findingsPred(s, 'f')];
  if (f.status?.length) parts.push({ sql: `f.status in (${f.status.map(() => '?').join(',')})`, params: [...f.status] });
  if (f.blockId) parts.push({ sql: 'f.block_id = ?', params: [f.blockId] });
  if (f.districtId) parts.push({ sql: 'f.district_id = ?', params: [f.districtId] });
  if (f.clusterId) parts.push({ sql: 'f.cluster_id = ?', params: [f.clusterId] });
  if (f.roundId) parts.push({ sql: 'f.round_id = ?', params: [f.roundId] });
  if (f.severity?.length) parts.push({ sql: `f.severity in (${f.severity.map(() => '?').join(',')})`, params: [...f.severity] });
  const p = and(...parts);
  const order = f.order === 'recent' ? 'f.detected_at desc' : 'f.relative_change_pp asc';
  return all<FindingRow>(
    `select f.* from findings f where ${p.sql} order by ${order} limit ?`, ...p.params, f.limit ?? 100,
  ).map(toFinding);
}

export function findingStatusCounts(s: Session, f: FindingFilter = {}): Record<string, number> {
  const parts: Pred[] = [findingsPred(s, 'f')];
  if (f.blockId) parts.push({ sql: 'f.block_id = ?', params: [f.blockId] });
  if (f.districtId) parts.push({ sql: 'f.district_id = ?', params: [f.districtId] });
  if (f.roundId) parts.push({ sql: 'f.round_id = ?', params: [f.roundId] });
  const p = and(...parts);
  const rows = all<{ status: string; c: number }>(
    `select f.status, count(*) c from findings f where ${p.sql} group by f.status`, ...p.params,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.c)]));
}

// ---------------------------------------------------------------- task & evidence queues
export interface TaskFilter {
  ownerUserId?: string; caseId?: string; status?: TaskStatus[]; overdue?: boolean;
  dueWithinDays?: number; escalated?: boolean; blockId?: string; districtId?: string;
  awaitingVerification?: boolean; limit?: number;
}

export function listTasks(s: Session, f: TaskFilter = {}): Task[] {
  const parts: Pred[] = [tasksPred(s, 't')];
  if (f.ownerUserId) parts.push({ sql: 't.owner_user_id = ?', params: [f.ownerUserId] });
  if (f.caseId) parts.push({ sql: 't.case_id = ?', params: [f.caseId] });
  if (f.status?.length) parts.push({ sql: `t.status in (${f.status.map(() => '?').join(',')})`, params: [...f.status] });
  if (f.escalated) parts.push({ sql: 't.escalated_at is not null', params: [] });
  if (f.overdue) parts.push({ sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  if (f.dueWithinDays !== undefined) {
    parts.push({ sql: 't.submitted_at is null and t.due_date >= ? and t.due_date <= ?', params: [today(), addDays(today(), f.dueWithinDays)] });
  }
  if (f.awaitingVerification) parts.push({ sql: `t.status = 'submitted' and t.verified_at is null`, params: [] });
  if (f.blockId) parts.push({ sql: 'exists (select 1 from cases cb where cb.id = t.case_id and cb.block_id = ?)', params: [f.blockId] });
  if (f.districtId) parts.push({ sql: 'exists (select 1 from cases cd where cd.id = t.case_id and cd.district_id = ?)', params: [f.districtId] });
  const p = and(...parts);
  return all<Record<string, unknown>>(
    `select t.* from tasks t where ${p.sql} order by t.due_date, t.id limit ?`, ...p.params, f.limit ?? 100,
  ).map(toTask);
}

export function countTasks(s: Session, f: TaskFilter = {}): number {
  const parts: Pred[] = [tasksPred(s, 't')];
  if (f.ownerUserId) parts.push({ sql: 't.owner_user_id = ?', params: [f.ownerUserId] });
  if (f.status?.length) parts.push({ sql: `t.status in (${f.status.map(() => '?').join(',')})`, params: [...f.status] });
  if (f.escalated) parts.push({ sql: 't.escalated_at is not null', params: [] });
  if (f.overdue) parts.push({ sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  if (f.awaitingVerification) parts.push({ sql: `t.status = 'submitted' and t.verified_at is null`, params: [] });
  if (f.blockId) parts.push({ sql: 'exists (select 1 from cases cb where cb.id = t.case_id and cb.block_id = ?)', params: [f.blockId] });
  if (f.districtId) parts.push({ sql: 'exists (select 1 from cases cd where cd.id = t.case_id and cd.district_id = ?)', params: [f.districtId] });
  const p = and(...parts);
  return Number(one<{ c: number }>(`select count(*) c from tasks t where ${p.sql}`, ...p.params)?.c ?? 0);
}

/** Proof waiting on this user, excluding anything they took part in (submitted, own the task,
 *  held it before, or handed in other proof for it) — the separation-of-duties rule that
 *  verifyEvidence() enforces (duty.ts). */
export function evidenceToCheck(s: Session, opts: { blockId?: string; districtId?: string; limit?: number } = {}): Evidence[] {
  const parts: Pred[] = [
    evidencePred(s, 'e'),
    { sql: `e.status = 'pending'`, params: [] },
    independentOf(s.user_id, 'e'),
  ];
  if (opts.blockId) parts.push({ sql: 'exists (select 1 from cases cb where cb.id = e.case_id and cb.block_id = ?)', params: [opts.blockId] });
  if (opts.districtId) parts.push({ sql: 'exists (select 1 from cases cd where cd.id = e.case_id and cd.district_id = ?)', params: [opts.districtId] });
  const p = and(...parts);
  return all<Record<string, unknown>>(
    `select e.* from evidence e where ${p.sql} order by e.submitted_at limit ?`, ...p.params, opts.limit ?? 100,
  ).map(toEvidence);
}

export function countEvidenceToCheck(s: Session, opts: { blockId?: string; districtId?: string } = {}): number {
  const parts: Pred[] = [
    evidencePred(s, 'e'),
    { sql: `e.status = 'pending'`, params: [] },
    independentOf(s.user_id, 'e'),
  ];
  if (opts.blockId) parts.push({ sql: 'exists (select 1 from cases cb where cb.id = e.case_id and cb.block_id = ?)', params: [opts.blockId] });
  if (opts.districtId) parts.push({ sql: 'exists (select 1 from cases cd where cd.id = e.case_id and cd.district_id = ?)', params: [opts.districtId] });
  const p = and(...parts);
  return Number(one<{ c: number }>(`select count(*) c from evidence e where ${p.sql}`, ...p.params)?.c ?? 0);
}

/** Cases sitting at awaiting_approval that this user is empowered to decide. A plan the user
 *  submitted is someone else's to approve, so it is not waiting on them. */
export function approvalQueue(s: Session, opts: { limit?: number } = {}): { case: Case; plan: CasePlan | null; approval: Approval | null }[] {
  const levers: Lever[] = [];
  const roles = s.roles.map((r) => r.role);
  if (roles.includes('beo') || roles.includes('deo')) levers.push('block');
  if (roles.includes('deo') || roles.includes('state_admin')) levers.push('district', 'pab');
  if (levers.length === 0) return [];

  const p = and(
    casesPred(s, 'c'),
    { sql: `c.status = 'awaiting_approval'`, params: [] },
    { sql: `c.lever in (${levers.map(() => '?').join(',')})`, params: levers as Param[] },
    {
      sql: `not exists (select 1 from approvals a where a.case_id = c.id and a.decision = 'pending' and a.submitted_by = ?)`,
      params: [s.user_id],
    },
  );
  const cases = all<CaseRow>(
    `select c.* from cases c where ${p.sql}
      order by case c.severity when 'critical' then 1 when 'high' then 2 else 3 end, c.updated_at
      limit ?`,
    ...p.params, opts.limit ?? 50,
  ).map(toCase);

  return cases.map((c) => ({
    case: c,
    plan: c.current_plan_id ? planById(s, c.current_plan_id) : null,
    approval: caseApprovals(s, c.id).find((a) => a.decision === 'pending') ?? null,
  }));
}

/** Outcome evaluations that nobody has reviewed yet, inside scope. */
export function outcomesToReview(s: Session, opts: { limit?: number } = {}): { outcome: OutcomeEvaluation; case: Case | null }[] {
  const p = and(canSeeCase(s, 'oe.case_id'), { sql: 'oe.reviewed_by is null', params: [] });
  const rows = all<Record<string, unknown>>(
    `select oe.* from outcome_evaluations oe where ${p.sql} order by oe.evaluated_at desc limit ?`,
    ...p.params, opts.limit ?? 25,
  ).map(toOutcome);
  return rows.map((o) => ({ outcome: o, case: getCase(s, o.case_id) }));
}
