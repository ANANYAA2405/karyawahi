import 'server-only';
import { all, one, run, tx, j, getAppState, setAppState, nextIdFor } from './db';
import { and, canSeeCase, tasksPred, type Pred } from './scope';
import type { Session } from './session';
import { nowIso, today, daysBetween } from './clock';
import { taskById, getCase } from './cases';
import { may, grant, actingRole, Refused } from './guard';
import { appendAudit } from './write';

/**
 * Blocker intelligence. A structured record of *why* work is stuck, so the pattern is visible
 * ("six tasks blocked on the same missing kit") rather than buried in free text.
 *
 * The seed has no blockers table, so this module owns one in the app's SQLite copy, created on
 * first use. It is back-filled once from reasons the seed already records — deadline changes
 * and task reassignments — and every such row is labelled `derived_from_seed` with the source
 * task, so nothing is presented as more than it is. New blockers are reported by officers and
 * written to the audit chain like every other action.
 */

export const BLOCKER_TYPES = [
  { key: 'staff_unavailable', label: 'Staff unavailable', hi: 'कर्मचारी उपलब्ध नहीं', level: 'block', fix: 'Reassign within the cluster or request a temporary deputation (INT-11).' },
  { key: 'budget_unavailable', label: 'Budget unavailable', hi: 'बजट उपलब्ध नहीं', level: 'district', fix: 'Raise with the DEO for release from the block contingency head.' },
  { key: 'materials_unavailable', label: 'Teaching materials unavailable', hi: 'शिक्षण सामग्री उपलब्ध नहीं', level: 'block', fix: 'Request kits from the BRC store or a neighbouring block.' },
  { key: 'training_incomplete', label: 'Training incomplete', hi: 'प्रशिक्षण अधूरा', level: 'block', fix: 'Schedule a make-up orientation with the BRC before delivery starts.' },
  { key: 'school_closure', label: 'School closure', hi: 'विद्यालय बंद', level: 'block', fix: 'Extend the deadline by the closure length; record the reason.' },
  { key: 'low_attendance', label: 'Low attendance', hi: 'कम उपस्थिति', level: 'block', fix: 'Pair with an attendance follow-up drive (INT-09) before continuing.' },
  { key: 'connectivity', label: 'Connectivity issues', hi: 'नेटवर्क की समस्या', level: 'block', fix: 'Allow offline submission and sync at the cluster resource centre.' },
  { key: 'approval_pending', label: 'Administrative approval pending', hi: 'प्रशासनिक स्वीकृति लंबित', level: 'district', fix: 'Escalate to the approving officer with the case reference.' },
  { key: 'unreasonable_deadline', label: 'Unreasonable deadline', hi: 'अव्यावहारिक समय-सीमा', level: 'block', fix: 'Reset the deadline with a written reason (audited).' },
  { key: 'external_dependency', label: 'External dependency', hi: 'बाहरी निर्भरता', level: 'district', fix: 'Name the dependency owner and set a follow-up date.' },
] as const;

export type BlockerType = (typeof BLOCKER_TYPES)[number]['key'];
export const blockerMeta = (k: string) => BLOCKER_TYPES.find((b) => b.key === k) ?? BLOCKER_TYPES[BLOCKER_TYPES.length - 1];

export interface Blocker {
  id: string;
  case_id: string;
  task_ids: string[];
  school_id: string | null;
  blocker_type: BlockerType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  reported_by: string;
  reported_role: string;
  reported_at: string;
  status: 'open' | 'escalated' | 'resolved';
  responsible_level: 'block' | 'district' | 'state';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  source: 'officer' | 'derived_from_seed';
}

const SEED_MAP: Record<string, BlockerType> = {
  'Clash with the assessment week': 'external_dependency',
  'Dussehra holidays fall in the task window': 'school_closure',
  'Heavy rain closed the school for four days': 'school_closure',
  'Teacher on election duty for a week': 'staff_unavailable',
  'BRC deputed to election duty': 'staff_unavailable',
  'CRC on medical leave; neighbouring CRC covers': 'staff_unavailable',
};

