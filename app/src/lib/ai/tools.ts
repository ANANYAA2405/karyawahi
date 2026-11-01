import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { searchLibrary } from '../evidence-search';
import type { Session } from '../session';
import { all } from '../db';
import { and, findingsPred, importBatchPred } from '../scope';
import { overviewSummary } from '../overview';
import { hotspotUnits, unitBreakdown, canSeeUnit, unitPath, type Level } from '../hotspots';
import {
  listCases, getCase, caseFinding, caseDiagnosis, casePlans, caseApprovals, caseTasks, caseEvidence,
  caseOutcomes, caseTimeline, listTasks, approvalQueue,
} from '../cases';
import { matchForCase, compareRows, interventionHistory } from '../studio';
import { similarCases, lessonsFrom } from '../memory';
import { search } from '../search';
import { competencies, rounds, intervention } from '../repo';
import { today, daysBetween } from '../clock';
import { listBlockers } from '../blockers';
import { buildReport, REPORT_TYPES, type ReportType } from '../reports';
import { reviewAgenda } from '../agenda';
import { listComplaints, queueCounts, STATUS as CSTATUS, slaState } from '../complaints';
import type { CaseStatus, Severity } from '@domain/types';

/**
 * The only way the model can read data. Each tool:
 *   - takes the *server-side* session, never a client-supplied role or scope;
 *   - validates its own input (the model's arguments are untrusted);
 *   - reads through the same scope predicates as the pages, so it returns nothing the user
 *     could not open themselves, and says "not found or outside your scope" — never which;
 *   - returns compact JSON plus the record ids it was built from, for citation and audit.
 * There is no raw-SQL tool and no write tool: the assistant cannot approve, assign or close.
 */

export interface ToolResult { data: unknown; sources: string[] }
type Exec = (s: Session, input: Record<string, unknown>) => ToolResult;

class BadInput extends Error {}
const str = (v: unknown, name: string, max = 64, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') { if (required) throw new BadInput(`${name} is required`); return undefined; }
  if (typeof v !== 'string' || v.length > max) throw new BadInput(`${name} must be a string up to ${max} chars`);
  return v.trim();
};
const int = (v: unknown, name: string, min: number, max: number, dflt?: number): number | undefined => {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadInput(`${name} must be an integer ${min}–${max}`);
  return n;
};
const oneOf = <T extends string>(v: unknown, name: string, opts: readonly T[]): T | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !(opts as readonly string[]).includes(v)) throw new BadInput(`${name} must be one of: ${opts.join(', ')}`);
  return v as T;
};
const OUT_OF_SCOPE = (what: string) => ({ data: { error: `${what} not found or outside your scope` }, sources: [] });
const compName = new Map<string, string>();
const comp = (id: string) => {
  if (compName.size === 0) for (const c of competencies()) compName.set(c.id, c.name_en);
  return compName.get(id) ?? id;
};
const ago = (iso: string | null | undefined) => (iso ? daysBetween(iso.slice(0, 10), today()) : null);

// ---------------------------------------------------------------- executors
const getCaseCompact = (s: Session, id: string) => {
  const c = getCase(s, id);
  if (!c) return null;
  return { id: c.id, title: c.title, status: c.status, severity: c.severity, grade: c.grade, competency: comp(c.competency_id), lever: c.lever, block_id: c.block_id, cluster_id: c.cluster_id, due_date: c.due_date, reopen_count: c.reopen_count, updated_at: c.updated_at };
};

