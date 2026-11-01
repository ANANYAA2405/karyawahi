import 'server-only';
import { all, one, j, bool, type Param } from './db';
import { learningRows } from './learning-cache';
import { and, schoolsPred, canSeeSchool, canSeeCase, staffEventsPred, type Pred } from './scope';
import type { Session } from './session';
import type {
  AssessmentRound, Competency, Intervention, MetricDefinition, SettingVersion, Dataset,
} from '@domain/types';

/** Reference data, geography and people. Reference tables are readable by any signed-in user
 *  (the `read_ref` policies); anything school-shaped goes through a scope predicate. */

// ---------------------------------------------------------------- reference
export const competencies = (): Competency[] =>
  all<Competency>('select * from competencies order by domain desc, code');

export const competency = (id: string): Competency | null =>
  one<Competency>('select * from competencies where id = ?', id);

export const metrics = (): MetricDefinition[] =>
  all<Record<string, unknown>>('select * from metric_definitions order by id').map((r) => ({
    ...r, higher_is_better: bool(r.higher_is_better),
  })) as MetricDefinition[];

export const rounds = (): AssessmentRound[] =>
  all<AssessmentRound>('select * from assessment_rounds order by window_start');

export const round = (id: string): AssessmentRound | null =>
  one<AssessmentRound>('select * from assessment_rounds where id = ?', id);

export function settingVersions(): SettingVersion[] {
  return all<Record<string, unknown>>('select * from setting_versions order by version').map((r) => ({
    ...r,
    detection: j(r.detection, {} as SettingVersion['detection']),
    outcome: j(r.outcome, {} as SettingVersion['outcome']),
    reminders: j(r.reminders, {} as SettingVersion['reminders']),
    diagnosis: j(r.diagnosis, {} as SettingVersion['diagnosis']),
    closure_rules: j(r.closure_rules, [] as string[]),
  })) as unknown as SettingVersion[];
}

export const settingVersion = (id: string): SettingVersion | null =>
  settingVersions().find((s) => s.id === id) ?? null;

export function interventions(): Intervention[] {
  return all<Record<string, unknown>>('select * from interventions order by id').map(parseIntervention);
}

export function intervention(id: string): Intervention | null {
  const r = one<Record<string, unknown>>('select * from interventions where id = ?', id);
  return r ? parseIntervention(r) : null;
}

function parseIntervention(r: Record<string, unknown>): Intervention {
  return {
    ...r,
    domains: j(r.domains, [] as Intervention['domains']),
    grades: j(r.grades, [] as number[]),
    competency_ids: j(r.competency_ids, [] as string[]),
    steps: j(r.steps, [] as string[]),
    resources: j(r.resources, [] as string[]),
    cost_basis: j(r.cost_basis, {} as Intervention['cost_basis']),
    evidence: j(r.evidence, {} as Intervention['evidence']),
    delivery_conditions: j(r.delivery_conditions, [] as string[]),
    limitations: j(r.limitations, [] as string[]),
    required_evidence: j(r.required_evidence, [] as string[]),
    task_templates: j(r.task_templates, [] as Intervention['task_templates']),
  } as unknown as Intervention;
}

export const datasets = (): Dataset[] => all<Dataset>('select * from datasets order by id');

// ---------------------------------------------------------------- geography
export interface GeoRow { id: string; name: string; code?: string }

export const stateRow = (): GeoRow | null => one<GeoRow>('select id, name from states limit 1');
export const districts = (): GeoRow[] => all<GeoRow>('select id, name, code from districts order by name');
export const district = (id: string): GeoRow | null => one<GeoRow>('select id, name, code from districts where id = ?', id);
export const blocks = (districtId?: string): GeoRow[] =>
  districtId
    ? all<GeoRow>('select id, name, code from blocks where district_id = ? order by name', districtId)
    : all<GeoRow>('select id, name, code from blocks order by name');
export const block = (id: string): (GeoRow & { district_id: string }) | null =>
  one('select id, name, code, district_id from blocks where id = ?', id);
export const clusters = (blockId?: string): GeoRow[] =>
  blockId
    ? all<GeoRow>('select id, name from clusters where block_id = ? order by name', blockId)
    : all<GeoRow>('select id, name from clusters order by name');
export const cluster = (id: string): (GeoRow & { block_id: string; district_id: string }) | null =>
  one('select id, name, block_id, district_id from clusters where id = ?', id);

/** Human-readable place name for any scope id, for headers and breadcrumbs. */
export function scopeName(scopeType: string, scopeId: string): string {
  const table = { state: 'states', district: 'districts', block: 'blocks', cluster: 'clusters', school: 'schools' }[scopeType];
  if (!table) return scopeId;
  return one<{ name: string }>(`select name from "${table}" where id = ?`, scopeId)?.name ?? scopeId;
}

