import 'server-only';
import { all, type Param } from './db';
import { learningRows } from './learning-cache';
import { and, schoolsPred, casesPred, tasksPred, type Pred } from './scope';
import type { Session } from './session';
import { today } from './clock';
import { rounds } from './repo';

/**
 * Learning hotspots: where is proficiency falling, relative to the district?
 *
 * Deterministic, and deliberately the same method as the detector in src/domain/detect.ts:
 * compare % proficient between two consecutive assessment rounds, subtract the district's own
 * change over the same rounds (which removes seasonal and state-wide shifts), and test the
 * difference with a two-proportion z. Severity needs BOTH a material drop and a z that clears
 * the bar, and a unit with too few assessed students is reported as "insufficient data",
 * never as "stable" and never as a decline.
 *
 * No school in the seed has coordinates, so the map drawn from this is a schematic layout of
 * the administrative hierarchy, labelled as such — not a GIS map.
 */

export type Level = 'district' | 'block' | 'cluster' | 'school';
export type HotspotSeverity = 'critical' | 'significant' | 'moderate' | 'stable' | 'improving' | 'insufficient';

export const SEVERITY_ORDER: HotspotSeverity[] = ['critical', 'significant', 'moderate', 'stable', 'improving', 'insufficient'];

/** The thresholds, in one place, so the legend can print exactly what the code does. */
export const RULES = {
  minAssessed: { district: 200, block: 120, cluster: 60, school: 20 } as Record<Level, number>,
  minParticipation: 0.6,
  critical: { relPp: -10, z: -3 },
  significant: { relPp: -6, z: -2 },
  moderate: { relPp: -3, z: -1.5 },
  improving: { relPp: 3, z: 2 },
};

export interface HotspotFilters {
  grade?: number;
  competencyId?: string;
  /** 'N' numeracy or 'L' literacy. */
  subject?: 'N' | 'L';
  /** The later of the two rounds being compared; defaults to the latest completed round. */
  roundId?: string;
}

export interface HotspotUnit {
  id: string;
  name: string;
  level: Level;
  parentId: string | null;
  prevPct: number | null;
  currPct: number | null;
  changePp: number | null;
  districtChangePp: number | null;
  relPp: number | null;
  z: number | null;
  nPrev: number;
  nCurr: number;
  participation: number | null;
  schools: number;
  severity: HotspotSeverity;
  reason: string;
  /** The grade × competency cell that drives the severity, when one does. */
  focus: { grade: number; competency_id: string; prevPct: number | null; currPct: number | null; relPp: number | null; z: number | null; nCurr: number } | null;
  /** Pooled change over all grades and competencies (or the filtered ones), vs the district. */
  overallRelPp: number | null;
  /** How many grade × competency cells are in each severity band. */
  cells: Partial<Record<HotspotSeverity, number>>;
  /** Sub-areas one level down whose worst cell is a critical or significant decline. */
  hotChildren: number;
  openCases: number;
  criticalCases: number;
  overdueTasks: number;
}

export interface RoundPair { prev: { id: string; code: string; label: string }; curr: { id: string; code: string; label: string; import_date: string | null } }

export function roundPair(roundId?: string): RoundPair | null {
  const done = rounds().filter((r) => r.status === 'completed');
  const idx = roundId ? done.findIndex((r) => r.id === roundId) : done.length - 1;
  if (idx < 1) return null;
  const p = done[idx - 1];
  const c = done[idx];
  return {
    prev: { id: p.id, code: p.code, label: p.label },
    curr: { id: c.id, code: c.code, label: c.label, import_date: (c as { import_date?: string | null }).import_date ?? null },
  };
}

export const comparableRounds = () => rounds().filter((r) => r.status === 'completed').slice(1);

interface Agg { nPrev: number; pPrev: number; nCurr: number; pCurr: number; enrolled: number; schools: Set<string> }
const emptyAgg = (): Agg => ({ nPrev: 0, pPrev: 0, nCurr: 0, pCurr: 0, enrolled: 0, schools: new Set() });