const EXEC: Record<string, Exec> = {
  get_dashboard_summary: (s) => {
    const o = overviewSummary(s);
    return {
      data: {
        scope: o.scope, demo_date: o.demoDate, latest_round: o.latestRound, kpis: o.headline,
        priorities: o.priorities.map((p) => ({ priority: p.priority, kind: p.kind, title: p.title, detail: p.detail, when: p.when, sources: p.sources })),
        priority_counts: o.priorityCounts, cases_by_stage: o.lifecycle, task_delivery_open_cases: o.delivery,
        learning_trend: { rounds: o.trend.labels, scope_pct_proficient: o.trend.scope, state_pct_proficient: o.trend.state },
      },
      sources: o.priorities.flatMap((p) => p.sources).slice(0, 40),
    };
  },

  get_learning_hotspots: (s, i) => {
    const level = oneOf(i.parent_level, 'parent_level', ['district', 'block', 'cluster'] as const);
    const parentId = str(i.parent_id, 'parent_id');
    if (level && parentId && !canSeeUnit(s, level, parentId)) return OUT_OF_SCOPE('Area');
    const r = hotspotUnits(s, { grade: int(i.grade, 'grade', 1, 3), competencyId: str(i.competency_id, 'competency_id') }, level && parentId ? { level, id: parentId } : undefined);
    const limit = int(i.limit, 'limit', 1, 40, 15)!;
    return {
      data: {
        compared: r.pair ? `${r.pair.prev.code} → ${r.pair.curr.code}` : null, level: r.level,
        method: 'Change in % proficient minus the district change; severity needs a material drop AND |z| above threshold; small samples are "insufficient".',
        units: r.units.slice(0, limit).map((u) => ({ id: u.id, name: u.name, severity: u.severity, prev_pct: u.prevPct, curr_pct: u.currPct, change_pp: u.changePp, district_change_pp: u.districtChangePp, relative_pp: u.relPp, z: u.z, n_curr: u.nCurr, open_cases: u.openCases, overdue_tasks: u.overdueTasks, reason: u.reason })),
        total_units: r.units.length,
      },
      sources: r.units.slice(0, limit).map((u) => u.id),
    };
  },

  get_area_performance: (s, i) => {
    const level = oneOf(i.level, 'level', ['district', 'block', 'cluster', 'school'] as const) as Level | undefined;
    const id = str(i.id, 'id', 32, true)!;
    if (!level) throw new BadInput('level is required');
    if (!canSeeUnit(s, level, id)) return OUT_OF_SCOPE('Area');
    const path = unitPath(level, id);
    const parent = path.at(-2);
    const peers = hotspotUnits(s, {}, parent ? { level: parent.level, id: parent.id } : undefined).units;
    const me = peers.find((u) => u.id === id);
    const breakdown = unitBreakdown(s, level, id, { grade: int(i.grade, 'grade', 1, 3) });
    return {
      data: {
        path: path.map((p) => `${p.level}: ${p.name}`), overall: me ?? null,
        by_grade_competency: breakdown.slice(0, 18).map((b) => ({ grade: b.grade, competency: comp(b.competency_id), prev_pct: b.prevPct, curr_pct: b.currPct, change_pp: b.changePp, relative_pp: b.relPp, z: b.z, severity: b.severity, n_curr: b.nCurr })),
      },
      sources: [id],
    };
  },

  get_open_cases: (s, i) => {
    const status = oneOf(i.status, 'status', ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened', 'closed', 'dismissed', 'referred_pab'] as const);
    const severity = oneOf(i.severity, 'severity', ['critical', 'high', 'medium'] as const);
    const cases = listCases(s, {
      open: !status, status: status ? [status as CaseStatus] : undefined, severity: severity ? [severity as Severity] : undefined,
      blockId: str(i.block_id, 'block_id'), competencyId: str(i.competency_id, 'competency_id'), grade: int(i.grade, 'grade', 1, 3),
      limit: int(i.limit, 'limit', 1, 50, 20), order: 'severity',
    });
    return { data: { count: cases.length, cases: cases.map((c) => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, grade: c.grade, competency: comp(c.competency_id), block_id: c.block_id, due_date: c.due_date, reopen_count: c.reopen_count, days_since_update: ago(c.updated_at) })) }, sources: cases.map((c) => c.id) };
  },

  get_case_details: (s, i) => {
    const id = str(i.case_id, 'case_id', 20, true)!.toUpperCase();
    const c = getCaseCompact(s, id);
    if (!c) return OUT_OF_SCOPE('Case');
    const f = caseFinding(s, id);
    const dx = caseDiagnosis(s, id);
    const plans = casePlans(s, id);
    const plan = plans.find((p) => p.id === getCase(s, id)?.current_plan_id) ?? plans.at(-1);
    const iv = plan ? intervention(plan.intervention_id) : null;
    const approvals = caseApprovals(s, id);
    const tasks = caseTasks(s, id);
    const ev = caseEvidence(s, id);
    const oc = caseOutcomes(s, id).at(-1);
    const overdue = tasks.filter((t) => !t.submitted_at && t.due_date < today());
    return {
      data: {
        case: c,
        finding: f ? { id: f.id, prev_pct: f.prev_value_pct, curr_pct: f.curr_value_pct, change_pp: f.change_pp, district_change_pp: f.district_change_pp, relative_pp: f.relative_change_pp, z: f.z_score, n_prev: f.n_prev, n_curr: f.n_curr, participation: f.participation_rate, driver_schools: f.driver_schools.length, data_quality_checks: f.dq_checks.map((d) => ({ check: d.check, passed: d.passed, value: d.value, threshold: d.threshold })) } : null,
        diagnosis: dx ? {
          label: 'Associations observed in driver schools — not established causes',
          factors: dx.ranked_factors.map((r) => ({ condition: r.label, schools_flagged: r.schools_flagged, of_driver_schools: r.of_driver_schools })),
          ai_hypothesis_template: dx.ai_hypothesis, officer_conclusion: dx.human_conclusion,
        } : null,
        plan: plan ? { id: plan.id, version: plan.version, intervention: iv ? `${iv.id} ${iv.name}` : plan.intervention_id, status: plan.status, rationale: plan.rationale, alternatives: plan.alternatives, illustrative_cost_inr: plan.estimated_cost_inr, pre_registration: plan.pre_registration ? { success_threshold_pp: plan.pre_registration.success_threshold_pp, comparison_schools: plan.pre_registration.comparison_school_ids.length, followup_round: plan.pre_registration.followup_round_id } : null } : null,
        approvals: approvals.map((a) => ({ id: a.id, decision: a.decision, required_role: a.required_role, decided_at: a.decided_at, reason: a.reason })),
        tasks: { total: tasks.length, verified: tasks.filter((t) => t.status === 'verified').length, submitted: tasks.filter((t) => t.status === 'submitted').length, sent_back: tasks.filter((t) => t.status === 'sent_back').length, overdue: overdue.map((t) => ({ id: t.id, title: t.title_en, due: t.due_date, owner_role: t.owner_role, escalated: Boolean(t.escalated_at) })) },
        evidence: { total: ev.length, verified: ev.filter((e) => e.status === 'verified').length, pending: ev.filter((e) => e.status === 'pending').length, rejected: ev.filter((e) => e.status === 'rejected').length },
        latest_outcome: oc ? { id: oc.id, category: oc.category, did_pp: oc.did_pp, ci95: [oc.ci_low_pp, oc.ci_high_pp], threshold_pp: oc.success_threshold_pp, participation_passed: oc.participation_check.passed, delivery_verified: oc.delivery_verified, closure_eligible: oc.closure_eligible, closure_blockers: oc.closure_blockers, note: oc.interpretation_note } : null,
      },
      sources: [id, ...(f ? [f.id] : []), ...(dx ? [dx.id] : []), ...(plan ? [plan.id] : []), ...approvals.map((a) => a.id), ...overdue.map((t) => t.id), ...(oc ? [oc.id] : [])],
    };
  },

  get_case_timeline: (s, i) => {
    const id = str(i.case_id, 'case_id', 20, true)!.toUpperCase();
    if (!getCase(s, id)) return OUT_OF_SCOPE('Case');
    const ev = caseTimeline(s, id).slice(-30);
    return { data: { case_id: id, events: ev.map((e) => ({ id: e.id, ts: e.ts, kind: e.kind, summary: e.summary, from: e.from_status, to: e.to_status, actor: e.actor_label })) }, sources: [id, ...ev.map((e) => e.id)] };
  },

  get_overdue_tasks: (s, i) => {
    const tasks = listTasks(s, { overdue: true, blockId: str(i.block_id, 'block_id'), limit: int(i.limit, 'limit', 1, 60, 30) });
    const blockers = listBlockers(s, { open: true, limit: 200 });
    const byTask = new Map<string, string[]>();
    for (const b of blockers) for (const t of b.task_ids) byTask.set(t, [...(byTask.get(t) ?? []), `${b.id} ${b.blocker_type}`]);
    return {
      data: {
        count: tasks.length,
        tasks: tasks.map((t) => ({ id: t.id, case_id: t.case_id, title: t.title_en, owner_role: t.owner_role, school_id: t.school_id, due: t.due_date, days_overdue: ago(t.due_date), escalated: Boolean(t.escalated_at), status: t.status, reported_blockers: byTask.get(t.id) ?? [] })),
        by_owner_role: Object.entries(tasks.reduce<Record<string, number>>((m, t) => ({ ...m, [t.owner_role]: (m[t.owner_role] ?? 0) + 1 }), {})).map(([role, n]) => ({ role, n })),
      },
      sources: tasks.map((t) => t.id),
    };
  },

  get_blockers: (s, i) => {
    const rows = listBlockers(s, { open: i.include_resolved === true ? undefined : true, limit: int(i.limit, 'limit', 1, 60, 30) });
    const byType = rows.reduce<Record<string, number>>((m, b) => ({ ...m, [b.blocker_type]: (m[b.blocker_type] ?? 0) + 1 }), {});
    return { data: { count: rows.length, by_type: byType, blockers: rows.map((b) => ({ id: b.id, type: b.blocker_type, severity: b.severity, status: b.status, case_id: b.case_id, task_ids: b.task_ids, reported_at: b.reported_at, responsible: b.responsible_level, description: b.description })) }, sources: rows.map((b) => b.id) };
  },

  get_pending_approvals: (s) => {
    const q = approvalQueue(s, { limit: 30 });
    return { data: { count: q.length, note: 'Only plans this user has the authority to decide are listed.', items: q.map((x) => ({ case_id: x.case.id, title: x.case.title, severity: x.case.severity, lever: x.case.lever, plan_id: x.plan?.id, intervention: x.plan?.intervention_id, waiting_days: ago(x.approval?.submitted_at ?? x.case.updated_at) })) }, sources: q.flatMap((x) => [x.case.id, ...(x.plan ? [x.plan.id] : [])]) };
  },

  get_intervention_options: (s, i) => {
    const id = str(i.case_id, 'case_id', 20, true)!.toUpperCase();
    const m = matchForCase(s, id);
    if (!m) return OUT_OF_SCOPE('Case');
    const top = m.matches.filter((x) => x.eligible).slice(0, int(i.limit, 'limit', 1, 10, 6));
    return {
      data: {
        case_id: id, diagnosis_conditions: m.factors.map((f) => f.label),
        scoring: 'Rule-based relevance points (competency fit, condition fit, cited evidence, ledger history). Not a predicted learning effect.',
        options: top.map((x) => ({ id: x.intervention.id, name: x.intervention.name, points: x.points, reasons: x.reasons.map((r) => `+${r.points} ${r.text}`), risks: x.risks.map((r) => r.text), lever: x.authority.lever, user_can_approve: x.authority.canApprove, evidence_status: x.intervention.evidence.status, effect_size_claim: x.intervention.evidence.effect_size_text, illustrative_cost: `₹${x.intervention.cost_basis.amount_inr} ${x.intervention.cost_basis.unit}`, weeks: x.intervention.duration_weeks, is_current_plan: x.isCurrentPlan, ledger_history: x.history })),
      },
      sources: [id, ...top.map((x) => x.intervention.id)],
    };
  },

  compare_interventions: (s, i) => {
    const ids = Array.isArray(i.intervention_ids) ? i.intervention_ids.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
    if (ids.length < 2) throw new BadInput('intervention_ids needs 2 or 3 ids');
    const caseId = str(i.case_id, 'case_id', 20)?.toUpperCase();
    const match = caseId ? matchForCase(s, caseId) : null;
    if (caseId && !match) return OUT_OF_SCOPE('Case');
    const hist = interventionHistory();
    const rows = compareRows(ids).map((iv) => {
      const m = match?.matches.find((x) => x.intervention.id === iv.id);
      return {
        id: iv.id, name: iv.name, category: iv.category, lever: iv.lever, weeks: iv.duration_weeks,
        illustrative_cost: `₹${iv.cost_basis.amount_inr} ${iv.cost_basis.unit}`,
        evidence: { status: iv.evidence.status, effect_size: iv.evidence.effect_size_text, source: iv.evidence.source_title },
        delivery_conditions: iv.delivery_conditions, limitations: iv.limitations, success_metric: iv.success_metric,
        ledger_history: hist.get(iv.id) ?? null,
        case_fit: m ? { eligible: m.eligible, excluded_because: m.excludedBecause, points: m.points, reasons: m.reasons.map((r) => r.text), risks: m.risks.map((r) => r.text) } : null,
      };
    });
    return { data: { case_id: caseId ?? null, options: rows }, sources: [...rows.map((r) => r.id), ...(caseId ? [caseId] : [])] };
  },

  get_outcome_evaluation: (s, i) => {
    const id = str(i.case_id, 'case_id', 20, true)!.toUpperCase();
    if (!getCase(s, id)) return OUT_OF_SCOPE('Case');
    const ocs = caseOutcomes(s, id);
    if (ocs.length === 0) return { data: { case_id: id, outcome: null, note: 'No outcome evaluation yet — the follow-up round has not been assessed for this case.' }, sources: [id] };
    return {
      data: {
        case_id: id,
        method: 'Difference-in-differences: (treated after − before) − (comparison after − before), comparison schools locked at approval; 95% Welch interval.',
        evaluations: ocs.map((o) => ({ id: o.id, cycle: o.cycle, category: o.category, treated_before: o.treated_baseline_mean, treated_after: o.treated_followup_mean, comparison_before: o.comparison_baseline_mean, comparison_after: o.comparison_followup_mean, did_pp: o.did_pp, ci95: [o.ci_low_pp, o.ci_high_pp], success_threshold_pp: o.success_threshold_pp, treated_schools: o.treated.length, comparison_schools: o.comparison.length, participation: o.participation_check, delivery_verified: o.delivery_verified, cross_source_verified: o.cross_source_verified, closure_eligible: o.closure_eligible, closure_blockers: o.closure_blockers, interpretation: o.interpretation_note, illustrative: o.is_illustrative })),
      },
      sources: [id, ...ocs.map((o) => o.id)],
    };
  },

  get_similar_cases: (s, i) => {
    const id = str(i.case_id, 'case_id', 20, true)!.toUpperCase();
    if (!getCase(s, id)) return OUT_OF_SCOPE('Case');
    const sim = similarCases(s, id, int(i.limit, 'limit', 1, 8, 5));
    return { data: { case_id: id, note: 'Only cases inside your scope. Similarity is rule-based on competency, grade, diagnosed conditions and intervention.', lessons: lessonsFrom(sim), cases: sim.map((c) => ({ id: c.id, title: c.title, block: c.block, status: c.status, intervention: c.intervention, why_similar: c.why, outcome: c.outcome, reopened: c.reopenCount })) }, sources: [id, ...sim.map((c) => c.id)] };
  },

  get_data_quality_issues: (s) => {
    const done = rounds().filter((r) => r.status === 'completed').slice(-2).map((r) => r.id);
    const fp = and(findingsPred(s, 'f'), { sql: `f.status = 'rejected_data_quality' and f.round_id in (${done.map(() => '?').join(',')})`, params: done });
    const dq = all<{ id: string; cluster_id: string; grade: number; competency_id: string; change_pp: number; participation_rate: number; schools_reporting: number; schools_total: number; dq_checks: string }>(
      `select f.id, f.cluster_id, f.grade, f.competency_id, f.change_pp, f.participation_rate, f.schools_reporting, f.schools_total, f.dq_checks from findings f where ${fp.sql} order by f.change_pp limit 25`, ...fp.params,
    );
    const ip = importBatchPred(s, 'import_batches');
    const rej = all<{ id: string; file_name: string; rejected_rows: number; total_rows: number; status: string }>(
      `select id, file_name, rejected_rows, total_rows, status from import_batches where (${ip.sql}) and rejected_rows > 0 order by uploaded_at desc limit 10`, ...ip.params,
    );
    return {
      data: {
        note: 'These are unknowns, not evidence of "no problem". A drop that failed a data-quality gate was not turned into a case.',
        blocked_findings: dq.map((f) => {
          let failed: string[] = [];
          try { failed = (JSON.parse(f.dq_checks) as { check: string; passed: boolean }[]).filter((c) => !c.passed).map((c) => c.check); } catch { /* skip */ }
          return { id: f.id, cluster_id: f.cluster_id, grade: f.grade, competency: comp(f.competency_id), change_pp: f.change_pp, participation: f.participation_rate, schools_reporting: `${f.schools_reporting}/${f.schools_total}`, failed_checks: failed };
        }),
        imports_with_rejected_rows: rej,
      },
      sources: [...dq.map((f) => f.id), ...rej.map((r) => r.id)],
    };
  },

  get_report_data: (s, i) => {
    const type = oneOf(i.report_type, 'report_type', REPORT_TYPES.map((r) => r.key)) as ReportType | undefined;
    if (!type) throw new BadInput('report_type is required');
    const r = buildReport(s, { type });
    if (!r) return { data: { error: 'Your role cannot build that report.' }, sources: [] };
    return { data: { title: r.title, scope: r.scope, period: r.period, summary: r.summary, sections: r.sections.map((sec) => ({ title: sec.title, rows: sec.rows.slice(0, 25) })) }, sources: r.caseIds.slice(0, 50) };
  },

  get_review_meeting_agenda: (s) => {
    const a = reviewAgenda(s);
    return { data: a, sources: a.items.flatMap((x) => x.sources).slice(0, 50) };
  },

  get_complaints: (s, i) => {
    const queue = oneOf(i.queue, 'queue', ['mine', 'pending_ack', 'investigating', 'overdue', 'escalated', 'verification', 'resolved', 'submitted_by_me', 'all'] as const) ?? 'all';
    const rows = listComplaints(s, { queue, limit: int(i.limit, 'limit', 1, 40, 20) });
    return {
      data: {
        note: 'Only complaints this user may see. Restricted complaints show metadata only.',
        counts: queueCounts(s),
        complaints: rows.map((c) => ({
          id: c.id, title: c.title, category: c.category_key, status: CSTATUS[c.status]?.label ?? c.status, priority: c.priority,
          confidentiality: c.confidentiality, escalation_level: c.escalation_level, assigned_role: c.assigned_role, sla: slaState(c).label || null,
          description: c.confidentiality === 'restricted' ? '(restricted)' : c.description.slice(0, 300), linked_case: c.case_id,
        })),
      },
      sources: rows.map((c) => c.id),
    };
  },

  search_evidence_library: (s, i) => {
    const q = str(i.query, 'query', 200, true)!;
    const r = searchLibrary(s, q, { interventions: int(i.limit, 'limit', 1, 10, 5), cases: int(i.limit, 'limit', 1, 10, 5) });
    return {
      data: {
        note: 'Full-text search (BM25) over the intervention cards and the cases in this user\'s area that have an outcome check. Matched words are in [brackets].',
        interventions: r.interventions.map((h) => ({ id: h.id, name: h.title, lever: h.detail, passage: h.snippet })),
        checked_cases: r.cases.map((h) => ({ id: h.id, title: h.title, tried: h.detail, outcome: h.outcome, passage: h.snippet })),
      },
      sources: [...r.interventions, ...r.cases].map((h) => h.id),
    };
  },

  search_records: (s, i) => {
    const q = str(i.query, 'query', 80, true)!;
    const r = search(s, q);
    const pick = (xs: { id: string; title: string; sub: string }[]) => xs.slice(0, 8).map((x) => ({ id: x.id, title: x.title, info: x.sub }));
    return { data: { cases: pick(r.cases), schools: pick(r.schools), interventions: pick(r.interventions), tasks: pick(r.tasks), reports: pick(r.reports) }, sources: [...r.cases, ...r.schools, ...r.interventions].slice(0, 30).map((x) => x.id) };
  },
};