/** id → name maps, for rendering lists without N+1 lookups. */
export function placeNames(): {
  districts: Map<string, string>; blocks: Map<string, string>; clusters: Map<string, string>;
} {
  return {
    districts: new Map(all<GeoRow>('select id, name from districts').map((r) => [r.id, r.name])),
    blocks: new Map(all<GeoRow>('select id, name from blocks').map((r) => [r.id, r.name])),
    clusters: new Map(all<GeoRow>('select id, name from clusters').map((r) => [r.id, r.name])),
  };
}

export function schoolNames(ids: readonly string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const q = ids.map(() => '?').join(',');
  return new Map(
    all<GeoRow>(`select id, name from schools where id in (${q})`, ...(ids as string[])).map((r) => [r.id, r.name]),
  );
}

// ---------------------------------------------------------------- schools
export interface SchoolRow {
  id: string; name: string; village: string; category: string; grades_served: string;
  state_id: string; district_id: string; block_id: string; cluster_id: string;
  enrolment_total: number; enrolment_g1: number; enrolment_g2: number; enrolment_g3: number;
  teachers_sanctioned: number; teachers_in_position: number; ptr: number;
  provenance: string; source_ref: string; created_at: string;
}

export function school(s: Session, id: string): SchoolRow | null {
  const p = schoolsPred(s, 'sch');
  return one<SchoolRow>(`select sch.* from schools sch where sch.id = ? and (${p.sql})`, id, ...p.params);
}

export function schoolsIn(
  s: Session,
  opts: { clusterId?: string; blockId?: string; districtId?: string; ids?: string[]; limit?: number; q?: string } = {},
): SchoolRow[] {
  const parts: Pred[] = [schoolsPred(s, 'sch')];
  if (opts.clusterId) parts.push({ sql: 'sch.cluster_id = ?', params: [opts.clusterId] });
  if (opts.blockId) parts.push({ sql: 'sch.block_id = ?', params: [opts.blockId] });
  if (opts.districtId) parts.push({ sql: 'sch.district_id = ?', params: [opts.districtId] });
  if (opts.ids && opts.ids.length > 0) {
    parts.push({ sql: `sch.id in (${opts.ids.map(() => '?').join(',')})`, params: [...opts.ids] });
  }
  if (opts.q) parts.push({ sql: '(sch.name like ? or sch.village like ? or sch.id like ?)', params: [`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`] });
  const p = and(...parts);
  return all<SchoolRow>(
    `select sch.* from schools sch where ${p.sql} order by sch.name limit ?`,
    ...p.params, opts.limit ?? 200,
  );
}

export function schoolCount(s: Session, opts: { clusterId?: string; blockId?: string; districtId?: string } = {}): number {
  const parts: Pred[] = [schoolsPred(s, 'sch')];
  if (opts.clusterId) parts.push({ sql: 'sch.cluster_id = ?', params: [opts.clusterId] });
  if (opts.blockId) parts.push({ sql: 'sch.block_id = ?', params: [opts.blockId] });
  if (opts.districtId) parts.push({ sql: 'sch.district_id = ?', params: [opts.districtId] });
  const p = and(...parts);
  return Number(one<{ c: number }>(`select count(*) c from schools sch where ${p.sql}`, ...p.params)?.c ?? 0);
}

// ---------------------------------------------------------------- school context reads
export interface AssessmentRow {
  id: string; round_id: string; school_id: string; grade: number; competency_id: string;
  enrolled: number; n_assessed: number; n_proficient: number; pct_proficient: number;
  participation_rate: number; dq_flags: string;
}

export function schoolAssessments(s: Session, schoolId: string): AssessmentRow[] {
  const p = canSeeSchool(s, 'ar.school_id');
  return all<AssessmentRow>(
    `select ar.* from assessment_results ar
      where ar.school_id = ? and (${p.sql})
      order by ar.round_id, ar.grade, ar.competency_id`,
    schoolId, ...p.params,
  );
}

export interface AttendanceRow { id: string; school_id: string; month: string; working_days: number; avg_attendance_pct: number }

export function schoolAttendance(s: Session, schoolId: string, limit = 24): AttendanceRow[] {
  const p = canSeeSchool(s, 'am.school_id');
  return all<AttendanceRow>(
    `select am.* from attendance_monthly am where am.school_id = ? and (${p.sql})
      order by am.month desc limit ?`,
    schoolId, ...p.params, limit,
  );
}

export interface StaffEventRow { id: string; school_id: string; event_type: string; event_date: string; teacher_ref: string }

