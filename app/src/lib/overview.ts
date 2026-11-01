import 'server-only';
import { all, one } from './db';
import { learningRows } from './learning-cache';
import { and, casesPred, schoolsPred, findingsPred } from './scope';
import type { Session } from './session';
import { today, nowIso, daysBetween } from './clock';
import { approvalQueue, listTasks, evidenceToCheck, outcomesToReview, listCases } from './cases';
import { headline, type Headline } from './dash';
import { rounds, scopeName } from './repo';
import { may } from './guard';
import { STATUS_LABELS } from '@domain/lifecycle';
import { AS_OF_TS } from '@domain/catalog';
import { listComplaints, slaState, STATUS as CSTATUS, complaintsPred } from './complaints';
import type { CaseStatus } from '@domain/types';

/**
 * The operational overview: "what needs my attention today to improve learning outcomes?"
 *
 * Everything here is computed from the records the user may see, through the same scope
 * predicates as the detail pages. Nothing is hard-coded and nothing is generated text — the
 * AI briefing reads this same summary and narrates it, it does not compute it.
 */

export type Priority = 'critical' | 'high' | 'medium';

export interface PriorityItem {
  id: string;
  kind: 'approval' | 'overdue' | 'evidence' | 'no_gain' | 'data_quality' | 'investigation' | 'complaint';
  priority: Priority;
  title: string;
  detail: string;
  owner: string;
  when: string;
  scope: string;
  href: string;
  action: string;
  sources: string[];
}

const OPEN: CaseStatus[] = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];
const rank: Record<Priority, number> = { critical: 0, high: 1, medium: 2 };
const days = (iso: string | null | undefined) => (iso ? Math.max(0, daysBetween(iso.slice(0, 10), today())) : 0);

