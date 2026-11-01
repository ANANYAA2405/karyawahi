import 'server-only';
import { all, one, j, bool, num } from '../db';
import { and, casesPred, canSeeCase, tasksPred, schoolsPred, type Pred } from '../scope';
import type { Session } from '../session';
import { ROLE_PRECEDENCE } from '../session';
import { caseFinding, caseDiagnosis, casePlans, caseTasks, caseOutcomes, caseStatusCounts, caseSeverityCounts } from '../cases';
import { headline, outcomeMix, timeToClose } from '../dash';
import { hotspotUnits, canSeeUnit, comparableRounds, RULES, type Level, type HotspotUnit } from '../hotspots';
import { STAGES, stageIndex } from '../case-stage';
import { today, isOverdue } from '../clock';
import { CASE_STATUSES, OPEN_STATUSES } from '@domain/lifecycle';
import type { CaseStatus, OutcomeCategory, Severity, TaskStatus, OutcomeSchoolRow } from '@domain/types';
import {
  badRequest, notFound, listParam, idParam, boolParam, limitParam, dateParam, encodeCursor, decodeCursor,
  type ApiContext,
} from './http';

/**
 * What the API returns, endpoint by endpoint. Every query starts from the predicates in
 * scope.ts (casesPred, canSeeCase, tasksPred, schoolsPred) or from the read functions in
 * cases.ts / dash.ts / hotspots.ts that are built on them, called with the key's read-only
 * session — there is no second, API-only notion of who sees what.
 *
 * Deliberately left out, everywhere: people. No names, user ids, phone numbers or email
 * addresses — owners appear as a role (BEO, CRC, headmaster). No free text a person typed:
 * case discussion, plan rationale, diagnosis hypotheses and conclusions, reasons given for
 * moves, reassignments and deadline changes, proof notes, visit notes. No complaints at all.
 * A manual case's title is written by an officer, so the API gives a generated title instead.
 * A dashboard rolls the ledger up by area and stage; it has no use for any of that, and an API
 * key reaches a wider audience than the officers who see it in the app.
 */

const CASE_ID = /^CASE-\d{3,6}$/;
const BLOCK_ID = /^BLK-\d{2,3}$/;
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium'];
const TASK_STATUSES: readonly TaskStatus[] = ['assigned', 'acknowledged', 'in_progress', 'submitted', 'verified', 'sent_back', 'cancelled'];
const CATEGORIES: readonly OutcomeCategory[] = ['improved_confirmed', 'improved_indicative', 'below_target', 'no_change', 'worsened', 'inconclusive'];
const OPEN_TASK = ['assigned', 'acknowledged', 'in_progress', 'sent_back'];

const inList = (vals: readonly string[]) => vals.map(() => '?').join(',');

/** The owner's strongest role, by the same precedence as session.ts, as a SQL expression. */
const OWNER_ROLE_SQL = (userCol: string) => `(select ur.role from user_roles ur where ur.user_id = ${userCol}
  order by case ur.role ${ROLE_PRECEDENCE.map((r, i) => `when '${r}' then ${i}`).join(' ')} else 99 end limit 1)`;

let compCache: Map<string, { en: string; hi: string }> | null = null;
const competency = (id: string) => {
  compCache ??= new Map(all<{ id: string; name_en: string; name_hi: string }>('select id, name_en, name_hi from competencies').map((r) => [r.id, { en: r.name_en, hi: r.name_hi }]));
  return compCache.get(id) ?? null;
};

let roundCache: Map<string, { id: string; code: string; label: string }> | null = null;
const round = (id: string | null) => {
  if (!id) return null;
  roundCache ??= new Map(all<{ id: string; code: string; label: string }>('select id, code, label from assessment_rounds').map((r) => [r.id, r]));
  return roundCache.get(id) ?? { id, code: null, label: null };
};