let ensured = false;
export function ensureBlockers(): void {
  if (ensured && one<{ n: string }>(`select name n from sqlite_master where type='table' and name='blockers'`)) return;
  run(`create table if not exists blockers (
    id text primary key, case_id text not null, task_ids text not null default '[]', school_id text,
    blocker_type text not null, severity text not null, description text not null,
    reported_by text not null, reported_role text not null, reported_at text not null,
    status text not null, responsible_level text not null,
    resolution text, resolved_by text, resolved_at text, source text not null
  )`);
  run('create index if not exists blockers_case on blockers(case_id)');
  if (getAppState('blockers_backfilled') !== '1') {
    tx(() => {
      const rows = all<{ id: string; case_id: string; school_id: string | null; owner_user_id: string; owner_role: string; submitted_at: string | null; due_date: string; assigned_at: string; deadline_change_reason: string | null; reassign_reason: string | null }>(
        `select id, case_id, school_id, owner_user_id, owner_role, submitted_at, due_date, assigned_at, deadline_change_reason, reassign_reason
           from tasks where deadline_change_reason is not null or reassign_reason is not null order by id`,
      );
      let n = 0;
      for (const t of rows) {
        for (const reason of [t.deadline_change_reason, t.reassign_reason]) {
          if (!reason) continue;
          const type = SEED_MAP[reason] ?? 'external_dependency';
          n++;
          const resolved = Boolean(t.submitted_at);
          run(
            `insert into blockers values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            `BLKR-${String(n).padStart(5, '0')}`, t.case_id, JSON.stringify([t.id]), t.school_id,
            type, type === 'staff_unavailable' ? 'high' : 'medium',
            `${reason} (recorded on ${t.id} when its ${t.reassign_reason === reason ? 'owner was changed' : 'deadline was moved'})`,
            t.owner_user_id, t.owner_role, t.assigned_at, resolved ? 'resolved' : 'open', blockerMeta(type).level,
            resolved ? 'Task was later submitted' : null, null, resolved ? t.submitted_at : null, 'derived_from_seed',
          );
        }
      }
      setAppState('blockers_backfilled', '1');
    });
  }
  ensured = true;
}

const toBlocker = (r: Record<string, unknown>): Blocker => ({ ...(r as unknown as Blocker), task_ids: j(r.task_ids, [] as string[]) });

export function listBlockers(s: Session, f: { open?: boolean; caseId?: string; type?: string; limit?: number } = {}): Blocker[] {
  ensureBlockers();
  const parts: Pred[] = [canSeeCase(s, 'b.case_id')];
  if (f.open) parts.push({ sql: `b.status in ('open','escalated')`, params: [] });
  if (f.caseId) parts.push({ sql: 'b.case_id = ?', params: [f.caseId] });
  if (f.type) parts.push({ sql: 'b.blocker_type = ?', params: [f.type] });
  const p = and(...parts);
  return all<Record<string, unknown>>(
    `select b.* from blockers b where ${p.sql}
      order by case b.status when 'escalated' then 0 when 'open' then 1 else 2 end,
               case b.severity when 'high' then 0 when 'medium' then 1 else 2 end, b.reported_at desc
      limit ?`, ...p.params, f.limit ?? 100,
  ).map(toBlocker);
}

export function blockerSummary(s: Session) {
  const open = listBlockers(s, { open: true, limit: 1000 });
  const byType = new Map<string, { n: number; tasks: Set<string>; oldest: string }>();
  for (const b of open) {
    const e = byType.get(b.blocker_type) ?? { n: 0, tasks: new Set<string>(), oldest: b.reported_at };
    e.n++; b.task_ids.forEach((t) => e.tasks.add(t));
    if (b.reported_at < e.oldest) e.oldest = b.reported_at;
    byType.set(b.blocker_type, e);
  }
  return {
    open: open.length,
    escalated: open.filter((b) => b.status === 'escalated').length,
    byType: [...byType.entries()].map(([type, e]) => ({ type, label: blockerMeta(type).label, n: e.n, tasks: e.tasks.size, oldestDays: daysBetween(e.oldest.slice(0, 10), today()), fix: blockerMeta(type).fix, level: blockerMeta(type).level }))
      .sort((a, b) => b.n - a.n),
  };
}

// ---------------------------------------------------------------- writes
export function reportBlocker(s: Session, input: { taskId: string; type: string; severity: string; description: string }): string {
  ensureBlockers();
  const t = taskById(s, input.taskId);
  if (!t) throw new Refused('That task is not in your scope.', 'scope');
  const own = t.owner_user_id === s.user_id;
  if (!own && grant(s, 'task.assign') !== 'yes') throw new Refused('Only the task owner or the block/district officer can report a blocker on this task.', 'role');
  const meta = BLOCKER_TYPES.find((b) => b.key === input.type);
  if (!meta) throw new Refused('Choose a blocker type.', 'input');
  const severity = ['high', 'medium', 'low'].includes(input.severity) ? input.severity : 'medium';
  const description = input.description.trim().slice(0, 600);
  if (description.length < 8) throw new Refused('Describe the blocker in a sentence (8+ characters).', 'input');

  return tx(() => {
    const id = nextIdFor('blocker', 'blockers', 'BLKR-', 5);
    run(`insert into blockers values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, t.case_id, JSON.stringify([t.id]), t.school_id, meta.key, severity, description,
      s.user_id, actingRole(s), nowIso(), 'open', meta.level, null, null, null, 'officer');
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s), action: 'blocker.report', entityType: 'blocker', entityId: id, after: { task_id: t.id, case_id: t.case_id, type: meta.key, severity }, reason: description });
    return id;
  });
}