export function priorityActions(s: Session, limit = 8): { items: PriorityItem[]; counts: Record<PriorityItem['kind'], number> } {
  const items: PriorityItem[] = [];
  const blockNames = new Map(all<{ id: string; name: string }>('select id, name from blocks').map((r) => [r.id, r.name]));

  // 1. Plans waiting on a decision this user is empowered to make.
  const approvals = approvalQueue(s, { limit: 50 });
  for (const q of approvals) {
    const age = days(q.approval?.submitted_at ?? q.case.updated_at);
    items.push({
      id: `ap-${q.case.id}`, kind: 'approval',
      priority: q.case.severity === 'critical' ? 'critical' : age > 5 ? 'high' : 'medium',
      title: `Decide the plan for ${q.case.id}`,
      detail: q.case.title,
      owner: q.case.lever === 'block' ? 'BEO / DEO' : 'DEO / State',
      when: age === 0 ? 'Submitted today' : `Waiting ${age} day${age === 1 ? '' : 's'}`,
      scope: blockNames.get(q.case.block_id) ?? q.case.block_id,
      href: `/cases/${q.case.id}#plan`, action: 'Review plan', sources: [q.case.id, ...(q.approval ? [q.approval.id] : [])],
    });
  }

  // 2. Work past its deadline — escalated, or more than a week late.
  const overdue = listTasks(s, { overdue: true, limit: 200 });
  const late = overdue.filter((t) => t.escalated_at || days(t.due_date) >= 7).sort((a, b) => a.due_date.localeCompare(b.due_date));
  // One item per case, so five late tasks on the same case read as one problem.
  const lateByCase = new Map<string, typeof late>();
  for (const t of late) lateByCase.set(t.case_id, [...(lateByCase.get(t.case_id) ?? []), t]);
  for (const [caseId, list] of [...lateByCase.entries()].slice(0, 5)) {
    const worst = list[0];
    const d = days(worst.due_date);
    const escalated = list.filter((t) => t.escalated_at).length;
    const roles = [...new Set(list.map((t) => t.owner_role.toUpperCase()))].join(', ');
    items.push({
      id: `ov-${caseId}`, kind: 'overdue',
      priority: d >= 14 ? 'critical' : 'high',
      title: list.length === 1 ? `${caseId}: ${worst.title_en}` : `${caseId}: ${list.length} tasks overdue`,
      detail: list.length === 1
        ? (worst.escalated_at ? 'Escalated to the district.' : 'Past the 7-day escalation line.')
        : `${list.slice(0, 2).map((t) => t.title_en).join('; ')}${list.length > 2 ? ` and ${list.length - 2} more` : ''}.${escalated ? ` ${escalated} escalated to the district.` : ''}`,
      owner: roles,
      when: `Oldest ${d} days overdue`,
      scope: worst.school_id ?? '',
      href: list.length === 1 ? `/tasks/${worst.id}` : `/cases/${caseId}#work`, action: list.length === 1 ? 'Open task' : 'Open case work',
      sources: [caseId, ...list.map((t) => t.id)],
    });
  }

  // 3. Proof waiting on someone other than its submitter.
  const proof = may(s, 'evidence.verify') ? evidenceToCheck(s, { limit: 200 }) : [];
  const byCase = new Map<string, typeof proof>();
  for (const e of proof) byCase.set(e.case_id, [...(byCase.get(e.case_id) ?? []), e]);
  for (const [caseId, list] of [...byCase.entries()].slice(0, 4)) {
    const oldest = list.reduce((m, e) => (e.submitted_at < m ? e.submitted_at : m), list[0].submitted_at);
    const age = days(oldest);
    items.push({
      id: `ev-${caseId}`, kind: 'evidence', priority: age > 7 ? 'high' : 'medium',
      title: `Verify ${list.length} proof submission${list.length === 1 ? '' : 's'} for ${caseId}`,
      detail: 'Delivery cannot count until someone other than the submitter accepts it.',
      owner: 'BEO / BRC',
      when: age === 0 ? 'Submitted today' : `Oldest waiting ${age} day${age === 1 ? '' : 's'}`,
      scope: '', href: `/cases/${caseId}#proof`, action: 'Check proof', sources: list.map((e) => e.id),
    });
  }

  // 4. Delivered, but the next round did not show the gain.
  const outcomes = outcomesToReview(s, { limit: 50 }).filter((o) => ['below_target', 'no_change', 'worsened', 'inconclusive'].includes(o.outcome.category));
  for (const o of outcomes.slice(0, 4)) {
    items.push({
      id: `ng-${o.outcome.id}`, kind: 'no_gain',
      priority: o.outcome.category === 'worsened' ? 'critical' : 'high',
      title: `${o.outcome.case_id}: work delivered, gain not demonstrated`,
      detail: `Outcome check: ${o.outcome.category.replace(/_/g, ' ')}${o.outcome.did_pp !== null ? `, ${o.outcome.did_pp > 0 ? '+' : ''}${o.outcome.did_pp.toFixed(1)} pp vs comparison` : ''}. Review and decide whether to reopen.`,
      owner: 'BEO / DEO', when: `Evaluated ${days(o.outcome.evaluated_at)} days ago`,
      scope: o.case ? blockNames.get(o.case.block_id) ?? '' : '',
      href: `/cases/${o.outcome.case_id}#outcome`, action: 'Review outcome', sources: [o.outcome.id, o.outcome.case_id],
    });
  }

  // 5. Investigations that have stalled.
  const stalled = listCases(s, { status: ['under_investigation'], limit: 50, order: 'oldest' }).filter((c) => days(c.updated_at) > 10);
  for (const c of stalled.slice(0, 3)) {
    items.push({
      id: `in-${c.id}`, kind: 'investigation', priority: c.severity === 'critical' ? 'high' : 'medium',
      title: `${c.id} has been under investigation for ${days(c.created_at)} days`,
      detail: c.title, owner: 'BEO', when: `No update for ${days(c.updated_at)} days`,
      scope: blockNames.get(c.block_id) ?? '', href: `/cases/${c.id}#diagnosis`, action: 'Continue diagnosis', sources: [c.id],
    });
  }

  // 6. Candidate findings that data quality stopped from becoming cases (latest round).
  const latest = rounds().filter((r) => r.status === 'completed').at(-1);
  if (latest && may(s, 'case.view')) {
    const fp = and(findingsPred(s, 'f'), { sql: `f.status = 'rejected_data_quality' and f.round_id = ?`, params: [latest.id] });
    const dq = all<{ id: string }>(`select f.id from findings f where ${fp.sql}`, ...fp.params);
    if (dq.length > 0) {
      items.push({
        id: 'dq-latest', kind: 'data_quality', priority: 'medium',
        title: `${dq.length} possible decline${dq.length === 1 ? '' : 's'} blocked by data quality in ${latest.code}`,
        detail: 'Low participation or too few schools reporting. These are unknowns, not “no problem”.',
        owner: 'Data team / BEO', when: `${latest.label}`, scope: '',
        href: '/findings?status=rejected_data_quality', action: 'See findings', sources: dq.map((r) => r.id).slice(0, 10),
      });
    }
  }

  // 7. Complaints waiting on this user.
  const mine = listComplaints(s, { queue: 'mine', limit: 50 });
  for (const c of mine.slice(0, 4)) {
    const sla = slaState(c);
    items.push({
      id: `cm-${c.id}`, kind: 'complaint',
      priority: c.priority === 'critical' || sla.tone === 'crit' ? 'critical' : c.priority === 'high' || sla.tone === 'warn' ? 'high' : 'medium',
      title: c.title, detail: `${c.id} · complaint · ${CSTATUS[c.status]?.label ?? c.status}`,
      owner: 'You', when: sla.label || 'Open', scope: blockNames.get(c.block_id ?? '') ?? '',
      href: `/complaints?open=${c.id}`, action: ['submitted', 'escalated'].includes(c.status) ? 'Acknowledge' : 'Respond', sources: [c.id],
    });
  }

  const counts = { complaint: mine.length, approval: approvals.length, overdue: late.length, evidence: proof.length, no_gain: outcomes.length, data_quality: items.filter((i) => i.kind === 'data_quality').length, investigation: stalled.length };
  items.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return { items: items.slice(0, limit), counts };
}