function page<T>(rows: T[], limit: number, cursorOf: (r: T) => [string, string], total: number) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    page: { limit, returned: data.length, total, next_cursor: more && last ? encodeCursor(...cursorOf(last)) : null },
  };
}

// ------------------------------------------------------------------ cases

interface CaseApiRow {
  id: string; title: string; origin: string; status: CaseStatus; severity: Severity; lever: string;
  grade: number; competency_id: string; state_id: string; district_id: string; block_id: string; cluster_id: string;
  school_ids: string; due_date: string | null; created_at: string; updated_at: string; closed_at: string | null;
  closure_type: string | null; reopen_count: number; verification_status: string; pab_cycle: string | null;
  owner_role: string | null; current_plan_id: string | null;
}

function taskCountsFor(s: Session, caseIds: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (caseIds.length === 0) return out;
  const p = and(tasksPred(s, 't'), { sql: `t.case_id in (${inList(caseIds)})`, params: caseIds });
  const rows = all<{ case_id: string; total: number; open: number; overdue: number; submitted: number; verified: number; sent_back: number; escalated: number }>(
    `select t.case_id,
            count(*) total,
            sum(case when t.status in (${inList(OPEN_TASK)}) then 1 else 0 end) open,
            sum(case when t.submitted_at is null and t.due_date < ? then 1 else 0 end) overdue,
            sum(case when t.status = 'submitted' then 1 else 0 end) submitted,
            sum(case when t.status = 'verified' then 1 else 0 end) verified,
            sum(case when t.status = 'sent_back' then 1 else 0 end) sent_back,
            sum(case when t.escalated_at is not null and t.submitted_at is null then 1 else 0 end) escalated
       from tasks t where ${p.sql} group by t.case_id`,
    ...OPEN_TASK, today(), ...p.params,
  );
  for (const r of rows) {
    out.set(r.case_id, {
      total: Number(r.total), open: Number(r.open), overdue: Number(r.overdue), submitted: Number(r.submitted),
      verified: Number(r.verified), sent_back: Number(r.sent_back), escalated: Number(r.escalated),
    });
  }
  return out;
}

const EMPTY_COUNTS = { total: 0, open: 0, overdue: 0, submitted: 0, verified: 0, sent_back: 0, escalated: 0 };

function caseOut(r: CaseApiRow, counts: Record<string, number> | undefined) {
  const comp = competency(r.competency_id);
  const schools = j<string[]>(r.school_ids, []);
  return {
    id: r.id,
    // A detected case's title is generated by the detector; a manual case's was typed by an
    // officer, so the API writes its own from the structured fields instead.
    title: r.origin === 'detected' ? r.title : `Field concern: Class ${r.grade} ${comp?.en.toLowerCase() ?? r.competency_id}`,
    origin: r.origin,
    status: r.status,
    stage: STAGES[stageIndex(r.status)].key,
    is_open: OPEN_STATUSES.includes(r.status),
    severity: r.severity,
    lever: r.lever,
    grade: r.grade,
    competency: { id: r.competency_id, name_en: comp?.en ?? null, name_hi: comp?.hi ?? null },
    area: { state_id: r.state_id, district_id: r.district_id, block_id: r.block_id, cluster_id: r.cluster_id },
    school_ids: schools,
    owner_role: r.owner_role,
    due_date: r.due_date,
    created_at: r.created_at,
    updated_at: r.updated_at,
    closed_at: r.closed_at,
    closure_type: r.closure_type,
    reopen_count: Number(r.reopen_count),
    verification_status: r.verification_status,
    pab_cycle: r.pab_cycle,
    task_counts: counts ?? EMPTY_COUNTS,
  };
}

const CASE_COLS = `c.id, c.title, c.origin, c.status, c.severity, c.lever, c.grade, c.competency_id, c.state_id, c.district_id,
  c.block_id, c.cluster_id, c.school_ids, c.due_date, c.created_at, c.updated_at, c.closed_at, c.closure_type,
  c.reopen_count, c.verification_status, c.pab_cycle, c.current_plan_id, ${OWNER_ROLE_SQL('c.owner_user_id')} owner_role`;

