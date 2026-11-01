import 'server-only';
import { all, run, nextId, tx } from './db';
import { and, casesPred, canSeeCase, findingsPred, importBatchPred, type Pred } from './scope';
import type { Session } from './session';
import { today, nowIso, daysBetween } from './clock';
import { may, actingRole } from './guard';
import { headline } from './dash';
import { priorityActions } from './overview';
import { hotspotUnits } from './hotspots';
import { listBlockers, blockerMeta } from './blockers';
import { scopeName, competencies, rounds } from './repo';
import { appendAudit } from './write';
import { STATUS_LABELS } from '@domain/lifecycle';
import { DISCLAIMER } from '@domain/catalog';
import type { CaseStatus } from '@domain/types';

/**
 * Reporting workspace. Every report is *derived* from the case ledger at the moment it is
 * built — the ATR's "completed" column is the task table, its "outcome" column is the outcome
 * evaluation, and an action is never called successful because it was done. Saving a report
 * freezes a snapshot; regenerating builds a new one from current records.
 */

export const REPORT_TYPES = [
  { key: 'atr', label: 'Action Taken Report', blurb: 'Every actioned case: approved action, owner, completion, proof, verification and outcome.' },
  { key: 'learning_impact', label: 'Learning Impact Report', blurb: 'Pre-registered outcome checks: baseline, follow-up, comparison, effect and its uncertainty.' },
  { key: 'exceptions', label: 'Exception Report', blurb: 'What is off track: escalations, overdue work, rejected proof, reopened cases, stalled decisions.' },
  { key: 'review_pack', label: 'District Review Pack', blurb: 'For the monthly review meeting: position, hotspots, decisions needed, risks.' },
  { key: 'block_performance', label: 'Block Performance Report', blurb: 'Learning trend and case workload by block or cluster.' },
  { key: 'intervention_effectiveness', label: 'Intervention Effectiveness Report', blurb: 'For each intervention used: how often it was evaluated and what the checks showed.' },
  { key: 'data_quality', label: 'Data Quality Report', blurb: 'Declines that could not be assessed, import rejections, insufficient samples.' },
  { key: 'executive_summary', label: 'Executive Summary', blurb: 'One page: KPIs, top priorities, outcome mix, caveats.' },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['key'];

export interface ReportOptions {
  type: ReportType;
  from?: string;
  to?: string;
  includeEvidence?: boolean;
  includeUnresolved?: boolean;
  includeDataQuality?: boolean;
  includeSummary?: boolean;
}

export interface ReportSection {
  title: string;
  note?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

export interface BuiltReport {
  builder: 'v2';
  type: ReportType;
  title: string;
  scope: string;
  scopeType: string;
  scopeId: string;
  period: { from: string; to: string };
  generatedAt: string;
  generatedBy: string;
  summary: { label: string; value: string }[];
  sections: ReportSection[];
  caveats: string[];
  caseIds: string[];
  disclaimer: string;
}

const OPEN: CaseStatus[] = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];
const statusLabel = (st: string) => STATUS_LABELS[st as CaseStatus]?.en ?? st.replace(/_/g, ' ');
const fmt = (x: number | null | undefined, unit = '') => (x === null || x === undefined ? '—' : `${x > 0 && unit === ' pp' ? '+' : ''}${Number(x).toFixed(1)}${unit}`);

export function buildReport(s: Session, o: ReportOptions): BuiltReport | null {
  if (!may(s, 'report.export')) return null;
  const meta = REPORT_TYPES.find((r) => r.key === o.type);
  if (!meta) return null;
  const to = o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to) ? o.to : today();
  const from = o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from) ? o.from : `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
  const scope = scopeName(s.scope_type, s.scope_id);
  const comp = new Map(competencies().map((c) => [c.id, c.name_en]));
  const base: Omit<BuiltReport, 'summary' | 'sections' | 'caveats' | 'caseIds'> = {
    builder: 'v2', type: o.type, title: `${meta.label} — ${scope}`, scope, scopeType: s.scope_type, scopeId: s.scope_id,
    period: { from, to }, generatedAt: nowIso(), generatedBy: s.full_name, disclaimer: DISCLAIMER,
  };
  const inPeriod: Pred = { sql: 'c.updated_at >= ? and c.created_at <= ?', params: [from, `${to}T23:59:59`] };
  const caveats = [
    'All records are fictional demo data generated for this prototype.',
    'Costs are illustrative, not PAB unit costs.',
  ];

  // ---------------------------------------------------------------- ATR
  if (o.type === 'atr') {
    const p = and(casesPred(s, 'c'), inPeriod, { sql: `c.status not in ('detected','under_investigation','awaiting_approval','dismissed')`, params: [] });
    const rows = all<{
      id: string; title: string; status: string; due_date: string | null; verification_status: string; owner: string;
      intervention: string | null; tasks: number; verified: number; submitted: number; overdue: number;
      ev_pending: number; ev_rejected: number; category: string | null; did_pp: number | null; blockers: string | null; finding: string | null;
    }>(
      `select c.id, c.title, c.status, c.due_date, c.verification_status, u.full_name owner,
              iv.id || ' ' || iv.name intervention,
              (select count(*) from tasks t where t.case_id = c.id) tasks,
              (select count(*) from tasks t where t.case_id = c.id and t.status = 'verified') verified,
              (select count(*) from tasks t where t.case_id = c.id and t.status = 'submitted') submitted,
              (select count(*) from tasks t where t.case_id = c.id and t.submitted_at is null and t.due_date < ?) overdue,
              (select count(*) from evidence e where e.case_id = c.id and e.status = 'pending') ev_pending,
              (select count(*) from evidence e where e.case_id = c.id and e.status = 'rejected') ev_rejected,
              oe.category, oe.did_pp, oe.closure_blockers,
              (select printf('%.1f%% → %.1f%%', f.prev_value_pct, f.curr_value_pct) from findings f where f.id = c.finding_id) finding
         from cases c
         left join users u on u.id = c.owner_user_id
         left join case_plans p on p.id = c.current_plan_id
         left join interventions iv on iv.id = p.intervention_id
         left join outcome_evaluations oe on oe.id = (select x.id from outcome_evaluations x where x.case_id = c.id order by x.evaluated_at desc limit 1)
        where ${p.sql} order by c.id`,
      today(), ...p.params,
    );
    const filtered = o.includeUnresolved === false ? rows.filter((r) => r.status === 'closed') : rows;
    const columns = [
      { key: 'case', label: 'Case' }, { key: 'finding', label: 'Original finding' }, { key: 'owner', label: 'Owner' },
      { key: 'action', label: 'Approved action' }, { key: 'due', label: 'Due' }, { key: 'completion', label: 'Tasks verified' },
      ...(o.includeEvidence !== false ? [{ key: 'evidence', label: 'Proof status' }] : []),
      { key: 'verification', label: 'Delivery verification' }, { key: 'outcome', label: 'Learning outcome' }, { key: 'outstanding', label: 'Outstanding' },
    ];
    return {
      ...base,
      summary: [
        { label: 'Cases actioned', value: String(filtered.length) },
        { label: 'Closed on a verified gain', value: String(filtered.filter((r) => r.status === 'closed').length) },
        { label: 'Delivered, awaiting next round', value: String(filtered.filter((r) => r.status === 'outcome_pending').length) },
        { label: 'With overdue tasks', value: String(filtered.filter((r) => r.overdue > 0).length) },
      ],
      sections: [{
        title: 'Cases actioned in the period',
        note: 'Completion is the task ledger; outcome is the pre-registered check. A completed action is not reported as a success unless the outcome check shows a gain.',
        columns,
        rows: filtered.map((r) => {
          let blockers: string[] = [];
          try { blockers = r.blockers ? JSON.parse(r.blockers) : []; } catch { /* ignore */ }
          const outstanding = [r.overdue ? `${r.overdue} task(s) overdue` : '', r.ev_pending ? `${r.ev_pending} proof pending` : '', ...blockers].filter(Boolean).join('; ');
          return {
            case: `${r.id} — ${r.title}`, finding: r.finding ?? 'Officer-raised', owner: r.owner, action: r.intervention ?? '—',
            due: r.due_date ?? '—', completion: `${r.verified}/${r.tasks}`,
            evidence: `${r.ev_pending} pending · ${r.ev_rejected} sent back`,
            verification: r.verification_status.replace(/_/g, ' '),
            outcome: r.category ? `${r.category.replace(/_/g, ' ')}${r.did_pp !== null ? ` (${fmt(r.did_pp, ' pp')})` : ''}` : (r.status === 'outcome_pending' ? 'Awaiting next round' : 'Not yet evaluated'),
            outstanding: outstanding || (r.status === 'closed' ? 'None — closed' : '—'),
          };
        }),
      }],
      caveats: [...caveats, '“Delivery verification” means proof was accepted by someone other than its submitter; it is not evidence of learning improvement.'],
      caseIds: filtered.map((r) => r.id),
    };
  }

  // ---------------------------------------------------------------- impact
  if (o.type === 'learning_impact') {
    const p = and(canSeeCase(s, 'oe.case_id'), { sql: 'oe.evaluated_at >= ? and oe.evaluated_at <= ?', params: [from, `${to}T23:59:59`] });
    const rows = all<{ id: string; case_id: string; competency_id: string; grade: number; tb: number | null; tf: number | null; cb: number | null; cf: number | null; did: number | null; lo: number | null; hi: number | null; thr: number; cat: string; pc: string; illustrative: number; iv: string | null }>(
      `select oe.id, oe.case_id, oe.competency_id, oe.grade, oe.treated_baseline_mean tb, oe.treated_followup_mean tf,
              oe.comparison_baseline_mean cb, oe.comparison_followup_mean cf, oe.did_pp did, oe.ci_low_pp lo, oe.ci_high_pp hi,
              oe.success_threshold_pp thr, oe.category cat, oe.participation_check pc, oe.is_illustrative illustrative, p.intervention_id iv
         from outcome_evaluations oe left join case_plans p on p.id = oe.plan_id where ${p.sql} order by oe.evaluated_at desc`, ...p.params,
    );
    const confirmed = rows.filter((r) => r.cat === 'improved_confirmed').length;
    return {
      ...base,
      summary: [
        { label: 'Outcome checks', value: String(rows.length) },
        { label: 'Gain confirmed (interval above zero)', value: String(confirmed) },
        { label: 'Gain indicative only', value: String(rows.filter((r) => r.cat === 'improved_indicative').length) },
        { label: 'No gain / below target / worse', value: String(rows.filter((r) => ['no_change', 'below_target', 'worsened'].includes(r.cat)).length) },
        { label: 'Inconclusive', value: String(rows.filter((r) => r.cat === 'inconclusive').length) },
      ],
      sections: [{
        title: 'Pre-registered outcome checks',
        note: 'Effect = (treated after − before) − (comparison after − before). “Confirmed” requires the 95% interval to exclude zero; “indicative” means the point estimate passed but the interval does not rule out no effect.',
        columns: [
          { key: 'case', label: 'Case' }, { key: 'target', label: 'Target' }, { key: 'iv', label: 'Intervention' },
          { key: 'treated', label: 'Treated before → after' }, { key: 'comparison', label: 'Comparison before → after' },
          { key: 'effect', label: 'Effect (95% CI)' }, { key: 'threshold', label: 'Threshold' }, { key: 'participation', label: 'Participation' }, { key: 'result', label: 'Result' },
        ],
        rows: rows.map((r) => {
          let pc: { passed?: boolean } = {};
          try { pc = JSON.parse(r.pc); } catch { /* ignore */ }
          return {
            case: r.case_id, target: `Class ${r.grade} ${comp.get(r.competency_id) ?? r.competency_id}`, iv: r.iv ?? '—',
            treated: `${fmt(r.tb, '%')} → ${fmt(r.tf, '%')}`, comparison: `${fmt(r.cb, '%')} → ${fmt(r.cf, '%')}`,
            effect: `${fmt(r.did, ' pp')} [${fmt(r.lo)}, ${fmt(r.hi)}]`, threshold: `${r.thr} pp`,
            participation: pc.passed ? 'Passed floor' : 'Below floor',
            result: `${r.cat.replace(/_/g, ' ')}${r.illustrative ? ' (illustrative)' : ''}`,
          };
        }),
      }],
      caveats: [...caveats, 'Difference-in-differences assumes the treated and comparison schools would have moved in parallel without the intervention. That assumption cannot be tested from two rounds.', 'Schools are selected because they fell; some recovery is expected from regression to the mean alone.'],
      caseIds: [...new Set(rows.map((r) => r.case_id))],
    };
  }

  // ---------------------------------------------------------------- exceptions
  if (o.type === 'exceptions') {
    const p = casesPred(s, 'c');
    const overdue = all<{ id: string; case_id: string; title: string; role: string; due: string; esc: string | null }>(
      `select t.id, t.case_id, t.title_en title, t.owner_role role, t.due_date due, t.escalated_at esc from tasks t join cases c on c.id = t.case_id
        where ${p.sql} and t.submitted_at is null and t.due_date < ? order by t.due_date limit 200`, ...p.params, today(),
    );
    const rejected = all<{ id: string; case_id: string; reason: string | null; at: string }>(
      `select e.id, e.case_id, e.rejection_reason reason, e.verified_at at from evidence e join cases c on c.id = e.case_id
        where ${p.sql} and e.status = 'rejected' and e.verified_at >= ? order by e.verified_at desc limit 100`, ...p.params, from,
    );
    const reopened = all<{ id: string; title: string; n: number; status: string }>(`select c.id, c.title, c.reopen_count n, c.status from cases c where ${p.sql} and c.reopen_count > 0 order by c.reopen_count desc limit 100`, ...p.params);
    const blockers = listBlockers(s, { open: true, limit: 200 });
    return {
      ...base,
      summary: [
        { label: 'Overdue tasks', value: String(overdue.length) },
        { label: 'Escalated', value: String(overdue.filter((t) => t.esc).length) },
        { label: 'Proof sent back (period)', value: String(rejected.length) },
        { label: 'Cases reopened', value: String(reopened.length) },
        { label: 'Open blockers', value: String(blockers.length) },
      ],
      sections: [
        { title: 'Overdue tasks', columns: [{ key: 'task', label: 'Task' }, { key: 'case', label: 'Case' }, { key: 'owner', label: 'Owner role' }, { key: 'days', label: 'Days overdue' }, { key: 'esc', label: 'Escalated' }],
          rows: overdue.map((t) => ({ task: `${t.id} — ${t.title}`, case: t.case_id, owner: t.role.toUpperCase(), days: daysBetween(t.due, today()), esc: t.esc ? 'Yes' : 'No' })) },
        { title: 'Open blockers', columns: [{ key: 'id', label: 'Blocker' }, { key: 'type', label: 'Type' }, { key: 'case', label: 'Case' }, { key: 'level', label: 'Responsible' }, { key: 'desc', label: 'Description' }],
          rows: blockers.map((b) => ({ id: b.id, type: blockerMeta(b.blocker_type).label, case: b.case_id, level: b.responsible_level, desc: b.description })) },
        { title: 'Proof sent back', columns: [{ key: 'id', label: 'Evidence' }, { key: 'case', label: 'Case' }, { key: 'reason', label: 'Reason' }, { key: 'at', label: 'When' }],
          rows: rejected.map((e) => ({ id: e.id, case: e.case_id, reason: e.reason ?? '—', at: e.at?.slice(0, 10) ?? '—' })) },
        { title: 'Reopened cases', columns: [{ key: 'case', label: 'Case' }, { key: 'n', label: 'Times reopened' }, { key: 'status', label: 'Now' }],
          rows: reopened.map((c) => ({ case: `${c.id} — ${c.title}`, n: c.n, status: statusLabel(c.status) })) },
      ],
      caveats,
      caseIds: [...new Set([...overdue.map((t) => t.case_id), ...reopened.map((c) => c.id)])],
    };
  }

  // ---------------------------------------------------------------- review pack / exec summary
  if (o.type === 'review_pack' || o.type === 'executive_summary') {
    const h = headline(s);
    const pa = priorityActions(s, o.type === 'executive_summary' ? 5 : 12);
    const hs = hotspotUnits(s, {});
    const worst = hs.units.filter((u) => ['critical', 'significant'].includes(u.severity)).slice(0, 10);
    const oc = all<{ category: string; c: number }>(`select oe.category, count(*) c from outcome_evaluations oe join cases c on c.id = oe.case_id where ${casesPred(s, 'c').sql} group by oe.category`, ...casesPred(s, 'c').params);
    const sections: ReportSection[] = [
      { title: 'Decisions and actions needed', columns: [{ key: 'priority', label: 'Priority' }, { key: 'item', label: 'Item' }, { key: 'owner', label: 'Owner' }, { key: 'when', label: 'Age' }],
        rows: pa.items.map((i) => ({ priority: i.priority, item: `${i.title} — ${i.detail}`, owner: i.owner, when: i.when })) },
      { title: `Learning hotspots (${hs.pair ? `${hs.pair.prev.code} → ${hs.pair.curr.code}` : 'n/a'})`, note: 'Change relative to the district; severity needs both a material drop and a clear z-score.',
        columns: [{ key: 'area', label: 'Area' }, { key: 'severity', label: 'Severity' }, { key: 'change', label: 'vs district' }, { key: 'cases', label: 'Open cases' }],
        rows: worst.map((u) => ({ area: u.name, severity: u.severity, change: fmt(u.relPp, ' pp'), cases: u.openCases })) },
      { title: 'Outcome checks to date', columns: [{ key: 'cat', label: 'Result' }, { key: 'n', label: 'Cases' }], rows: oc.map((r) => ({ cat: r.category.replace(/_/g, ' '), n: r.c })) },
    ];
    return {
      ...base,
      summary: [
        { label: 'Open cases', value: String(h.open_cases) }, { label: 'Critical', value: String(h.critical) },
        { label: 'Awaiting approval', value: String(h.awaiting_approval) }, { label: 'Overdue tasks', value: String(h.overdue_tasks) },
        { label: 'Closed on verified gain', value: String(h.closed_verified) }, { label: 'Reopened', value: String(h.reopened) },
      ],
      sections: o.type === 'executive_summary' ? sections.slice(0, 2).concat(sections[2]) : sections,
      caveats: o.includeDataQuality === false ? caveats : [...caveats, 'Areas with too few assessed students are reported as “insufficient data”, not as stable.'],
      caseIds: pa.items.flatMap((i) => i.sources).filter((x) => x.startsWith('CASE-')),
    };
  }

  // ---------------------------------------------------------------- block performance
  if (o.type === 'block_performance') {
    const hs = hotspotUnits(s, {});
    return {
      ...base,
      summary: [
        { label: 'Areas', value: String(hs.units.length) },
        { label: 'Critical / significant decline', value: String(hs.units.filter((u) => ['critical', 'significant'].includes(u.severity)).length) },
        { label: 'Improving', value: String(hs.units.filter((u) => u.severity === 'improving').length) },
        { label: 'Insufficient data', value: String(hs.units.filter((u) => u.severity === 'insufficient').length) },
      ],
      sections: [{
        title: `By ${hs.level} (${hs.pair ? `${hs.pair.prev.code} → ${hs.pair.curr.code}` : ''})`,
        columns: [{ key: 'area', label: hs.level }, { key: 'prev', label: 'Before' }, { key: 'curr', label: 'After' }, { key: 'rel', label: 'vs district' }, { key: 'z', label: 'z' }, { key: 'severity', label: 'Severity' }, { key: 'open', label: 'Open cases' }, { key: 'overdue', label: 'Overdue tasks' }],
        rows: hs.units.map((u) => ({ area: u.name, prev: fmt(u.prevPct, '%'), curr: fmt(u.currPct, '%'), rel: fmt(u.relPp, ' pp'), z: u.z === null ? '—' : u.z.toFixed(2), severity: u.severity, open: u.openCases, overdue: u.overdueTasks })),
      }],
      caveats,
      caseIds: [],
    };
  }

  // ---------------------------------------------------------------- intervention effectiveness
  if (o.type === 'intervention_effectiveness') {
    const p = casesPred(s, 'c');
    const rows = all<{ id: string; name: string; plans: number; evaluated: number; confirmed: number; indicative: number; none: number; inconc: number; avg_did: number | null }>(
      `select iv.id, iv.name, count(distinct pl.id) plans, count(oe.id) evaluated,
              sum(case when oe.category = 'improved_confirmed' then 1 else 0 end) confirmed,
              sum(case when oe.category = 'improved_indicative' then 1 else 0 end) indicative,
              sum(case when oe.category in ('no_change','below_target','worsened') then 1 else 0 end) none,
              sum(case when oe.category = 'inconclusive' then 1 else 0 end) inconc,
              avg(oe.did_pp) avg_did
         from case_plans pl join cases c on c.id = pl.case_id join interventions iv on iv.id = pl.intervention_id
         left join outcome_evaluations oe on oe.plan_id = pl.id
        where ${p.sql} group by iv.id order by plans desc`, ...p.params,
    );
    return {
      ...base,
      summary: [{ label: 'Interventions used', value: String(rows.length) }, { label: 'Outcome checks', value: String(rows.reduce((t, r) => t + Number(r.evaluated), 0)) }],
      sections: [{
        title: 'Results by intervention',
        note: 'Counts from this ledger only. These are not causal estimates of the intervention in general: cases differ, and many cards make no effect-size claim at all.',
        columns: [{ key: 'iv', label: 'Intervention' }, { key: 'plans', label: 'Plans' }, { key: 'evaluated', label: 'Evaluated' }, { key: 'confirmed', label: 'Confirmed gain' }, { key: 'indicative', label: 'Indicative' }, { key: 'none', label: 'No gain' }, { key: 'inconc', label: 'Inconclusive' }, { key: 'avg', label: 'Mean effect' }],
        rows: rows.map((r) => ({ iv: `${r.id} ${r.name}`, plans: r.plans, evaluated: r.evaluated, confirmed: r.confirmed ?? 0, indicative: r.indicative ?? 0, none: r.none ?? 0, inconc: r.inconc ?? 0, avg: Number(r.evaluated) > 0 ? fmt(r.avg_did, ' pp') : '—' })),
      }],
      caveats: [...caveats, 'A mean effect over few cases is unstable; read it alongside the number evaluated.'],
      caseIds: [],
    };
  }

  // ---------------------------------------------------------------- data quality
  const done = rounds().filter((r) => r.status === 'completed').map((r) => r.id);
  const fp = and(findingsPred(s, 'f'), { sql: `f.status = 'rejected_data_quality'`, params: [] });
  const dq = all<{ id: string; round_id: string; cluster: string; grade: number; competency_id: string; participation_rate: number; schools_reporting: number; schools_total: number }>(
    `select f.id, f.round_id, cl.name cluster, f.grade, f.competency_id, f.participation_rate, f.schools_reporting, f.schools_total
       from findings f left join clusters cl on cl.id = f.cluster_id where ${fp.sql} order by f.round_id desc, f.id`, ...fp.params,
  );
  const ip = importBatchPred(s, 'import_batches');
  const imports = all<{ id: string; file_name: string; status: string; total_rows: number; rejected_rows: number; uploaded_at: string }>(
    `select id, file_name, status, total_rows, rejected_rows, uploaded_at from import_batches where ${ip.sql} order by uploaded_at desc`, ...ip.params,
  );
  const hs = hotspotUnits(s, {});
  void done;
  return {
    ...base,
    summary: [
      { label: 'Declines blocked by data quality', value: String(dq.length) },
      { label: 'Import batches', value: String(imports.length) },
      { label: 'Rows rejected on import', value: String(imports.reduce((t, r) => t + Number(r.rejected_rows), 0)) },
      { label: `Areas with insufficient data (${hs.level})`, value: String(hs.units.filter((u) => u.severity === 'insufficient').length) },
    ],
    sections: [
      { title: 'Candidate declines not assessed', note: 'Each failed a participation or coverage gate. They are unknowns, not evidence that learning is fine.',
        columns: [{ key: 'id', label: 'Finding' }, { key: 'round', label: 'Round' }, { key: 'area', label: 'Cluster' }, { key: 'target', label: 'Target' }, { key: 'participation', label: 'Participation' }, { key: 'coverage', label: 'Schools reporting' }],
        rows: dq.map((f) => ({ id: f.id, round: f.round_id, area: f.cluster, target: `Class ${f.grade} ${comp.get(f.competency_id) ?? f.competency_id}`, participation: `${Math.round(f.participation_rate * 100)}%`, coverage: `${f.schools_reporting}/${f.schools_total}` })) },
      { title: 'Import batches', columns: [{ key: 'id', label: 'Batch' }, { key: 'file', label: 'File' }, { key: 'status', label: 'Status' }, { key: 'rows', label: 'Rows' }, { key: 'rejected', label: 'Rejected' }, { key: 'at', label: 'Uploaded' }],
        rows: imports.map((r) => ({ id: r.id, file: r.file_name, status: r.status, rows: r.total_rows, rejected: r.rejected_rows, at: r.uploaded_at.slice(0, 10) })) },
    ],
    caveats,
    caseIds: [],
  };
}

/** Freeze a built report into the archive and the audit chain. */
export function saveReport(s: Session, r: BuiltReport): string {
  return tx(() => {
    const id = nextId('report', 'RPT-', 5);
    run(
      `insert into reports (id, report_type, title, scope_type, scope_id, period_start, period_end, generated_at, generated_by, case_ids, content, narrative_model, formats, demo_disclaimer)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, r.type, r.title, r.scopeType, r.scopeId, r.period.from, r.period.to, r.generatedAt, s.user_id,
      JSON.stringify(r.caseIds), JSON.stringify(r), null, JSON.stringify(['html', 'csv', 'xlsx', 'pdf']), 1,
    );
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s), action: 'report.generate', entityType: 'report', entityId: id, after: { type: r.type, cases: r.caseIds.length } });
    return id;
  });
}

export function reportToCsv(r: BuiltReport): string {
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines: string[] = [esc(r.title), esc(`Scope: ${r.scope}`), esc(`Period: ${r.period.from} to ${r.period.to}`), esc(`Generated: ${r.generatedAt} by ${r.generatedBy}`), esc(r.disclaimer), ''];
  for (const s of r.summary) lines.push([esc(s.label), esc(s.value)].join(','));
  for (const sec of r.sections) {
    lines.push('', esc(sec.title));
    lines.push(sec.columns.map((c) => esc(c.label)).join(','));
    for (const row of sec.rows) lines.push(sec.columns.map((c) => esc(row[c.key])).join(','));
  }
  lines.push('', 'Caveats');
  for (const c of r.caveats) lines.push(esc(c));
  return `﻿${lines.join('\r\n')}`;
}