// ---------------------------------------------------------------- activity
export interface ActivityItem { id: string; ts: string; caseId: string; text: string; actor: string; tone: 'good' | 'warn' | 'crit' | 'neutral' | 'brand' }

export function recentActivity(s: Session, limit = 8): ActivityItem[] {
  const p = and(casesPred(s, 'c'), { sql: 'e.ts <= ?', params: [nowIso()] });
  const rows = all<{ id: string; ts: string; case_id: string; kind: string; summary: string; from_status: string | null; to_status: string | null; actor_label: string }>(
    `select e.id, e.ts, e.case_id, e.kind, e.summary, e.from_status, e.to_status, e.actor_label
       from case_events e join cases c on c.id = e.case_id
      where ${p.sql} order by e.ts desc limit ?`,
    ...p.params, limit,
  );
  return rows.map((r) => {
    const to = r.to_status as CaseStatus | null;
    let text = r.summary;
    let tone: ActivityItem['tone'] = 'neutral';
    if (r.kind === 'status_changed' && to) {
      const label = STATUS_LABELS[to]?.en ?? to;
      text = `${r.case_id} moved to “${label}”`;
      tone = to === 'closed' ? 'good' : to === 'reopened' ? 'crit' : to === 'awaiting_approval' ? 'warn' : 'brand';
    } else if (r.kind === 'escalated') { tone = 'crit'; }
    else if (r.kind === 'outcome_evaluated') { tone = 'good'; }
    else if (r.kind === 'plan_drafted') { tone = 'brand'; }
    return { id: r.id, ts: r.ts, caseId: r.case_id, text, actor: r.actor_label, tone };
  });
}

// ---------------------------------------------------------------- trends
/** Pooled % proficient per completed round, for the user's schools and for the whole state. */
export function learningTrend(s: Session): { labels: string[]; scope: (number | null)[]; state: (number | null)[]; scopeLabel: string } {
  const done = rounds().filter((r) => r.status === 'completed');
  const sp = schoolsPred(s, 'sc');
  const mine = new Map(learningRows<{ round_id: string; pct: number }>(
    `select ar.round_id, 100.0 * sum(ar.n_proficient) / nullif(sum(ar.n_assessed), 0) pct
       from assessment_results ar join schools sc on sc.id = ar.school_id where ${sp.sql} group by ar.round_id`, ...sp.params,
  ).map((r) => [r.round_id, r.pct]));
  const state = new Map(learningRows<{ round_id: string; pct: number }>(
    `select round_id, 100.0 * sum(n_proficient) / nullif(sum(n_assessed), 0) pct from assessment_results group by round_id`,
  ).map((r) => [r.round_id, r.pct]));
  const r1 = (x: number | undefined) => (x === undefined || x === null ? null : Math.round(x * 10) / 10);
  return {
    labels: done.map((r) => `${r.code} · ${r.label.replace(/ \d{4}-\d{2}$/, '')}`),
    scope: done.map((r) => r1(mine.get(r.id))),
    state: done.map((r) => r1(state.get(r.id))),
    scopeLabel: scopeName(s.scope_type, s.scope_id),
  };
}