/** GET /cases — oldest change first, so a client can sync with updated_since and the cursor. */
export function listCasesApi({ session: s, url }: ApiContext) {
  const status = listParam(url, 'status', CASE_STATUSES);
  const severity = listParam(url, 'severity', SEVERITIES);
  const block = idParam(url, 'block', BLOCK_ID);
  const updatedSince = dateParam(url, 'updated_since');
  const open = boolParam(url, 'open');
  const limit = limitParam(url);
  const cursor = decodeCursor(url);

  const parts: Pred[] = [casesPred(s, 'c')];
  if (status) parts.push({ sql: `c.status in (${inList(status)})`, params: status });
  if (severity) parts.push({ sql: `c.severity in (${inList(severity)})`, params: severity });
  if (block) parts.push({ sql: 'c.block_id = ?', params: [block] });
  if (updatedSince) parts.push({ sql: 'c.updated_at >= ?', params: [updatedSince] });
  if (open !== undefined) parts.push({ sql: `c.status ${open ? '' : 'not '}in (${inList(OPEN_STATUSES)})`, params: [...OPEN_STATUSES] });
  const filter = and(...parts);
  const total = Number(one<{ c: number }>(`select count(*) c from cases c where ${filter.sql}`, ...filter.params)?.c ?? 0);

  const p = cursor ? and(filter, { sql: '(c.updated_at > ? or (c.updated_at = ? and c.id > ?))', params: [cursor.sort, cursor.sort, cursor.id] }) : filter;
  const rows = all<CaseApiRow>(
    `select ${CASE_COLS} from cases c where ${p.sql} order by c.updated_at asc, c.id asc limit ?`, ...p.params, limit + 1,
  );
  const counts = taskCountsFor(s, rows.slice(0, limit).map((r) => r.id));
  return page(rows.map((r) => caseOut(r, counts.get(r.id))), limit, (r) => [r.updated_at, r.id], total);
}