// ---------------------------------------------------------------- definitions
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const caseIdProp = { type: 'string', description: 'Case id, e.g. CASE-0184' };
const gradeProp = { type: 'integer', minimum: 1, maximum: 3, description: 'Class 1, 2 or 3' };
const compProp = { type: 'string', enum: ['CMP-L1', 'CMP-L2', 'CMP-L3', 'CMP-N1', 'CMP-N2', 'CMP-N3'], description: 'L1 letter recognition, L2 word reading, L3 reading with comprehension, N1 number recognition, N2 addition, N3 subtraction' };

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  { name: 'get_dashboard_summary', description: 'KPIs, prioritised actions, case stages, task delivery and the learning trend for everything in the user’s scope. Start here for broad questions ("what should I prioritise", "summarise my district").', input_schema: obj({}) },
  { name: 'get_learning_hotspots', description: 'Areas where % proficient fell relative to the district between the two latest assessment rounds, worst first. Optionally drill into a parent area, or filter by grade/competency.', input_schema: obj({ parent_level: { type: 'string', enum: ['district', 'block', 'cluster'] }, parent_id: { type: 'string', description: 'e.g. DST-01, BLK-01, CLU-001' }, grade: gradeProp, competency_id: compProp, limit: { type: 'integer', minimum: 1, maximum: 40 } }) },
  { name: 'get_area_performance', description: 'Learning performance for one district, block, cluster or school: overall change vs district, and a grade × competency breakdown.', input_schema: obj({ level: { type: 'string', enum: ['district', 'block', 'cluster', 'school'] }, id: { type: 'string', description: 'e.g. BLK-01, CLU-001, SCH-00002' }, grade: gradeProp }, ['level', 'id']) },
  { name: 'get_open_cases', description: 'List cases in scope (open by default), filterable by status, severity, block, competency, grade.', input_schema: obj({ status: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium'] }, block_id: { type: 'string' }, competency_id: compProp, grade: gradeProp, limit: { type: 'integer', minimum: 1, maximum: 50 } }) },
  { name: 'get_case_details', description: 'Everything about one case: finding and data-quality gates, diagnosis conditions, current plan and pre-registration, approvals, task and evidence status, latest outcome check and closure blockers.', input_schema: obj({ case_id: caseIdProp }, ['case_id']) },
  { name: 'get_case_timeline', description: 'Chronological events for one case (status changes, escalations, plans, outcome evaluations).', input_schema: obj({ case_id: caseIdProp }, ['case_id']) },
  { name: 'get_overdue_tasks', description: 'Tasks past their due date in scope, with owner role, days overdue, escalation, and any blockers reported against them.', input_schema: obj({ block_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 60 } }) },
  { name: 'get_blockers', description: 'Structured blockers reported by officers (staff unavailable, budget, materials, training, closure, attendance, connectivity, approval pending…), grouped by type.', input_schema: obj({ include_resolved: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 60 } }) },
  { name: 'get_pending_approvals', description: 'Plans waiting on a decision that this user has the authority to make.', input_schema: obj({}) },
  { name: 'get_intervention_options', description: 'Rule-based ranking of catalogue interventions for a case, with the points and reasons behind each, feasibility risks, who can approve, and ledger history.', input_schema: obj({ case_id: caseIdProp, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['case_id']) },
  { name: 'compare_interventions', description: 'Side-by-side comparison of 2–3 interventions (INT-01…INT-18): evidence, cost basis, duration, authority, delivery conditions, limitations, ledger outcomes; optionally fit to a case.', input_schema: obj({ intervention_ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 }, case_id: caseIdProp }, ['intervention_ids']) },
  { name: 'get_outcome_evaluation', description: 'The pre-registered difference-in-differences outcome check(s) for a case with interval, participation, delivery verification and closure eligibility.', input_schema: obj({ case_id: caseIdProp }, ['case_id']) },
  { name: 'get_similar_cases', description: 'Previously handled cases in scope that resemble this one, what intervention they used and what the outcome check showed.', input_schema: obj({ case_id: caseIdProp, limit: { type: 'integer', minimum: 1, maximum: 8 } }, ['case_id']) },
  { name: 'get_data_quality_issues', description: 'Candidate declines blocked by data-quality gates in recent rounds and import batches with rejected rows.', input_schema: obj({}) },
  { name: 'get_report_data', description: 'Deterministic report content built from the case ledger.', input_schema: obj({ report_type: { type: 'string', enum: REPORT_TYPES.map((r) => r.key) } }, ['report_type']) },
  { name: 'get_review_meeting_agenda', description: 'A deterministic agenda for a review meeting: decisions needed, escalations, no-gain outcomes, data issues, upcoming rounds.', input_schema: obj({}) },
  { name: 'get_complaints', description: 'Complaints and grievances visible to this user (assigned to them, raised by them, routed through them, or in their oversight scope), with SLA state and escalation level. Queues: mine, pending_ack, investigating, overdue, escalated, verification, resolved, submitted_by_me, all.', input_schema: obj({ queue: { type: 'string', enum: ['mine', 'pending_ack', 'investigating', 'overdue', 'escalated', 'verification', 'resolved', 'submitted_by_me', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 40 } }) },
  { name: 'search_evidence_library', description: 'Search the evidence library by meaning-bearing words: intervention cards (evidence, effect sizes, delivery conditions, limitations, cost) and previously tried cases with their outcome checks ("what happened last time here"). Use for questions like "what works for teacher shortage", "has a reading camp worked here before".', input_schema: obj({ query: { type: 'string', description: 'Words describing the problem or approach, in English' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['query']) },
  { name: 'search_records', description: 'Find cases, schools, interventions, tasks or reports by id or keyword.', input_schema: obj({ query: { type: 'string' } }, ['query']) },
].map((t) => ({ ...t, eager_input_streaming: true }));

export function runTool(s: Session, name: string, input: unknown): { result: ToolResult; error?: string } {
  const exec = EXEC[name];
  if (!exec) return { result: { data: { error: `Unknown tool ${name}` }, sources: [] }, error: 'unknown_tool' };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { result: { data: { error: 'Tool input must be a JSON object' }, sources: [] }, error: 'invalid_input' };
  }
  try {
    return { result: exec(s, input as Record<string, unknown>) };
  } catch (e) {
    if (e instanceof BadInput) return { result: { data: { error: e.message }, sources: [] }, error: 'invalid_input' };
    console.error(`[ai tool ${name}]`, e);
    return { result: { data: { error: 'The tool failed while reading the database.' }, sources: [] }, error: 'tool_failed' };
  }
}