export function lifecycleCounts(s: Session): { status: CaseStatus; label: string; c: number }[] {
  const p = casesPred(s, 'c');
  const rows = all<{ status: CaseStatus; c: number }>(`select c.status, count(*) c from cases c where ${p.sql} group by c.status`, ...p.params);
  const order: CaseStatus[] = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened', 'closed', 'referred_pab', 'dismissed'];
  return order.map((st) => ({ status: st, label: STATUS_LABELS[st]?.en ?? st, c: Number(rows.find((r) => r.status === st)?.c ?? 0) })).filter((r) => r.c > 0);
}

export function deliveryProgress(s: Session): { verified: number; submitted: number; inProgress: number; notStarted: number; sentBack: number } {
  const p = and(casesPred(s, 'c'), { sql: `c.status in (${OPEN.map(() => '?').join(',')})`, params: OPEN });
  const rows = all<{ status: string; c: number }>(
    `select t.status, count(*) c from tasks t join cases c on c.id = t.case_id where ${p.sql} group by t.status`, ...p.params,
  );
  const g = (k: string) => Number(rows.find((r) => r.status === k)?.c ?? 0);
  return { verified: g('verified'), submitted: g('submitted'), inProgress: g('in_progress') + g('acknowledged'), notStarted: g('assigned'), sentBack: g('sent_back') };
}

// ---------------------------------------------------------------- status + summary
export interface SystemStatus { lastImport: string | null; clockMoved: boolean; demoDate: string; latestRound: string | null }

export function systemStatus(): SystemStatus {
  const last = one<{ t: string | null }>('select max(last_updated_at) t from datasets')?.t ?? null;
  const latest = rounds().filter((r) => r.status === 'completed').at(-1);
  return { lastImport: last, clockMoved: Date.parse(nowIso()) !== Date.parse(AS_OF_TS), demoDate: today(), latestRound: latest ? `${latest.code} · ${latest.label}` : null };
}

/** The compact, deterministic summary the AI briefing narrates. */
export interface OverviewSummary {
  scope: string;
  role: string;
  demoDate: string;
  headline: Headline;
  priorities: PriorityItem[];
  priorityCounts: Record<PriorityItem['kind'], number>;
  trend: ReturnType<typeof learningTrend>;
  lifecycle: ReturnType<typeof lifecycleCounts>;
  delivery: ReturnType<typeof deliveryProgress>;
  latestRound: string | null;
}

export function overviewSummary(s: Session): OverviewSummary {
  const pa = priorityActions(s, 10);
  return {
    scope: scopeName(s.scope_type, s.scope_id),
    role: s.role,
    demoDate: today(),
    headline: headline(s),
    priorities: pa.items,
    priorityCounts: pa.counts,
    trend: learningTrend(s),
    lifecycle: lifecycleCounts(s),
    delivery: deliveryProgress(s),
    latestRound: systemStatus().latestRound,
  };
}

// ---------------------------------------------------------------- progress timeline
export interface ProgressItem { id: string; ts: string; text: string; href: string; kind: 'approved' | 'evidence' | 'escalated' | 'reopened' | 'verified' | 'resolved' | 'other' }