/** GET /cases/{id} — 404 when it does not exist and when it is outside the key's area alike. */
export function getCaseApi({ session: s, params }: ApiContext) {
  const id = params.id ?? '';
  if (!CASE_ID.test(id)) throw notFound('case');
  // casesPred is the same predicate getCase() uses: a case in another area is simply not found.
  const p = casesPred(s, 'c');
  const row = one<CaseApiRow>(`select ${CASE_COLS} from cases c where c.id = ? and (${p.sql})`, id, ...p.params);
  if (!row) throw notFound('case');

  const f = caseFinding(s, id);
  const d = caseDiagnosis(s, id);
  const plans = casePlans(s, id);
  const current = plans.find((pl) => pl.id === row.current_plan_id) ?? null;
  const tasks = caseTasks(s, id);
  const outcomes = caseOutcomes(s, id);
  const intervention = current
    ? one<{ name: string; category: string; duration_weeks: number }>('select name, category, duration_weeks from interventions where id = ?', current.intervention_id)
    : null;

  const counts = taskCountsFor(s, [id]).get(id) ?? EMPTY_COUNTS;
  return {
    data: {
      ...caseOut(row, counts),
      finding: f ? {
        id: f.id,
        rounds: { previous: round(f.prev_round_id), current: round(f.round_id) },
        metric_id: f.metric_id,
        previous_pct: f.prev_value_pct,
        current_pct: f.curr_value_pct,
        change_pp: f.change_pp,
        district_change_pp: f.district_change_pp,
        relative_change_pp: f.relative_change_pp,
        z_score: f.z_score,
        students_assessed: { previous: f.n_prev, current: f.n_curr },
        schools_reporting: f.schools_reporting,
        schools_total: f.schools_total,
        participation_rate: f.participation_rate,
        detection_method: f.detection_method,
        detected_at: f.detected_at,
        driver_schools: f.driver_schools.map((ds) => ({
          school_id: ds.school_id, previous_pct: ds.prev_pct, current_pct: ds.curr_pct,
          change_pp: ds.change_pp, contribution_share: ds.contribution_share,
        })),
      } : null,
      // Factor codes and counts only: the hypothesis and the officer's conclusion are prose.
      diagnosis: d ? {
        ranked_factors: d.ranked_factors.map((r) => ({ factor: r.factor, rank: r.rank, schools_flagged: r.schools_flagged, of_driver_schools: r.of_driver_schools })),
        concluded: d.human_conclusion !== null,
      } : null,
      plan: current ? {
        id: current.id,
        cycle: current.cycle,
        version: current.version,
        status: current.status,
        drafted_by: current.drafted_by,
        intervention: { id: current.intervention_id, name: intervention?.name ?? null, category: intervention?.category ?? null, duration_weeks: intervention?.duration_weeks ?? null },
        school_count: current.school_ids.length,
        estimated_cost_inr: current.estimated_cost_inr,
        cost_is_illustrative: current.cost_is_illustrative,
        pre_registration: current.pre_registration ? {
          baseline_round: round(current.pre_registration.baseline_round_id),
          followup_round: round(current.pre_registration.followup_round_id),
          success_threshold_pp: current.pre_registration.success_threshold_pp,
          comparison_school_count: current.pre_registration.comparison_school_ids.length,
        } : null,
        created_at: current.created_at,
      } : null,
      plan_cycles: plans.length ? Math.max(...plans.map((pl) => pl.cycle)) : 0,
      task_due_dates: {
        next_due: tasks.filter((t) => !t.submitted_at && t.status !== 'cancelled').map((t) => t.due_date).sort()[0] ?? null,
        overdue_since: tasks.filter((t) => t.is_overdue).map((t) => t.due_date).sort()[0] ?? null,
      },
      latest_outcome: outcomes[0] ? outcomeOut(outcomeRowFrom(outcomes[0])) : null,
      outcome_checks: outcomes.length,
    },
  };
}

// ------------------------------------------------------------------ tasks

interface TaskApiRow {
  id: string; case_id: string; plan_id: string; cycle: number; template_key: string; title_en: string; title_hi: string;
  school_id: string | null; owner_role: string; proof_type: string; proof_count: number; status: TaskStatus;
  assigned_at: string; due_date: string; original_due_date: string; acknowledged_at: string | null;
  started_at: string | null; submitted_at: string | null; verified_at: string | null; escalated_at: string | null;
}