export function schoolStaffEvents(s: Session, schoolId: string): StaffEventRow[] {
  const p = staffEventsPred(s, 'se');
  if (p.sql === '1=0') return [];
  return all<StaffEventRow>(
    `select se.* from staff_events se where se.school_id = ? and (${p.sql}) order by se.event_date desc`,
    schoolId, ...p.params,
  );
}

export interface VisitRow {
  id: string; school_id: string; visitor_user_id: string; visitor_role: string; visit_date: string;
  purpose: string; case_id: string | null; task_id: string | null; checklist: string; notes: string;
  gps_status: string; sync_status: string; logged_at: string;
}

export function schoolVisits(s: Session, schoolId: string, limit = 30): VisitRow[] {
  const p = canSeeSchool(s, 'v.school_id');
  return all<VisitRow>(
    `select v.* from visits v where v.school_id = ? and (${p.sql}) order by v.visit_date desc limit ?`,
    schoolId, ...p.params, limit,
  );
}

export function visitsBy(s: Session, userId: string, limit = 50): VisitRow[] {
  const p = canSeeSchool(s, 'v.school_id');
  return all<VisitRow>(
    `select v.* from visits v where v.visitor_user_id = ? and (${p.sql}) order by v.visit_date desc limit ?`,
    userId, ...p.params, limit,
  );
}

export function caseVisits(s: Session, caseId: string): VisitRow[] {
  const p = canSeeSchool(s, 'v.school_id');
  return all<VisitRow>(
    `select v.* from visits v where v.case_id = ? and (${p.sql}) order by v.visit_date desc`,
    caseId, ...p.params,
  );
}

// ---------------------------------------------------------------- people
export interface UserRow {
  id: string; full_name: string; email: string; preferred_language: string;
  preferred_channel: string; is_demo_account: number; status: string;
}

export const user = (id: string): UserRow | null =>
  one<UserRow>('select * from users where id = ?', id);

export function userNames(ids: readonly string[]): Map<string, string> {
  const live = [...new Set(ids.filter(Boolean))];
  if (live.length === 0) return new Map();
  const q = live.map(() => '?').join(',');
  return new Map(
    all<{ id: string; full_name: string }>(`select id, full_name from users where id in (${q})`, ...live)
      .map((r) => [r.id, r.full_name]),
  );
}

export interface UserWithRole extends UserRow { role: string; scope_type: string; scope_id: string }

export const demoAccounts = (): UserWithRole[] =>
  all<UserWithRole>(
    `select u.*, ur.role, ur.scope_type, ur.scope_id
       from users u join user_roles ur on ur.user_id = u.id
      where u.is_demo_account = 1 and u.status = 'active'
      order by case ur.role
        when 'demo_admin' then 1 when 'state_admin' then 2 when 'auditor' then 3
        when 'deo' then 4 when 'beo' then 5 when 'brc' then 6 when 'crc' then 7 else 8 end, u.id`,
  );

export function usersByRole(role: string, scopeId?: string, limit = 50): UserWithRole[] {
  const params: Param[] = [role];
  let extra = '';
  if (scopeId) { extra = ' and ur.scope_id = ?'; params.push(scopeId); }
  return all<UserWithRole>(
    `select u.*, ur.role, ur.scope_type, ur.scope_id from users u
       join user_roles ur on ur.user_id = u.id
      where ur.role = ?${extra} and u.status = 'active' order by u.full_name limit ?`,
    ...params, limit,
  );
}

export const roleOf = (userId: string): string | null =>
  one<{ role: string }>('select role from user_roles where user_id = ? limit 1', userId)?.role ?? null;

// ---------------------------------------------------------------- trends
export interface TrendPoint {
  round_id: string;
  code: string;
  label: string;
  window_end: string;
  cluster_pct: number | null;
  district_pct: number | null;
  cluster_n: number;
  district_n: number;
}

/**
 * Cluster against district, round by round, for one grade and competency.
 *
 * Aggregated the same way the detector aggregates (students, not schools: sum proficient over
 * sum assessed), so the chart and the finding cannot tell different stories. The district
 * series is what makes a cluster's drop meaningful — a fall everywhere is a different problem
 * from a fall in one cluster.
 */