/** Meaningful operational events — approvals, proof, escalations, reopenings, verified outcomes. */
export function recentProgress(s: Session, limit = 8): ProgressItem[] {
  const out: ProgressItem[] = [];
  const p = and(casesPred(s, 'c'), { sql: 'e.ts <= ?', params: [nowIso()] });
  for (const r of all<{ id: string; ts: string; case_id: string; kind: string; to_status: string | null; summary: string }>(
    `select e.id, e.ts, e.case_id, e.kind, e.to_status, e.summary from case_events e join cases c on c.id = e.case_id
      where ${p.sql} and (e.to_status in ('approved','closed','reopened','outcome_pending','awaiting_verification') or e.kind in ('outcome_evaluated','escalated'))
      order by e.ts desc limit ?`, ...p.params, limit * 8)) {
    const kind: ProgressItem['kind'] = r.to_status === 'approved' ? 'approved' : r.to_status === 'closed' ? 'verified' : r.to_status === 'reopened' ? 'reopened'
      : r.to_status === 'awaiting_verification' ? 'evidence' : r.kind === 'escalated' ? 'escalated' : r.kind === 'outcome_evaluated' ? 'verified' : 'other';
    const text = kind === 'approved' ? `Intervention approved on ${r.case_id}` : kind === 'verified' && r.to_status === 'closed' ? `${r.case_id} closed on a verified gain`
      : kind === 'verified' ? `Outcome evaluated for ${r.case_id}` : kind === 'reopened' ? `${r.case_id} reopened — no gain shown`
      : kind === 'evidence' ? `All proof submitted on ${r.case_id}` : kind === 'escalated' ? `Overdue task on ${r.case_id} escalated` : r.summary;
    out.push({ id: r.id, ts: r.ts, text, href: `/cases/${r.case_id}`, kind });
  }
  const kp = complaintsPred(s, 'k');
  for (const r of all<{ id: string; ts: string; complaint_id: string; kind: string }>(
    `select ce.id, ce.ts, ce.complaint_id, ce.kind from complaint_events ce join complaints k on k.id = ce.complaint_id
      where (${kp.sql}) and ce.internal = 0 and ce.kind in ('escalated','resolved','reopened') order by ce.ts desc limit ?`, ...kp.params, limit)) {
    out.push({ id: r.id, ts: r.ts, href: `/complaints?open=${r.complaint_id}`, kind: r.kind === 'escalated' ? 'escalated' : r.kind === 'resolved' ? 'resolved' : 'reopened',
      text: `Complaint ${r.complaint_id} ${r.kind === 'escalated' ? 'escalated' : r.kind === 'resolved' ? 'resolved' : 'reopened'}` });
  }
  // Variety over volume: one entry per case, and at most two escalations.
  const seen = new Set<string>();
  let esc = 0;
  return out.sort((a, b) => b.ts.localeCompare(a.ts)).filter((x) => {
    if (seen.has(x.href)) return false;
    if (x.kind === 'escalated' && ++esc > 2) return false;
    seen.add(x.href);
    return true;
  }).slice(0, limit);
}

/** A deterministic, non-AI brief built from the same summary the AI narrates. */
export interface PlainBrief { finding: string; changed: string; geography: string; concern: string; next: string; sources: string[] }
export function plainBrief(s: Session): PlainBrief {
  const pa = priorityActions(s, 10);
  const t = learningTrend(s);
  const h = headline(s);
  const last = t.scope.length - 1;
  const likeForLike = last >= 2 && t.scope[last] !== null && t.scope[last - 2] !== null ? (t.scope[last]! - t.scope[last - 2]!) : null;
  const top = pa.items[0];
  return {
    finding: top ? `${top.title}.` : 'Nothing urgent is waiting on you.',
    changed: likeForLike === null ? 'Not enough comparable rounds to compare.' : `${t.labels[last]}: ${t.scope[last]}% proficient, ${likeForLike >= 0 ? 'up' : 'down'} ${Math.abs(likeForLike).toFixed(1)} pp on the same round last year${t.state[last] !== null ? ` (state ${t.state[last]}%)` : ''}.`,
    geography: `${h.critical} critical case${h.critical === 1 ? '' : 's'} open across ${t.scopeLabel}.`,
    concern: h.overdue_tasks ? `${h.overdue_tasks} overdue task${h.overdue_tasks === 1 ? '' : 's'}, ${h.escalated_tasks} escalated to the district.` : 'No overdue work.',
    next: top ? `${top.action}: ${top.title}` : 'Review the learning hotspots for new declines.',
    sources: pa.items.flatMap((i) => i.sources).slice(0, 8),
  };
}