function rowFilter(f: HotspotFilters): Pred[] {
  const parts: Pred[] = [{ sql: `ar.metric_id = 'MET-PCT-PROF'`, params: [] }];
  if (f.grade) parts.push({ sql: 'ar.grade = ?', params: [f.grade] });
  if (f.competencyId) parts.push({ sql: 'ar.competency_id = ?', params: [f.competencyId] });
  if (f.subject) parts.push({ sql: 'ar.competency_id like ?', params: [`CMP-${f.subject}%`] });
  return parts;
}

/** Per-school totals for the two rounds. Scoped: only schools the user may see. */
function schoolTotals(s: Session, pair: RoundPair, f: HotspotFilters, parent?: { level: Level; id: string }) {
  const parts = [
    schoolsPred(s, 'sc'),
    { sql: 'ar.round_id in (?, ?)', params: [pair.prev.id, pair.curr.id] as Param[] },
    ...rowFilter(f),
  ];
  if (parent && parent.level !== 'school') parts.push({ sql: `sc.${parent.level}_id = ?`, params: [parent.id] });
  const p = and(...parts);
  return learningRows<{
    school_id: string; name: string; cluster_id: string; block_id: string; district_id: string;
    round_id: string; n: number; prof: number; enrolled: number;
  }>(
    `select sc.id school_id, sc.name, sc.cluster_id, sc.block_id, sc.district_id, ar.round_id,
            sum(ar.n_assessed) n, sum(ar.n_proficient) prof, sum(ar.enrolled) enrolled
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ${p.sql}
      group by sc.id, ar.round_id`,
    ...p.params,
  );
}

/**
 * District reference change. This is an aggregate over the whole district (as the detector
 * uses), not row-level data, so it is computed without the user's scope: a block officer is
 * shown "the district moved −2.1 pp", never another block's schools.
 */