/** GET /tasks — by due date. Owners are roles, never people (see the note at the top). */
export function listTasksApi({ session: s, url }: ApiContext) {
  const caseId = idParam(url, 'case', CASE_ID);
  const status = listParam(url, 'status', TASK_STATUSES);
  const block = idParam(url, 'block', BLOCK_ID);
  const overdue = boolParam(url, 'overdue');
  const limit = limitParam(url);
  const cursor = decodeCursor(url);

  const parts: Pred[] = [tasksPred(s, 't')];
  if (caseId) parts.push({ sql: 't.case_id = ?', params: [caseId] });
  if (status) parts.push({ sql: `t.status in (${inList(status)})`, params: status });
  if (block) parts.push({ sql: 'exists (select 1 from cases cb where cb.id = t.case_id and cb.block_id = ?)', params: [block] });
  if (overdue === true) parts.push({ sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  if (overdue === false) parts.push({ sql: 'not (t.submitted_at is null and t.due_date < ?)', params: [today()] });
  const filter = and(...parts);
  const total = Number(one<{ c: number }>(`select count(*) c from tasks t where ${filter.sql}`, ...filter.params)?.c ?? 0);
  const p = cursor ? and(filter, { sql: '(t.due_date > ? or (t.due_date = ? and t.id > ?))', params: [cursor.sort, cursor.sort, cursor.id] }) : filter;
  const rows = all<TaskApiRow>(
    `select t.id, t.case_id, t.plan_id, t.cycle, t.template_key, t.title_en, t.title_hi, t.school_id, t.owner_role,
            t.proof_type, t.proof_count, t.status, t.assigned_at, t.due_date, t.original_due_date, t.acknowledged_at,
            t.started_at, t.submitted_at, t.verified_at, t.escalated_at
       from tasks t where ${p.sql} order by t.due_date asc, t.id asc limit ?`,
    ...p.params, limit + 1,
  );
  const out = rows.map((t) => ({
    id: t.id, case_id: t.case_id, plan_id: t.plan_id, cycle: t.cycle,
    template_key: t.template_key, title_en: t.title_en, title_hi: t.title_hi,
    school_id: t.school_id, owner_role: t.owner_role,
    proof: { type: t.proof_type, count: Number(t.proof_count) },
    status: t.status,
    // Against the demo clock, the same rule the app uses (clock.ts isOverdue).
    is_overdue: isOverdue(t.due_date, t.submitted_at),
    due_date: t.due_date, original_due_date: t.original_due_date, deadline_moved: t.due_date !== t.original_due_date,
    assigned_at: t.assigned_at, acknowledged_at: t.acknowledged_at, started_at: t.started_at,
    submitted_at: t.submitted_at, verified_at: t.verified_at, escalated_at: t.escalated_at,
  }));
  return page(out, limit, (r) => [r.due_date, r.id], total);
}

// ------------------------------------------------------------------ outcomes

interface OutcomeApiRow {
  id: string; case_id: string; plan_id: string; cycle: number; grade: number; competency_id: string;
  baseline_round_id: string; followup_round_id: string; treated: string; comparison: string;
  treated_baseline_mean: number | null; treated_followup_mean: number | null;
  comparison_baseline_mean: number | null; comparison_followup_mean: number | null;
  treated_change_pp: number | null; comparison_change_pp: number | null;
  did_pp: number | null; ci_low_pp: number | null; ci_high_pp: number | null; ci_method: string;
  success_threshold_pp: number; participation_check: string; category: OutcomeCategory;
  delivery_verified: number; cross_source_verified: number; closure_eligible: number; is_illustrative: number;
  evaluated_at: string; reviewed_at: string | null;
}

function outcomeRowFrom(o: ReturnType<typeof caseOutcomes>[number]): OutcomeApiRow {
  return {
    ...o,
    treated: JSON.stringify(o.treated), comparison: JSON.stringify(o.comparison),
    participation_check: JSON.stringify(o.participation_check),
    delivery_verified: o.delivery_verified ? 1 : 0, cross_source_verified: o.cross_source_verified ? 1 : 0,
    closure_eligible: o.closure_eligible ? 1 : 0, is_illustrative: o.is_illustrative ? 1 : 0,
  } as OutcomeApiRow;
}

function outcomeOut(o: OutcomeApiRow) {
  const comp = competency(o.competency_id);
  return {
    id: o.id, case_id: o.case_id, plan_id: o.plan_id, cycle: o.cycle,
    grade: o.grade, competency: { id: o.competency_id, name_en: comp?.en ?? null, name_hi: comp?.hi ?? null },
    rounds: { baseline: round(o.baseline_round_id), followup: round(o.followup_round_id) },
    treated: { school_count: j<OutcomeSchoolRow[]>(o.treated, []).length, baseline_mean_pct: num(o.treated_baseline_mean), followup_mean_pct: num(o.treated_followup_mean), change_pp: num(o.treated_change_pp) },
    comparison: { school_count: j<OutcomeSchoolRow[]>(o.comparison, []).length, baseline_mean_pct: num(o.comparison_baseline_mean), followup_mean_pct: num(o.comparison_followup_mean), change_pp: num(o.comparison_change_pp) },
    did_pp: num(o.did_pp),
    interval: { low_pp: num(o.ci_low_pp), high_pp: num(o.ci_high_pp), method: o.ci_method },
    success_threshold_pp: num(o.success_threshold_pp),
    participation_check: j(o.participation_check, null as unknown),
    category: o.category,
    delivery_verified: bool(o.delivery_verified),
    cross_source_verified: bool(o.cross_source_verified),
    closure_eligible: bool(o.closure_eligible),
    is_illustrative: bool(o.is_illustrative),
    evaluated_at: o.evaluated_at,
    reviewed: o.reviewed_at !== null,
  };
}

/** GET /outcomes — every outcome check (difference-in-differences) in the area, oldest first. */
export function listOutcomesApi({ session: s, url }: ApiContext) {
  const caseId = idParam(url, 'case', CASE_ID);
  const category = listParam(url, 'category', CATEGORIES);
  const since = dateParam(url, 'evaluated_since');
  const limit = limitParam(url);
  const cursor = decodeCursor(url);

  const parts: Pred[] = [canSeeCase(s, 'oe.case_id')];
  if (caseId) parts.push({ sql: 'oe.case_id = ?', params: [caseId] });
  if (category) parts.push({ sql: `oe.category in (${inList(category)})`, params: category });
  if (since) parts.push({ sql: 'oe.evaluated_at >= ?', params: [since] });
  const filter = and(...parts);
  const total = Number(one<{ c: number }>(`select count(*) c from outcome_evaluations oe where ${filter.sql}`, ...filter.params)?.c ?? 0);
  const p = cursor ? and(filter, { sql: '(oe.evaluated_at > ? or (oe.evaluated_at = ? and oe.id > ?))', params: [cursor.sort, cursor.sort, cursor.id] }) : filter;
  const rows = all<OutcomeApiRow>(
    `select oe.* from outcome_evaluations oe where ${p.sql} order by oe.evaluated_at asc, oe.id asc limit ?`, ...p.params, limit + 1,
  );
  return page(rows.map(outcomeOut), limit, (r) => [r.evaluated_at, r.id], total);
}

// ------------------------------------------------------------------ hotspots

const UNIT_ID: Record<Exclude<Level, 'school'>, RegExp> = { district: /^DST-\d{2,3}$/, block: /^BLK-\d{2,3}$/, cluster: /^CLU-\d{3,4}$/ };

/** GET /hotspots — the learning hotspot units one level below the key's unit (or below `within`). */
export function hotspotsApi({ session: s, url }: ApiContext) {
  const rounds = comparableRounds();
  const roundId = url.searchParams.get('round') || undefined;
  if (roundId && !rounds.some((r) => r.id === roundId)) throw badRequest(`round must be one of: ${rounds.map((r) => r.id).join(', ')}.`);
  const g = url.searchParams.get('grade');
  if (g && !['1', '2', '3'].includes(g)) throw badRequest('grade must be 1, 2 or 3.');
  const subject = url.searchParams.get('subject');
  if (subject && subject !== 'N' && subject !== 'L') throw badRequest('subject must be N (numeracy) or L (literacy).');
  const within = url.searchParams.get('within');
  let parent: { level: Level; id: string } | undefined;
  if (within) {
    const level = (Object.keys(UNIT_ID) as (keyof typeof UNIT_ID)[]).find((l) => UNIT_ID[l].test(within));
    if (!level) throw badRequest('within must be a district, block or cluster id.');
    if (!canSeeUnit(s, level, within)) throw notFound('area');
    parent = { level, id: within };
  }
  const f = { roundId, grade: g ? Number(g) : undefined, subject: (subject as 'N' | 'L' | null) ?? undefined };
  const { level, units, pair } = hotspotUnits(s, f, parent);
  const unitOut = (u: HotspotUnit) => ({
    id: u.id, name: u.name, level: u.level, parent_id: u.parentId,
    severity: u.severity, reason: u.reason,
    previous_pct: u.prevPct, current_pct: u.currPct, change_pp: u.changePp,
    district_change_pp: u.districtChangePp, relative_change_pp: u.relPp, z_score: u.z,
    overall_relative_change_pp: u.overallRelPp,
    students_assessed: { previous: u.nPrev, current: u.nCurr },
    participation_rate: u.participation, schools: u.schools,
    focus: u.focus ? {
      grade: u.focus.grade, competency_id: u.focus.competency_id, previous_pct: u.focus.prevPct, current_pct: u.focus.currPct,
      relative_change_pp: u.focus.relPp, z_score: u.focus.z, students_assessed: u.focus.nCurr,
    } : null,
    cells_by_severity: u.cells,
    hot_sub_areas: u.hotChildren,
    open_cases: u.openCases, critical_open_cases: u.criticalCases, overdue_tasks: u.overdueTasks,
  });
  return {
    level,
    within: parent ?? null,
    rounds: pair ? { previous: { id: pair.prev.id, code: pair.prev.code, label: pair.prev.label }, current: { id: pair.curr.id, code: pair.curr.code, label: pair.curr.label } } : null,
    filters: { grade: f.grade ?? null, subject: f.subject ?? null },
    rules: RULES,
    data: units.map(unitOut),
  };
}

// ------------------------------------------------------------------ summary

/** GET /summary — the headline figures for the key's area. */
export function summaryApi({ session: s }: ApiContext) {
  const h = headline(s);
  const byStatus = caseStatusCounts(s);
  const bySeverityOpen = caseSeverityCounts(s, { open: true });
  const byStage: Record<string, number> = Object.fromEntries(STAGES.map((st) => [st.key, 0]));
  for (const [st, n] of Object.entries(byStatus)) byStage[STAGES[stageIndex(st as CaseStatus)].key] += n;
  const sp = schoolsPred(s, 'sc');
  const schools = Number(one<{ c: number }>(`select count(*) c from schools sc where ${sp.sql}`, ...sp.params)?.c ?? 0);
  const ttc = timeToClose(s);
  const tp = and(tasksPred(s, 't'), { sql: `t.status in (${inList(OPEN_TASK)})`, params: OPEN_TASK });
  const tv = and(tasksPred(s, 't'), { sql: `t.status = 'verified'`, params: [] });
  const done = comparableRounds();
  const latest = done[done.length - 1] ?? null;
  const mix = outcomeMix(s);
  return {
    data: {
      schools,
      latest_round: latest ? { id: latest.id, code: latest.code, label: latest.label } : null,
      cases: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        open: h.open_cases,
        critical_open: h.critical,
        awaiting_approval: h.awaiting_approval,
        outcome_pending: h.outcome_pending,
        closed: h.closed_verified,
        reopened_ever: h.reopened,
        by_status: Object.fromEntries(CASE_STATUSES.map((st) => [st, byStatus[st] ?? 0])),
        open_by_severity: Object.fromEntries(SEVERITIES.map((sv) => [sv, bySeverityOpen[sv] ?? 0])),
        by_stage: byStage,
        median_days_to_close: ttc.medianDays,
      },
      tasks: {
        open: Number(one<{ c: number }>(`select count(*) c from tasks t where ${tp.sql}`, ...tp.params)?.c ?? 0),
        overdue: h.overdue_tasks,
        escalated_open: h.escalated_tasks,
        verified: Number(one<{ c: number }>(`select count(*) c from tasks t where ${tv.sql}`, ...tv.params)?.c ?? 0),
      },
      proof_awaiting_check: h.evidence_pending,
      outcomes: {
        by_category: Object.fromEntries(CATEGORIES.map((c) => [c, Number(mix.find((m) => m.category === c)?.c ?? 0)])),
      },
    },
  };
}