export function clusterTrend(
  s: Session, clusterId: string, districtId: string, grade: number, competencyId: string,
): TrendPoint[] {
  const p = canSeeSchool(s, 'ar.school_id');
  const rows = learningRows<{
    round_id: string; scope: string; assessed: number; proficient: number;
  }>(
    `select ar.round_id,
            case when sc.cluster_id = ? then 'cluster' else 'district' end as scope,
            sum(ar.n_assessed) as assessed, sum(ar.n_proficient) as proficient
       from assessment_results ar
       join schools sc on sc.id = ar.school_id
      where sc.district_id = ? and ar.grade = ? and ar.competency_id = ? and ar.n_assessed > 0
        and (${p.sql})
      group by ar.round_id, scope`,
    clusterId, districtId, grade, competencyId, ...p.params,
  );

  return rounds()
    .filter((r) => r.status === 'completed')
    .map((r) => {
      const cl = rows.find((x) => x.round_id === r.id && x.scope === 'cluster');
      // The district series includes the cluster, as the detector's district figure does.
      const other = rows.find((x) => x.round_id === r.id && x.scope === 'district');
      const dAssessed = (cl?.assessed ?? 0) + (other?.assessed ?? 0);
      const dProf = (cl?.proficient ?? 0) + (other?.proficient ?? 0);
      return {
        round_id: r.id,
        code: r.code,
        label: r.label,
        window_end: r.window_end,
        cluster_pct: cl && cl.assessed > 0 ? Math.round((cl.proficient / cl.assessed) * 1000) / 10 : null,
        district_pct: dAssessed > 0 ? Math.round((dProf / dAssessed) * 1000) / 10 : null,
        cluster_n: cl?.assessed ?? 0,
        district_n: dAssessed,
      };
    });
}

/** One school's trajectory for a grade and competency, for the school profile and driver lists. */
export function schoolTrend(
  s: Session, schoolId: string, grade: number, competencyId: string,
): { round_id: string; code: string; pct: number | null; n: number }[] {
  const p = canSeeSchool(s, 'ar.school_id');
  const rows = all<{ round_id: string; pct_proficient: number; n_assessed: number }>(
    `select ar.round_id, ar.pct_proficient, ar.n_assessed from assessment_results ar
      where ar.school_id = ? and ar.grade = ? and ar.competency_id = ? and (${p.sql})`,
    schoolId, grade, competencyId, ...p.params,
  );
  return rounds()
    .filter((r) => r.status === 'completed')
    .map((r) => {
      const hit = rows.find((x) => x.round_id === r.id);
      return { round_id: r.id, code: r.code, pct: hit ? hit.pct_proficient : null, n: hit?.n_assessed ?? 0 };
    });
}

/** Block-level progress by competency for the latest completed round — the dashboard heatstrip. */
export function blockCompetencySnapshot(
  s: Session, opts: { blockId?: string; districtId?: string },
): { competency_id: string; grade: number; pct: number | null; prev_pct: number | null; n: number }[] {
  const p = canSeeSchool(s, 'ar.school_id');
  const completed = rounds().filter((r) => r.status === 'completed');
  const curr = completed[completed.length - 1];
  const prev = completed[completed.length - 2];
  if (!curr) return [];

  const where: string[] = [];
  const params: Param[] = [];
  if (opts.blockId) { where.push('sc.block_id = ?'); params.push(opts.blockId); }
  if (opts.districtId) { where.push('sc.district_id = ?'); params.push(opts.districtId); }
  const scopeSql = where.length > 0 ? `and ${where.join(' and ')}` : '';

  const rows = learningRows<{ round_id: string; competency_id: string; grade: number; assessed: number; proficient: number }>(
    `select ar.round_id, ar.competency_id, ar.grade,
            sum(ar.n_assessed) assessed, sum(ar.n_proficient) proficient
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ar.round_id in (?, ?) and ar.n_assessed > 0 ${scopeSql} and (${p.sql})
      group by ar.round_id, ar.competency_id, ar.grade`,
    curr.id, prev?.id ?? curr.id, ...params, ...p.params,
  );

  const out: { competency_id: string; grade: number; pct: number | null; prev_pct: number | null; n: number }[] = [];
  for (const c of competencies()) {
    for (const g of [1, 2, 3]) {
      const a = rows.find((r) => r.round_id === curr.id && r.competency_id === c.id && r.grade === g);
      const b = prev ? rows.find((r) => r.round_id === prev.id && r.competency_id === c.id && r.grade === g) : undefined;
      out.push({
        competency_id: c.id,
        grade: g,
        pct: a && a.assessed > 0 ? Math.round((a.proficient / a.assessed) * 1000) / 10 : null,
        prev_pct: b && b.assessed > 0 ? Math.round((b.proficient / b.assessed) * 1000) / 10 : null,
        n: a?.assessed ?? 0,
      });
    }
  }
  return out;
}

/** The plan a task belongs to, for showing the intervention's steps on the task page. */
export function casePlanForTask(s: Session, planId: string): { id: string; intervention_id: string } | null {
  const p = canSeeCase(s, 'pl_case.id');
  return one<{ id: string; intervention_id: string }>(
    `select pl.id, pl.intervention_id from case_plans pl
       join cases pl_case on pl_case.id = pl.case_id
      where pl.id = ? and (${p.sql})`,
    planId, ...p.params,
  );
}
