import 'server-only';
import { all, one, type Param } from './db';
import { and, casesPred, tasksPred, evidencePred, findingsPred, type Pred } from './scope';
import type { Session } from './session';
import { independentOf } from './duty';
import { today } from './clock';

/**
 * Dashboard rollups. One query per panel rather than N+1 per row, and every one of them goes
 * through the same scope predicates as the detail pages — a BEO's "district overview" would be
 * their block and nothing else, which is why these are grouped rather than totalled blindly.
 */

const OPEN = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];

export interface Rollup {
  id: string;
  name: string;
  open_cases: number;
  critical: number;
  awaiting_approval: number;
  closed: number;
  reopened: number;
  overdue_tasks: number;
  evidence_pending: number;
}

function rollup(s: Session, level: 'block' | 'district' | 'cluster', parent?: { districtId?: string; blockId?: string }): Rollup[] {
  const table = level === 'block' ? 'blocks' : level === 'district' ? 'districts' : 'clusters';
  const col = `${level}_id`;
  const parts: Pred[] = [casesPred(s, 'c')];
  if (parent?.districtId) parts.push({ sql: 'c.district_id = ?', params: [parent.districtId] });
  if (parent?.blockId) parts.push({ sql: 'c.block_id = ?', params: [parent.blockId] });
  const p = and(...parts);

  const cases = all<{
    gid: string; open_cases: number; critical: number; awaiting_approval: number;
    closed: number; reopened: number;
  }>(
    `select c.${col} as gid,
            sum(case when c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) as open_cases,
            sum(case when c.severity = 'critical' and c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) as critical,
            sum(case when c.status = 'awaiting_approval' then 1 else 0 end) as awaiting_approval,
            sum(case when c.status = 'closed' then 1 else 0 end) as closed,
            sum(case when c.reopen_count > 0 then 1 else 0 end) as reopened
       from cases c where ${p.sql} group by c.${col}`,
    ...OPEN, ...OPEN, ...p.params,
  );

  const tp = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  const overdue = all<{ gid: string; c: number }>(
    `select tc.${col} as gid, count(*) c from tasks t join cases tc on tc.id = t.case_id
      where ${tp.sql} group by tc.${col}`,
    ...tp.params,
  );

  const ep = and(evidencePred(s, 'e'), { sql: `e.status = 'pending'`, params: [] });
  const pendingEvidence = all<{ gid: string; c: number }>(
    `select ec.${col} as gid, count(*) c from evidence e join cases ec on ec.id = e.case_id
      where ${ep.sql} group by ec.${col}`,
    ...ep.params,
  );

  const names = new Map(
    all<{ id: string; name: string }>(`select id, name from "${table}"`).map((r) => [r.id, r.name]),
  );

  const ids = new Set<string>([...cases.map((r) => r.gid), ...overdue.map((r) => r.gid), ...pendingEvidence.map((r) => r.gid)]);
  return [...ids]
    .filter(Boolean)
    .map((id) => {
      const c = cases.find((r) => r.gid === id);
      return {
        id,
        name: names.get(id) ?? id,
        open_cases: Number(c?.open_cases ?? 0),
        critical: Number(c?.critical ?? 0),
        awaiting_approval: Number(c?.awaiting_approval ?? 0),
        closed: Number(c?.closed ?? 0),
        reopened: Number(c?.reopened ?? 0),
        overdue_tasks: Number(overdue.find((r) => r.gid === id)?.c ?? 0),
        evidence_pending: Number(pendingEvidence.find((r) => r.gid === id)?.c ?? 0),
      };
    })
    .sort((a, b) => b.critical - a.critical || b.open_cases - a.open_cases || a.name.localeCompare(b.name));
}

export const blockRollup = (s: Session, districtId?: string): Rollup[] =>
  rollup(s, 'block', { districtId });
export const districtRollup = (s: Session): Rollup[] => rollup(s, 'district');
export const clusterRollup = (s: Session, blockId?: string): Rollup[] =>
  rollup(s, 'cluster', { blockId });

/** Headline counts for whatever the signed-in user can see. */
export interface Headline {
  open_cases: number;
  critical: number;
  awaiting_approval: number;
  outcome_pending: number;
  closed_verified: number;
  reopened: number;
  overdue_tasks: number;
  escalated_tasks: number;
  evidence_pending: number;
  my_tasks: number;
}