function districtChange(pair: RoundPair, f: HotspotFilters): Map<string, number> {
  const p = and({ sql: 'ar.round_id in (?, ?)', params: [pair.prev.id, pair.curr.id] }, ...rowFilter(f));
  const rows = learningRows<{ district_id: string; round_id: string; n: number; prof: number }>(
    `select sc.district_id, ar.round_id, sum(ar.n_assessed) n, sum(ar.n_proficient) prof
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ${p.sql} group by sc.district_id, ar.round_id`,
    ...p.params,
  );
  const out = new Map<string, number>();
  const byD = new Map<string, { prev?: number; curr?: number }>();
  for (const r of rows) {
    const e = byD.get(r.district_id) ?? {};
    const pct = r.n > 0 ? (100 * r.prof) / r.n : undefined;
    if (r.round_id === pair.prev.id) e.prev = pct; else e.curr = pct;
    byD.set(r.district_id, e);
  }
  for (const [d, e] of byD) if (e.prev !== undefined && e.curr !== undefined) out.set(d, e.curr - e.prev);
  return out;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function classify(level: Level, a: { nPrev: number; nCurr: number; relPp: number | null; z: number | null; participation: number | null }): { severity: HotspotSeverity; reason: string } {
  const min = RULES.minAssessed[level];
  if (a.nPrev < min || a.nCurr < min) return { severity: 'insufficient', reason: `Fewer than ${min} students assessed in one of the rounds` };
  if (a.participation !== null && a.participation < RULES.minParticipation) {
    return { severity: 'insufficient', reason: `Participation ${Math.round(a.participation * 100)}% is below the ${RULES.minParticipation * 100}% floor` };
  }
  if (a.relPp === null || a.z === null) return { severity: 'insufficient', reason: 'No comparable district change' };
  const { relPp: rel, z } = a;
  if (rel <= RULES.critical.relPp && z <= RULES.critical.z) return { severity: 'critical', reason: `${r1(rel)} pp vs district, z ${z.toFixed(1)}` };
  if (rel <= RULES.significant.relPp && z <= RULES.significant.z) return { severity: 'significant', reason: `${r1(rel)} pp vs district, z ${z.toFixed(1)}` };
  if (rel <= RULES.moderate.relPp && z <= RULES.moderate.z) return { severity: 'moderate', reason: `${r1(rel)} pp vs district, z ${z.toFixed(1)}` };
  if (rel >= RULES.improving.relPp && z >= RULES.improving.z) return { severity: 'improving', reason: `+${r1(rel)} pp vs district, z ${z.toFixed(1)}` };
  return { severity: 'stable', reason: rel <= RULES.moderate.relPp ? `${r1(rel)} pp, but not statistically clear (z ${z.toFixed(1)})` : 'Within normal variation of the district' };
}

function finish(level: Level, id: string, name: string, parentId: string | null, a: Agg, dChange: number | undefined): Omit<HotspotUnit, 'openCases' | 'criticalCases' | 'overdueTasks' | 'focus' | 'overallRelPp' | 'cells' | 'hotChildren'> {
  const prevPct = a.nPrev > 0 ? (100 * a.pPrev) / a.nPrev : null;
  const currPct = a.nCurr > 0 ? (100 * a.pCurr) / a.nCurr : null;
  const changePp = prevPct !== null && currPct !== null ? currPct - prevPct : null;
  const relPp = changePp !== null && dChange !== undefined ? changePp - dChange : null;
  let z: number | null = null;
  if (relPp !== null && prevPct !== null && currPct !== null && a.nPrev > 0 && a.nCurr > 0) {
    const p1 = prevPct / 100, p2 = currPct / 100;
    const se = Math.sqrt((p1 * (1 - p1)) / a.nPrev + (p2 * (1 - p2)) / a.nCurr) * 100;
    z = se > 0 ? relPp / se : null;
  }
  const participation = a.enrolled > 0 ? a.nCurr / a.enrolled : null;
  const { severity, reason } = classify(level, { nPrev: a.nPrev, nCurr: a.nCurr, relPp, z, participation });
  return {
    id, name, level, parentId,
    prevPct: prevPct === null ? null : r1(prevPct),
    currPct: currPct === null ? null : r1(currPct),
    changePp: changePp === null ? null : r1(changePp),
    districtChangePp: dChange === undefined ? null : r1(dChange),
    relPp: relPp === null ? null : r1(relPp),
    z: z === null ? null : Math.round(z * 100) / 100,
    nPrev: a.nPrev, nCurr: a.nCurr,
    participation: participation === null ? null : Math.round(participation * 1000) / 1000,
    schools: a.schools.size, severity, reason,
  };
}

const CHILD: Record<Level, Level | null> = { district: 'block', block: 'cluster', cluster: 'school', school: null };

/** The units one level below `parent` (or the top level the user can see), with their stats. */
export function hotspotUnits(
  s: Session, f: HotspotFilters, parent?: { level: Level; id: string },
): { level: Level; units: HotspotUnit[]; pair: RoundPair | null } {
  const pair = roundPair(f.roundId);
  const level: Level = parent ? (CHILD[parent.level] ?? 'school') : topLevel(s);
  if (!pair) return { level, units: [], pair };

  const rows = schoolTotals(s, pair, f, parent);
  const dChange = districtChange(pair, f);
  const key = (r: (typeof rows)[number]) => (level === 'school' ? r.school_id : r[`${level}_id` as 'cluster_id']);

  const aggs = new Map<string, { agg: Agg; district: string; parent: string | null; name?: string }>();
  for (const r of rows) {
    const k = key(r);
    const e = aggs.get(k) ?? {
      agg: emptyAgg(), district: r.district_id,
      parent: level === 'school' ? r.cluster_id : level === 'cluster' ? r.block_id : level === 'block' ? r.district_id : null,
      name: level === 'school' ? r.name : undefined,
    };
    e.agg.schools.add(r.school_id);
    if (r.round_id === pair.prev.id) { e.agg.nPrev += Number(r.n); e.agg.pPrev += Number(r.prof); }
    else { e.agg.nCurr += Number(r.n); e.agg.pCurr += Number(r.prof); e.agg.enrolled += Number(r.enrolled); }
    aggs.set(k, e);
  }

  const names = level === 'school' ? null : new Map(
    all<{ id: string; name: string }>(`select id, name from ${level === 'district' ? 'districts' : level === 'block' ? 'blocks' : 'clusters'}`).map((r) => [r.id, r.name]),
  );
  const workload = workloadBy(s, level);
  const cells = cellStats(s, level, pair, f, parent);
  const hot = hotChildCounts(s, level, pair, f, parent);

  const units: HotspotUnit[] = [...aggs.entries()].map(([id, e]) => {
    const overall = finish(level, id, e.name ?? names?.get(id) ?? id, e.parent, e.agg, dChange.get(e.district));
    const mine = cells.get(id) ?? [];
    const counts: Partial<Record<HotspotSeverity, number>> = {};
    for (const c of mine) counts[c.severity] = (counts[c.severity] ?? 0) + 1;
    const declining = mine.filter((c) => ['critical', 'significant', 'moderate'].includes(c.severity))
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.relPp ?? 0) - (b.relPp ?? 0));
    const worst = declining[0];
    let severity = overall.severity;
    let reason = overall.reason;
    if (worst) {
      severity = worst.severity;
      reason = `Class ${worst.grade} ${COMP_NAME()[worst.competency_id] ?? worst.competency_id}: ${worst.reason}${declining.length > 1 ? ` (+${declining.length - 1} more declining)` : ''}`;
    } else if (overall.severity !== 'insufficient' && mine.length > 0 && mine.every((c) => c.severity === 'insufficient')) {
      severity = 'insufficient'; reason = 'Every grade × competency cell has too few students assessed';
    } else if (overall.severity === 'moderate' || overall.severity === 'significant' || overall.severity === 'critical') {
      // A pooled decline with no single clear cell: keep it, but as a moderate concern at most.
      severity = 'moderate';
    }
    return {
      ...overall,
      severity, reason,
      relPp: worst ? worst.relPp : overall.relPp,
      z: worst ? worst.z : overall.z,
      overallRelPp: overall.relPp,
      focus: worst ? { grade: worst.grade, competency_id: worst.competency_id, prevPct: worst.prevPct, currPct: worst.currPct, relPp: worst.relPp, z: worst.z, nCurr: worst.nCurr } : null,
      cells: counts,
      hotChildren: hot.get(id) ?? 0,
      openCases: workload.open.get(id) ?? 0,
      criticalCases: workload.critical.get(id) ?? 0,
      overdueTasks: workload.overdue.get(id) ?? 0,
    };
  });
  units.sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    (a.relPp ?? 0) - (b.relPp ?? 0) || a.name.localeCompare(b.name));
  return { level, units, pair };
}

