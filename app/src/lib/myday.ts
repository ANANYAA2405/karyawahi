import 'server-only';
import { all, inList } from './db';
import type { Session } from './session';
import { listTasks, type Task } from './cases';
import { listComplaints, type Complaint } from './complaints';
import { schoolsPred } from './scope';
import { today, addDays, daysBetween } from './clock';

/**
 * My day: a field worker's work, in the order they should do it.
 *
 * Proof that was sent back comes first (someone is waiting on it, and the reason is shown), then
 * anything late, then what is due today, this week and later. Proof already handed in is listed
 * last, so the worker can see it is with the checker and not lost. Coordinators also see the
 * schools in their area that have gone longest without a visit, and everyone sees complaints
 * that are waiting on them.
 */

export type DayGroupKey = 'sent_back' | 'overdue' | 'today' | 'week' | 'later' | 'waiting';

export interface DayTask extends Task {
  /** Why the last piece of proof was sent back, when it was. */
  rejection: string | null;
  /** Pieces of proof handed in that still count (rejected ones do not). */
  pieces: number;
  caseTitle: string;
  /** Days until due; negative when late. */
  dueIn: number;
  isNew: boolean;
}

export interface MyDay {
  date: string;
  groups: { key: DayGroupKey; tasks: DayTask[] }[];
  /** Things to act on today: sent back, late, or due today. */
  urgent: number;
  open: number;
  visits: { id: string; name: string; last: string | null; days: number | null }[] | null;
  complaints: Complaint[];
}

const OPEN: Task['status'][] = ['assigned', 'acknowledged', 'in_progress', 'sent_back'];

export function myDay(s: Session): MyDay {
  const d = today();
  const week = addDays(d, 7);
  const mine = listTasks(s, { ownerUserId: s.user_id, status: [...OPEN, 'submitted'], limit: 200 });

  // Proof counts, the latest reason for a send-back, and case titles: three queries for the
  // whole list rather than three per task. These tasks are the reader's own (listTasks applied
  // the scope), so the lookups are keyed by their ids only.
  const taskIds = mine.map((t) => t.id);
  const caseIds = [...new Set(mine.map((t) => t.case_id))];
  const pieces = new Map<string, number>();
  const rejection = new Map<string, string | null>();
  const titles = new Map<string, string>();
  const tl = inList(taskIds);
  if (tl) {
    for (const r of all<{ task_id: string; c: number }>(
      `select task_id, count(*) c from evidence where task_id in (${tl.clause}) and status <> 'rejected' group by task_id`, ...tl.params,
    )) pieces.set(r.task_id, Number(r.c));
    // Newest rejection first, so the first row seen for a task is the one to show.
    for (const r of all<{ task_id: string; r: string | null }>(
      `select task_id, rejection_reason r from evidence where task_id in (${tl.clause}) and status = 'rejected'
        order by task_id, verified_at desc`, ...tl.params,
    )) if (!rejection.has(r.task_id)) rejection.set(r.task_id, r.r);
  }
  const cl = inList(caseIds);
  if (cl) for (const r of all<{ id: string; title: string }>(`select id, title from cases where id in (${cl.clause})`, ...cl.params)) titles.set(r.id, r.title);

  const enrich = (t: Task): DayTask => ({
    ...t,
    rejection: t.status === 'sent_back' ? rejection.get(t.id) ?? null : null,
    pieces: pieces.get(t.id) ?? 0,
    caseTitle: titles.get(t.case_id) ?? t.case_id,
    dueIn: daysBetween(d, t.due_date),
    isNew: t.status === 'assigned',
  });
  const tasks = mine.map(enrich);
  const open = tasks.filter((t) => t.status !== 'submitted');
  const bucket = (t: DayTask): DayGroupKey =>
    t.status === 'submitted' ? 'waiting'
    : t.status === 'sent_back' ? 'sent_back'
    : t.due_date < d ? 'overdue'
    : t.due_date === d ? 'today'
    : t.due_date <= week ? 'week'
    : 'later';
  const order: DayGroupKey[] = ['sent_back', 'overdue', 'today', 'week', 'later', 'waiting'];
  const groups = order
    .map((key) => ({ key, tasks: tasks.filter((t) => bucket(t) === key).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id)) }))
    .filter((g) => g.tasks.length > 0);

  // Visits are a coordinator's job; a headmaster is visited, not visiting.
  const visiting = s.roles.some((r) => r.role === 'crc' || r.role === 'brc');
  const sp = schoolsPred(s, 'sc');
  const visits = visiting
    ? all<{ id: string; name: string; last: string | null }>(
      `select sc.id, sc.name, (select max(v.visit_date) from visits v where v.school_id = sc.id) last
         from schools sc where ${sp.sql} order by last is not null, last asc, sc.id limit 5`, ...sp.params,
    ).map((v) => ({ ...v, days: v.last ? daysBetween(v.last, d) : null }))
    : null;

  return {
    date: d,
    groups,
    urgent: open.filter((t) => ['sent_back', 'overdue', 'today'].includes(bucket(t))).length,
    open: open.length,
    visits,
    complaints: listComplaints(s, { queue: 'mine', limit: 5 }),
  };
}
