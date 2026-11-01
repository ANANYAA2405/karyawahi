import 'server-only';
import { all } from './db';
import type { Session } from './session';
import { canSeeSchool, staffEventsPred } from './scope';
import { today, addDays, daysBetween } from './clock';

/**
 * Where each school stands right now, beyond its test scores: teachers missing, how long since
 * anyone visited, whether attendance is falling, and work running late. These are conditions
 * the diagnosis already treats as associated with learning drops; the map shows them so an
 * officer can see them before the next assessment round does.
 *
 * Every condition gets a level on the same scale the map already colours by (critical,
 * significant, moderate, stable, insufficient), using fixed, stated thresholds. They describe
 * what is happening; they do not predict a learning result.
 */

export type Level = 'critical' | 'significant' | 'moderate' | 'stable' | 'insufficient';

export interface SchoolNow {
  enrolment: number;
  teachers: { sanctioned: number; inPosition: number; short: number };
  /** Teachers who left in the last 180 days, less those who joined; null when the reader may
   *  not see staff movements (headmasters). */
  netTransfersOut: number | null;
  lastVisit: string | null;
  daysSinceVisit: number | null;
  attendance: { recent: number | null; before: number | null; change: number | null; months: string[] };
  teacherLevel: Level;
  visitLevel: Level;
  attendanceLevel: Level;
}

/** The thresholds, stated once so the legend and the code cannot drift apart. */
export const THRESHOLDS = {
  teachers: 'Short of sanctioned posts: 2 or more, or half the posts = critical; 1 = significant; a teacher left in the last 6 months without a replacement = moderate',
  visits: 'Days since the last visit: over 90 or never = critical; 61–90 = significant; 31–60 = moderate; 30 or fewer = fine',
  attendance: 'Average attendance, last 3 months against the 3 before: down 10 points or more = critical; 5–10 = significant; 2–5 = moderate',
} as const;

export function teacherLevel(t: { sanctioned: number; inPosition: number }, netOut: number | null): Level {
  const short = Math.max(0, t.sanctioned - t.inPosition);
  if (t.sanctioned === 0) return 'insufficient';
  if (short >= 2 || short / t.sanctioned >= 0.5) return 'critical';
  if (short === 1) return 'significant';
  if ((netOut ?? 0) > 0) return 'moderate';
  return 'stable';
}

export function visitLevel(days: number | null): Level {
  if (days === null || days > 90) return 'critical';
  if (days > 60) return 'significant';
  if (days > 30) return 'moderate';
  return 'stable';
}

export function attendanceLevel(change: number | null): Level {
  if (change === null) return 'insufficient';
  if (change <= -10) return 'critical';
  if (change <= -5) return 'significant';
  if (change <= -2) return 'moderate';
  return 'stable';
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** The situation for each of these schools the reader can see. Schools out of scope are left out. */
export function schoolsNow(s: Session, schoolIds: readonly string[]): Map<string, SchoolNow> {
  const out = new Map<string, SchoolNow>();
  if (schoolIds.length === 0) return out;
  const d = today();
  const ids = [...schoolIds];
  const inIds = `(${ids.map(() => '?').join(',')})`;
  const seeSchool = canSeeSchool(s, 'sc.id');

  const base = all<{ id: string; g1: number; g2: number; g3: number; sanctioned: number; in_position: number }>(
    `select sc.id, sc.enrolment_g1 g1, sc.enrolment_g2 g2, sc.enrolment_g3 g3, sc.teachers_sanctioned sanctioned, sc.teachers_in_position in_position
       from schools sc where sc.id in ${inIds} and (${seeSchool.sql})`, ...ids, ...seeSchool.params,
  );
  if (base.length === 0) return out;
  const visible = base.map((b) => b.id);
  const vis = `(${visible.map(() => '?').join(',')})`;

  // Staff movements are refused to some roles; the rule lives in scope.ts, not here.
  const staff = staffEventsPred(s, 'se');
  const moves = staff.sql === '1=0' ? null : new Map(all<{ id: string; net: number }>(
    `select se.school_id id, sum(case when se.event_type = 'transfer_out' then 1 when se.event_type = 'joined' then -1 else 0 end) net
       from staff_events se where se.school_id in ${vis} and se.event_date >= ? and se.event_date <= ? and (${staff.sql})
      group by se.school_id`, ...visible, addDays(d, -180), d, ...staff.params,
  ).map((r) => [r.id, Number(r.net)]));

  const visits = new Map(all<{ id: string; last: string }>(
    `select school_id id, max(visit_date) last from visits where school_id in ${vis} and visit_date <= ? group by school_id`, ...visible, d,
  ).map((r) => [r.id, r.last]));

  // The six most recent months with data, newest first.
  const months = all<{ month: string }>(
    `select distinct month from attendance_monthly where school_id in ${vis} and month <= ? order by month desc limit 6`, ...visible, d.slice(0, 7),
  ).map((r) => r.month);
  const att = new Map<string, Map<string, number>>();
  if (months.length) {
    for (const r of all<{ id: string; month: string; pct: number }>(
      `select school_id id, month, avg_attendance_pct pct from attendance_monthly where school_id in ${vis} and month in (${months.map(() => '?').join(',')})`,
      ...visible, ...months,
    )) {
      if (!att.has(r.id)) att.set(r.id, new Map());
      att.get(r.id)!.set(r.month, Number(r.pct));
    }
  }
  const recentMonths = months.slice(0, 3);
  const beforeMonths = months.slice(3, 6);

  for (const b of base) {
    const teachers = { sanctioned: Number(b.sanctioned), inPosition: Number(b.in_position), short: Math.max(0, Number(b.sanctioned) - Number(b.in_position)) };
    const netOut = moves ? Math.max(0, moves.get(b.id) ?? 0) : null;
    const last = visits.get(b.id) ?? null;
    const days = last ? daysBetween(last, d) : null;
    const a = att.get(b.id);
    const recent = avg(recentMonths.map((m) => a?.get(m)).filter((x): x is number => x !== undefined));
    const before = avg(beforeMonths.map((m) => a?.get(m)).filter((x): x is number => x !== undefined));
    const change = recent !== null && before !== null && beforeMonths.length === 3 ? Math.round((recent - before) * 10) / 10 : null;
    out.set(b.id, {
      enrolment: Number(b.g1) + Number(b.g2) + Number(b.g3),
      teachers, netTransfersOut: netOut, lastVisit: last, daysSinceVisit: days,
      attendance: { recent, before, change, months: recentMonths },
      teacherLevel: teacherLevel(teachers, netOut),
      visitLevel: visitLevel(days),
      attendanceLevel: attendanceLevel(change),
    });
  }
  return out;
}

/**
 * An area's level for one condition, from its schools: the share of schools at significant or
 * worse. Half or more = critical; 30% = significant; 15% = moderate; otherwise stable.
 */
export function areaLevel(levels: Level[]): Level {
  const known = levels.filter((l) => l !== 'insufficient');
  if (known.length === 0) return 'insufficient';
  const bad = known.filter((l) => l === 'critical' || l === 'significant').length / known.length;
  return bad >= 0.5 ? 'critical' : bad >= 0.3 ? 'significant' : bad >= 0.15 ? 'moderate' : 'stable';
}