let compNames: Record<string, string> | null = null;
const COMP_NAME = () => (compNames ??= Object.fromEntries(all<{ id: string; name_en: string }>('select id, name_en from competencies').map((r) => [r.id, r.name_en.toLowerCase()])));

/** Grade × competency cells per unit, each classified with the unit-level sample gate. */
function cellStats(s: Session, level: Level, pair: RoundPair, f: HotspotFilters, parent?: { level: Level; id: string }) {
  const col = level === 'school' ? 'sc.id' : `sc.${level}_id`;
  const parts: Pred[] = [schoolsPred(s, 'sc'), { sql: 'ar.round_id in (?, ?)', params: [pair.prev.id, pair.curr.id] }, ...rowFilter(f)];
  if (parent && parent.level !== 'school') parts.push({ sql: `sc.${parent.level}_id = ?`, params: [parent.id] });
  const p = and(...parts);
  const rows = learningRows<{ uid: string; district_id: string; grade: number; competency_id: string; round_id: string; n: number; prof: number }>(
    `select ${col} uid, min(sc.district_id) district_id, ar.grade, ar.competency_id, ar.round_id, sum(ar.n_assessed) n, sum(ar.n_proficient) prof
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ${p.sql} group by ${col}, ar.grade, ar.competency_id, ar.round_id`, ...p.params,
  );
  const dp = and({ sql: 'ar.round_id in (?, ?)', params: [pair.prev.id, pair.curr.id] }, ...rowFilter(f));
  const dRows = learningRows<{ district_id: string; grade: number; competency_id: string; round_id: string; n: number; prof: number }>(
    `select sc.district_id, ar.grade, ar.competency_id, ar.round_id, sum(ar.n_assessed) n, sum(ar.n_proficient) prof
       from assessment_results ar join schools sc on sc.id = ar.school_id where ${dp.sql}
      group by sc.district_id, ar.grade, ar.competency_id, ar.round_id`, ...dp.params,
  );
  const dIdx = new Map<string, { prev?: number; curr?: number }>();
  for (const r of dRows) {
    const k = `${r.district_id}|${r.grade}|${r.competency_id}`;
    const e = dIdx.get(k) ?? {};
    const pct = r.n > 0 ? (100 * r.prof) / r.n : undefined;
    if (r.round_id === pair.prev.id) e.prev = pct; else e.curr = pct;
    dIdx.set(k, e);
  }
  const byCell = new Map<string, { uid: string; district: string; grade: number; competency_id: string; agg: Agg }>();
  for (const r of rows) {
    const k = `${r.uid}|${r.grade}|${r.competency_id}`;
    const e = byCell.get(k) ?? { uid: r.uid, district: r.district_id, grade: r.grade, competency_id: r.competency_id, agg: emptyAgg() };
    if (r.round_id === pair.prev.id) { e.agg.nPrev += Number(r.n); e.agg.pPrev += Number(r.prof); }
    else { e.agg.nCurr += Number(r.n); e.agg.pCurr += Number(r.prof); }
    byCell.set(k, e);
  }
  const out = new Map<string, (ReturnType<typeof finish> & { grade: number; competency_id: string })[]>();
  for (const c of byCell.values()) {
    const d = dIdx.get(`${c.district}|${c.grade}|${c.competency_id}`);
    const dc = d?.prev !== undefined && d?.curr !== undefined ? d.curr - d.prev : undefined;
    const u = { ...finish(level, c.uid, '', null, c.agg, dc), grade: c.grade, competency_id: c.competency_id };
    out.set(c.uid, [...(out.get(c.uid) ?? []), u]);
  }
  return out;
}