export function updateBlocker(s: Session, id: string, action: 'escalate' | 'resolve', note: string): void {
  ensureBlockers();
  const p = and(canSeeCase(s, 'b.case_id'), { sql: 'b.id = ?', params: [id] });
  const b = one<Record<string, unknown>>(`select b.* from blockers b where ${p.sql}`, ...p.params);
  if (!b) throw new Refused('That blocker is not in your scope.', 'scope');
  const blocker = toBlocker(b);
  if (blocker.status === 'resolved') throw new Refused('This blocker is already resolved.', 'state');
  if (!may(s, 'task.assign') || grant(s, 'task.assign') !== 'yes') {
    if (!(action === 'resolve' && blocker.reported_by === s.user_id)) {
      throw new Refused('Only a block or district officer can escalate or resolve blockers (the reporter may resolve their own).', 'role');
    }
  }
  const text = note.trim().slice(0, 600);
  if (text.length < 5) throw new Refused('A written note is required.', 'input');
  if (!getCase(s, blocker.case_id)) throw new Refused('Case not in scope.', 'scope');
  tx(() => {
    if (action === 'escalate') {
      run(`update blockers set status = 'escalated', responsible_level = case responsible_level when 'block' then 'district' else 'state' end, resolution = ? where id = ?`, `Escalated: ${text}`, id);
    } else {
      run(`update blockers set status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? where id = ?`, text, s.user_id, nowIso(), id);
    }
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s), action: `blocker.${action}`, entityType: 'blocker', entityId: id, before: { status: blocker.status }, after: { status: action === 'escalate' ? 'escalated' : 'resolved' }, reason: text });
  });
}

// ---------------------------------------------------------------- workload
export interface WorkloadRow { user_id: string; name: string; role: string; open: number; overdue: number; escalated: number; sentBack: number; dueThisWeek: number; flags: string[] }

/** Task load per officer in scope, with plain flags. It never reassigns anything itself. */
export function workload(s: Session): WorkloadRow[] {
  const p = and(tasksPred(s, 't'), { sql: `t.status in ('assigned','acknowledged','in_progress','sent_back','submitted')`, params: [] });
  const d = today();
  const rows = all<{ user_id: string; name: string; role: string; open: number; overdue: number; escalated: number; sent_back: number; due_week: number }>(
    `select t.owner_user_id user_id, u.full_name name, t.owner_role role, count(*) open,
            sum(case when t.submitted_at is null and t.due_date < ? then 1 else 0 end) overdue,
            sum(case when t.escalated_at is not null and t.submitted_at is null then 1 else 0 end) escalated,
            sum(case when t.status = 'sent_back' then 1 else 0 end) sent_back,
            sum(case when t.submitted_at is null and t.due_date >= ? and t.due_date <= date(?, '+7 day') then 1 else 0 end) due_week
       from tasks t join users u on u.id = t.owner_user_id
      where ${p.sql} group by t.owner_user_id order by open desc`,
    d, d, d, ...p.params,
  );
  const mean = rows.length ? rows.reduce((t, r) => t + Number(r.open), 0) / rows.length : 0;
  return rows.map((r) => {
    const flags: string[] = [];
    if (Number(r.open) >= Math.max(6, mean * 2)) flags.push('Carrying over twice the average load');
    if (Number(r.overdue) >= 3) flags.push('Repeatedly overdue');
    if (Number(r.due_week) >= 4) flags.push('4+ deadlines this week');
    if (Number(r.sent_back) >= 2) flags.push('Proof sent back more than once');
    return { user_id: r.user_id, name: r.name, role: r.role, open: Number(r.open), overdue: Number(r.overdue), escalated: Number(r.escalated), sentBack: Number(r.sent_back), dueThisWeek: Number(r.due_week), flags };
  });
}