export function headline(s: Session): Headline {
  const cp = casesPred(s, 'c');
  const c = one<{
    open_cases: number; critical: number; awaiting_approval: number; outcome_pending: number;
    closed_verified: number; reopened: number;
  }>(
    `select
       sum(case when c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) open_cases,
       sum(case when c.severity = 'critical' and c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) critical,
       sum(case when c.status = 'awaiting_approval' then 1 else 0 end) awaiting_approval,
       sum(case when c.status = 'outcome_pending' then 1 else 0 end) outcome_pending,
       sum(case when c.status = 'closed' then 1 else 0 end) closed_verified,
       sum(case when c.reopen_count > 0 then 1 else 0 end) reopened
     from cases c where ${cp.sql}`,
    ...OPEN, ...OPEN, ...cp.params,
  );

  const tOverdue = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  const tEsc = and(tasksPred(s, 't'), { sql: 't.escalated_at is not null and t.submitted_at is null', params: [] });
  const ePend = and(
    evidencePred(s, 'e'),
    { sql: `e.status = 'pending'`, params: [] },
    independentOf(s.user_id, 'e'),
  );

  return {
    open_cases: Number(c?.open_cases ?? 0),
    critical: Number(c?.critical ?? 0),
    awaiting_approval: Number(c?.awaiting_approval ?? 0),
    outcome_pending: Number(c?.outcome_pending ?? 0),
    closed_verified: Number(c?.closed_verified ?? 0),
    reopened: Number(c?.reopened ?? 0),
    overdue_tasks: Number(one<{ c: number }>(`select count(*) c from tasks t where ${tOverdue.sql}`, ...tOverdue.params)?.c ?? 0),
    escalated_tasks: Number(one<{ c: number }>(`select count(*) c from tasks t where ${tEsc.sql}`, ...tEsc.params)?.c ?? 0),
    evidence_pending: Number(one<{ c: number }>(`select count(*) c from evidence e where ${ePend.sql}`, ...ePend.params)?.c ?? 0),
    my_tasks: Number(one<{ c: number }>(
      `select count(*) c from tasks where owner_user_id = ? and status in ('assigned','acknowledged','in_progress','sent_back')`,
      s.user_id,
    )?.c ?? 0),
  };
}

/** How cases ended, for the "does this actually work" panel. */
export function closureMix(s: Session): { category: string; c: number }[] {
  const p = casesPred(s, 'c');
  return all<{ category: string; c: number }>(
    `select coalesce(c.closure_type, 'not_closed') category, count(*) c
       from cases c where (${p.sql}) and c.status = 'closed' group by category order by c desc`,
    ...p.params,
  );
}

export function outcomeMix(s: Session): { category: string; c: number }[] {
  const pred = casesPred(s, 'oc');
  return all<{ category: string; c: number }>(
    `select oe.category, count(*) c from outcome_evaluations oe
       join cases oc on oc.id = oe.case_id
      where ${pred.sql} group by oe.category order by c desc`,
    ...pred.params,
  );
}

/** Detection health: how many candidates became cases, and how many were refused and why. */
export function detectionHealth(s: Session): { status: string; c: number }[] {
  const p = findingsPred(s, 'f');
  return all<{ status: string; c: number }>(
    `select f.status, count(*) c from findings f where ${p.sql} group by f.status order by c desc`,
    ...p.params,
  );
}

/** Median days from a case opening to its closure, for the cases that did close. */
export function timeToClose(s: Session): { closed: number; medianDays: number | null } {
  const p = casesPred(s, 'c');
  const rows = all<{ days: number }>(
    `select cast(julianday(c.closed_at) - julianday(c.created_at) as integer) days
       from cases c where (${p.sql}) and c.status = 'closed' and c.closed_at is not null
      order by days`,
    ...p.params,
  );
  if (rows.length === 0) return { closed: 0, medianDays: null };
  const mid = Math.floor(rows.length / 2);
  const median = rows.length % 2 === 0
    ? Math.round((rows[mid - 1].days + rows[mid].days) / 2)
    : rows[mid].days;
  return { closed: rows.length, medianDays: median };
}