/** For each unit, how many of its children have a critical/significant worst cell. */
function hotChildCounts(s: Session, level: Level, pair: RoundPair, f: HotspotFilters, parent?: { level: Level; id: string }): Map<string, number> {
  const child = CHILD[level];
  const out = new Map<string, number>();
  if (!child) return out;
  const cells = cellStats(s, child, pair, f, parent);
  const col = `${level}_id`;
  const table = child === 'school' ? 'schools' : child === 'cluster' ? 'clusters' : 'blocks';
  const up = new Map(all<{ id: string; p: string }>(`select id, ${col} p from ${table}`).map((r) => [r.id, r.p]));
  for (const [uid, list] of cells) {
    if (list.some((c) => c.severity === 'critical' || c.severity === 'significant')) {
      const p = up.get(uid);
      if (p) out.set(p, (out.get(p) ?? 0) + 1);
    }
  }
  return out;
}

export function topLevel(s: Session): Level {
  const st = s.scope_type;
  return st === 'state' ? 'district' : st === 'district' ? 'block' : st === 'block' ? 'cluster' : 'school';
}

const OPEN = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];

function workloadBy(s: Session, level: Level) {
  const open = new Map<string, number>();
  const critical = new Map<string, number>();
  const overdue = new Map<string, number>();
  if (level === 'school') {
    // A case spans several schools (school_ids JSON); count it against each.
    const cp = and(casesPred(s, 'c'), { sql: `c.status in (${OPEN.map(() => '?').join(',')})`, params: OPEN });
    for (const r of all<{ school_ids: string; severity: string }>(`select c.school_ids, c.severity from cases c where ${cp.sql}`, ...cp.params)) {
      let ids: string[] = [];
      try { ids = JSON.parse(r.school_ids); } catch { /* malformed row: skip */ }
      for (const id of ids) {
        open.set(id, (open.get(id) ?? 0) + 1);
        if (r.severity === 'critical') critical.set(id, (critical.get(id) ?? 0) + 1);
      }
    }
    const tp = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ? and t.school_id is not null', params: [today()] });
    for (const r of all<{ id: string; c: number }>(`select t.school_id id, count(*) c from tasks t where ${tp.sql} group by t.school_id`, ...tp.params)) overdue.set(r.id, Number(r.c));
    return { open, critical, overdue };
  }
  const col = `${level}_id`;
  const cp = casesPred(s, 'c');
  for (const r of all<{ id: string; o: number; cr: number }>(
    `select c.${col} id,
            sum(case when c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) o,
            sum(case when c.severity = 'critical' and c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) cr
       from cases c where ${cp.sql} group by c.${col}`,
    ...OPEN, ...OPEN, ...cp.params,
  )) { open.set(r.id, Number(r.o)); critical.set(r.id, Number(r.cr)); }
  const tp = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
  for (const r of all<{ id: string; c: number }>(
    `select tc.${col} id, count(*) c from tasks t join cases tc on tc.id = t.case_id where ${tp.sql} group by tc.${col}`, ...tp.params,
  )) overdue.set(r.id, Number(r.c));
  return { open, critical, overdue };
}

/** Breadcrumb chain for a unit, e.g. Rampur › Rampur Sadar › Rampur cluster. */
export function unitPath(level: Level, id: string): { level: Level; id: string; name: string }[] {
  if (level === 'school') {
    const r = all<{ sid: string; sname: string; cid: string; cname: string; bid: string; bname: string; did: string; dname: string }>(
      `select sc.id sid, sc.name sname, cl.id cid, cl.name cname, b.id bid, b.name bname, d.id did, d.name dname
         from schools sc join clusters cl on cl.id = sc.cluster_id join blocks b on b.id = sc.block_id join districts d on d.id = sc.district_id
        where sc.id = ?`, id)[0];
    return r ? [{ level: 'district', id: r.did, name: r.dname }, { level: 'block', id: r.bid, name: r.bname }, { level: 'cluster', id: r.cid, name: r.cname }, { level: 'school', id: r.sid, name: r.sname }] : [];
  }
  if (level === 'cluster') {
    const r = all<{ cid: string; cname: string; bid: string; bname: string; did: string; dname: string }>(
      `select cl.id cid, cl.name cname, b.id bid, b.name bname, d.id did, d.name dname
         from clusters cl join blocks b on b.id = cl.block_id join districts d on d.id = cl.district_id where cl.id = ?`, id)[0];
    return r ? [{ level: 'district', id: r.did, name: r.dname }, { level: 'block', id: r.bid, name: r.bname }, { level: 'cluster', id: r.cid, name: r.cname }] : [];
  }
  if (level === 'block') {
    const r = all<{ bid: string; bname: string; did: string; dname: string }>(
      `select b.id bid, b.name bname, d.id did, d.name dname from blocks b join districts d on d.id = b.district_id where b.id = ?`, id)[0];
    return r ? [{ level: 'district', id: r.did, name: r.dname }, { level: 'block', id: r.bid, name: r.bname }] : [];
  }
  const r = all<{ id: string; name: string }>('select id, name from districts where id = ?', id)[0];
  return r ? [{ level: 'district', id: r.id, name: r.name }] : [];
}

/** Can this user see this unit at all? Checked before any detail is shown. */
export function canSeeUnit(s: Session, level: Level, id: string): boolean {
  const p = and(schoolsPred(s, 'sc'), { sql: level === 'school' ? 'sc.id = ?' : `sc.${level}_id = ?`, params: [id] });
  return all<{ x: number }>(`select 1 x from schools sc where ${p.sql} limit 1`, ...p.params).length > 0;
}

/** Competency-by-grade breakdown for one unit, worst first. */
export function unitBreakdown(s: Session, level: Level, id: string, f: HotspotFilters) {
  const pair = roundPair(f.roundId);
  if (!pair || !canSeeUnit(s, level, id)) return [];
  const parts = [
    schoolsPred(s, 'sc'),
    { sql: 'ar.round_id in (?, ?)', params: [pair.prev.id, pair.curr.id] as Param[] },
    { sql: level === 'school' ? 'sc.id = ?' : `sc.${level}_id = ?`, params: [id] as Param[] },
    { sql: `ar.metric_id = 'MET-PCT-PROF'`, params: [] },
  ];
  if (f.grade) parts.push({ sql: 'ar.grade = ?', params: [f.grade] });
  const p = and(...parts);
  const rows = learningRows<{ grade: number; competency_id: string; round_id: string; n: number; prof: number; district_id: string }>(
    `select ar.grade, ar.competency_id, ar.round_id, sum(ar.n_assessed) n, sum(ar.n_proficient) prof, min(sc.district_id) district_id
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ${p.sql} group by ar.grade, ar.competency_id, ar.round_id`,
    ...p.params,
  );
  const byKey = new Map<string, { grade: number; competency_id: string; agg: Agg; district: string }>();
  for (const r of rows) {
    const k = `${r.grade}|${r.competency_id}`;
    const e = byKey.get(k) ?? { grade: r.grade, competency_id: r.competency_id, agg: emptyAgg(), district: r.district_id };
    if (r.round_id === pair.prev.id) { e.agg.nPrev += Number(r.n); e.agg.pPrev += Number(r.prof); }
    else { e.agg.nCurr += Number(r.n); e.agg.pCurr += Number(r.prof); }
    byKey.set(k, e);
  }
  // District reference change per grade × competency, in one aggregate query.
  const dRows = learningRows<{ district_id: string; grade: number; competency_id: string; round_id: string; n: number; prof: number }>(
    `select sc.district_id, ar.grade, ar.competency_id, ar.round_id, sum(ar.n_assessed) n, sum(ar.n_proficient) prof
       from assessment_results ar join schools sc on sc.id = ar.school_id
      where ar.round_id in (?, ?) and ar.metric_id = 'MET-PCT-PROF' and sc.district_id = ?
      group by sc.district_id, ar.grade, ar.competency_id, ar.round_id`,
    pair.prev.id, pair.curr.id, rows[0]?.district_id ?? '',
  );
  const dIdx = new Map<string, { prev?: number; curr?: number }>();
  for (const r of dRows) {
    const k = `${r.grade}|${r.competency_id}`;
    const e = dIdx.get(k) ?? {};
    const pct = r.n > 0 ? (100 * r.prof) / r.n : undefined;
    if (r.round_id === pair.prev.id) e.prev = pct; else e.curr = pct;
    dIdx.set(k, e);
  }
  return [...byKey.values()].map((e) => {
    const d = dIdx.get(`${e.grade}|${e.competency_id}`);
    const dc = d?.prev !== undefined && d?.curr !== undefined ? d.curr - d.prev : undefined;
    const u = finish(level, `${e.grade}|${e.competency_id}`, '', null, { ...e.agg, enrolled: 0 }, dc);
    return { grade: e.grade, competency_id: e.competency_id, ...u };
  }).sort((a, b) => (a.relPp ?? 0) - (b.relPp ?? 0));
}
