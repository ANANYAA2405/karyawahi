import 'server-only';
import type * as GeoJSON from 'geojson';
import { all, one, j } from './db';
import { and, casesPred, tasksPred, type Pred } from './scope';
import type { Session } from './session';
import { today } from './clock';
import { hotspotUnits, type HotspotFilters, type HotspotUnit, type Level } from './hotspots';
import { complaintsPred, OPEN_STATUSES } from './complaints';
import { scopeContains, pathOf, type ScopeType } from './org';
import { schoolsNow, areaLevel, type SchoolNow, type Level as NowLevel } from './school-now';

/**
 * Map data. Returns GeoJSON for the children of one parent unit, with every layer's metric in
 * the feature properties so the client can switch layers without refetching.
 *
 * Security: the parent must lie inside the user's own scope. A block officer cannot ask for the
 * district (which would reveal sibling blocks), a headmaster gets only their own school, and
 * nothing outside scope is ever serialised — not even as a greyed-out shape. Changing the URL,
 * the request payload or the map viewport changes nothing about what the server returns.
 *
 * Geometry: units carry geometry_source. 'osm' is a real boundary from OpenStreetMap (the state
 * and its districts); 'simulated' is a block, cluster or school drawn inside a real district for
 * the demo; 'approximate' is a city circle around its real centre; 'illustrative' is the older
 * invented geography used when no boundary file is present.
 */

export type Hierarchy = 'admin' | 'urban';
export const LAYERS = ['learning', 'critical', 'complaints', 'overdue', 'delivery', 'improvement', 'insufficient'] as const;
export type Layer = (typeof LAYERS)[number];

export interface GeoUnitRow { id: string; level: string; name: string; geometry_source: string; centroid_lon: number | null; centroid_lat: number | null; bbox: string | null; boundary: string | null; note: string | null }

export const geoUnit = (id: string) => one<GeoUnitRow>('select * from geo_units where id = ?', id);
const children = (parentId: string, h: Hierarchy) =>
  all<GeoUnitRow>(`select u.* from geo_units u join geo_relationships r on r.child_id = u.id where r.parent_id = ? and r.hierarchy_id = ? order by u.name`, parentId, h);
const parentOf = (id: string, h: Hierarchy) => one<{ parent_id: string }>('select parent_id from geo_relationships where child_id = ? and hierarchy_id = ?', id, h)?.parent_id ?? null;

const ADMIN_LEVELS: ScopeType[] = ['state', 'district', 'block', 'cluster', 'school'];
const asScope = (level: string): ScopeType | null => (ADMIN_LEVELS.includes(level as ScopeType) ? (level as ScopeType) : null);

/** May the user open this unit as a map parent? Cities count if their district is in scope. */
export function canOpen(s: Session, u: GeoUnitRow): boolean {
  const sc = asScope(u.level);
  if (sc && scopeContains(s, sc, u.id)) return true;
  // A district that exists only on the map (the state's districts with no demo data) has no row
  // in districts, so it is open to whoever covers the whole state, and to nobody else.
  if (sc === 'district' && !pathOf('district', u.id)) {
    const st = parentOf(u.id, 'admin');
    return !!st && scopeContains(s, 'state', st);
  }
  if (sc) return false;
  if (u.level === 'city') {
    const d = parentOf(u.id, 'urban');
    return !!d && scopeContains(s, 'district', d);
  }
  return false;
}

/** The unit the map opens at for this user: their own scope. */
export function homeUnit(s: Session): string {
  const own = s.roles.find((r) => !r.delegated) ?? s.roles[0];
  return own.scope_id;
}

export interface Crumb { id: string; name: string; level: string }
export function breadcrumbs(s: Session, id: string, h: Hierarchy): Crumb[] {
  const out: Crumb[] = [];
  let cur: string | null = id;
  while (cur) {
    const u = geoUnit(cur);
    if (!u || !canOpen(s, u)) break;
    out.unshift({ id: u.id, name: u.name, level: u.level });
    cur = parentOf(cur, h) ?? (h === 'urban' ? parentOf(cur, 'admin') : null);
  }
  return out;
}

export interface MapPayload {
  parent: { id: string; name: string; level: string; bbox: number[] | null; geometry_source: string; note: string | null };
  childLevel: string | null;
  crumbs: Crumb[];
  hierarchy: Hierarchy;
  hasUrban: boolean;
  features: GeoJSON.FeatureCollection;
  outline: GeoJSON.Feature | null;
  compared: string | null;
  sources: { geometry: string; attribution: string };
}

const sev = (u?: HotspotUnit) => u?.severity ?? 'insufficient';

/** Per-child counts for the non-learning layers. Keys are child unit ids. */
function counts(s: Session, level: string, ids: string[]) {
  const col = level === 'school' ? null : `${level}_id`;
  const empty = () => new Map<string, number>();
  const res = { critical: empty(), open: empty(), overdue: empty(), verified: empty(), tasks: empty(), improved: empty(), complaints: empty() };
  if (!ids.length) return res;
  const inIds = `(${ids.map(() => '?').join(',')})`;
  const OPEN = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];
  const cp = casesPred(s, 'c');
  if (col) {
    for (const r of all<{ id: string; crit: number; open: number; improved: number }>(
      `select c.${col} id,
              sum(case when c.severity = 'critical' and c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) crit,
              sum(case when c.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) open,
              sum(case when c.status = 'closed' and c.closure_type like 'improved%' then 1 else 0 end) improved
         from cases c where (${cp.sql}) and c.${col} in ${inIds} group by c.${col}`, ...OPEN, ...OPEN, ...cp.params, ...ids)) {
      res.critical.set(r.id, Number(r.crit)); res.open.set(r.id, Number(r.open)); res.improved.set(r.id, Number(r.improved));
    }
    const tp = tasksPred(s, 't');
    for (const r of all<{ id: string; overdue: number; verified: number; total: number }>(
      `select tc.${col} id,
              sum(case when t.submitted_at is null and t.due_date < ? then 1 else 0 end) overdue,
              sum(case when t.status = 'verified' and tc.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) verified,
              sum(case when tc.status in (${OPEN.map(() => '?').join(',')}) then 1 else 0 end) total
         from tasks t join cases tc on tc.id = t.case_id where (${tp.sql}) and tc.${col} in ${inIds} group by tc.${col}`,
      today(), ...OPEN, ...OPEN, ...tp.params, ...ids)) {
      res.overdue.set(r.id, Number(r.overdue)); res.verified.set(r.id, Number(r.verified)); res.tasks.set(r.id, Number(r.total));
    }
    const kp = complaintsPred(s, 'k');
    for (const r of all<{ id: string; n: number }>(
      `select k.${col} id, count(*) n from complaints k where (${kp.sql}) and k.status in (${OPEN_STATUSES.map(() => '?').join(',')}) and k.${col} in ${inIds} group by k.${col}`,
      ...kp.params, ...OPEN_STATUSES, ...ids)) res.complaints.set(r.id, Number(r.n));
  } else {
    // Schools: a case spans several schools, so count against each listed school.
    for (const r of all<{ school_ids: string; severity: string; status: string; closure_type: string | null }>(`select c.school_ids, c.severity, c.status, c.closure_type from cases c where ${cp.sql}`, ...cp.params)) {
      for (const sid of j<string[]>(r.school_ids, [])) {
        if (!ids.includes(sid)) continue;
        if (OPEN.includes(r.status)) { res.open.set(sid, (res.open.get(sid) ?? 0) + 1); if (r.severity === 'critical') res.critical.set(sid, (res.critical.get(sid) ?? 0) + 1); }
        if (r.status === 'closed' && r.closure_type?.startsWith('improved')) res.improved.set(sid, (res.improved.get(sid) ?? 0) + 1);
      }
    }
    const tp = and(tasksPred(s, 't'), { sql: `t.school_id in ${inIds}`, params: ids });
    for (const r of all<{ id: string; overdue: number; verified: number; total: number }>(
      `select t.school_id id, sum(case when t.submitted_at is null and t.due_date < ? then 1 else 0 end) overdue,
              sum(case when t.status = 'verified' then 1 else 0 end) verified, count(*) total
         from tasks t where ${tp.sql} group by t.school_id`, today(), ...tp.params)) {
      res.overdue.set(r.id, Number(r.overdue)); res.verified.set(r.id, Number(r.verified)); res.tasks.set(r.id, Number(r.total));
    }
    const kp = complaintsPred(s, 'k');
    for (const r of all<{ id: string; n: number }>(
      `select k.school_id id, count(*) n from complaints k where (${kp.sql}) and k.status in (${OPEN_STATUSES.map(() => '?').join(',')}) and k.school_id in ${inIds} group by k.school_id`,
      ...kp.params, ...OPEN_STATUSES, ...ids)) res.complaints.set(r.id, Number(r.n));
  }
  return res;
}

export function mapData(s: Session, opts: { parentId?: string; hierarchy?: Hierarchy; filters?: HotspotFilters }): MapPayload | { error: string; status: number } {
  const h: Hierarchy = opts.hierarchy === 'urban' ? 'urban' : 'admin';
  const pid = opts.parentId || homeUnit(s);
  const parent = geoUnit(pid);
  if (!parent) return { error: 'Unknown area.', status: 404 };
  // Same answer for "does not exist" and "not yours", so ids cannot be probed.
  if (!canOpen(s, parent)) return { error: 'Unknown area.', status: 404 };

  let kids = children(parent.id, h);
  if (h === 'urban' && parent.level === 'state') kids = children(parent.id, 'admin');
  if (h === 'urban' && parent.level === 'block') kids = children(parent.id, 'admin');
  kids = kids.filter((k) => canOpen(s, k));
  // A headmaster's own school has no children: show just that school.
  if (parent.level === 'school') kids = [parent];
  const childLevel = kids[0]?.level ?? null;

  // Learning metrics from the hotspot engine, for whichever admin level the children are.
  const learn = new Map<string, HotspotUnit>();
  let compared: string | null = null;
  const pull = (level: Level, id: string) => {
    const r = hotspotUnits(s, opts.filters ?? {}, { level, id });
    compared = r.pair ? `${r.pair.prev.code} → ${r.pair.curr.code}` : compared;
    for (const u of r.units) learn.set(u.id, u);
  };
  if (parent.level === 'school') {
    const p = pathOf('school', parent.id)!;
    pull('cluster', p.cluster!);
  } else if (parent.level === 'state') {
    // Hotspots are measured against the district, so a district compared with itself says
    // nothing. A district shows its worst block instead, and how many hot clusters it holds.
    const ord = ['critical', 'significant', 'moderate', 'stable', 'improving', 'insufficient'];
    for (const d of kids.filter((k) => pathOf('district', k.id))) {
      const r = hotspotUnits(s, opts.filters ?? {}, { level: 'district', id: d.id });
      compared = r.pair ? `${r.pair.prev.code} → ${r.pair.curr.code}` : compared;
      const worst = [...r.units].sort((a, b) => ord.indexOf(a.severity) - ord.indexOf(b.severity) || (a.relPp ?? 0) - (b.relPp ?? 0))[0];
      if (worst) {
        learn.set(d.id, {
          ...worst, id: d.id, name: d.name,
          hotChildren: r.units.reduce((n, u) => n + (u.hotChildren ?? 0), 0),
          reason: `Worst block: ${worst.name} — ${worst.reason}`,
        });
      }
    }
  } else if (asScope(parent.level) && childLevel && childLevel !== 'city') {
    pull(parent.level as Level, parent.id);
  } else if (parent.level === 'city' || childLevel === 'city') {
    // Cities are made of clusters: pull the cluster metrics from their blocks.
    const clusterIds = parent.level === 'city' ? kids.map((k) => k.id) : kids.flatMap((c) => children(c.id, 'urban').map((x) => x.id));
    const blocks = new Set(clusterIds.map((cid) => pathOf('cluster', cid)?.block).filter((b): b is string => !!b && scopeContains(s, 'block', b)));
    for (const b of blocks) pull('block', b);
    if (childLevel === 'city') {
      // A city takes its worst cluster's severity; it has no learning figure of its own.
      for (const c of kids) {
        const cl = children(c.id, 'urban').map((x) => learn.get(x.id)).filter((x): x is HotspotUnit => !!x);
        const ord = ['critical', 'significant', 'moderate', 'stable', 'improving', 'insufficient'];
        const worst = cl.sort((a, b) => ord.indexOf(a.severity) - ord.indexOf(b.severity))[0];
        if (worst) learn.set(c.id, { ...worst, id: c.id, name: c.name, reason: `Worst cluster: ${worst.name} — ${worst.reason}` });
      }
    }
  }

  const countLevel = childLevel === 'city' ? null : childLevel;
  const cnt = countLevel ? counts(s, countLevel, kids.map((k) => k.id)) : null;
  const now = situation(s, childLevel, kids.map((k) => k.id));
  const hasKids = new Set(all<{ id: string }>(
    `select distinct parent_id id from geo_relationships where hierarchy_id = ? and parent_id in (${kids.map(() => '?').join(',') || "''"})`,
    h, ...kids.map((k) => k.id),
  ).map((r) => r.id));

  const features: GeoJSON.Feature[] = kids.filter((k) => k.boundary).map((k) => {
    const u = learn.get(k.id);
    const tasks = cnt?.tasks.get(k.id) ?? 0;
    // A district on the map with no demo data behind it: drawn faintly, never hatched as
    // "too few students", because there are no students at all.
    const noData = k.geometry_source === 'osm' && k.level === 'district' && !pathOf('district', k.id) ? 1 : 0;
    return {
      type: 'Feature', id: k.id,
      geometry: JSON.parse(k.boundary!),
      properties: {
        id: k.id, name: k.name, level: k.level, geometry_source: k.geometry_source, lon: k.centroid_lon, lat: k.centroid_lat,
        severity: sev(u), relPp: u?.relPp ?? null, overallRelPp: u?.overallRelPp ?? null, prevPct: u?.focus?.prevPct ?? u?.prevPct ?? null, currPct: u?.focus?.currPct ?? u?.currPct ?? null,
        z: u?.z ?? null, nCurr: u?.nCurr ?? 0,
        focus: u?.focus ? `Class ${u.focus.grade} ${u.focus.competency_id}` : null, hotChildren: u?.hotChildren ?? 0, schools: u?.schools ?? 0,
        critical: cnt?.critical.get(k.id) ?? 0, openCases: cnt?.open.get(k.id) ?? u?.openCases ?? 0, overdue: cnt?.overdue.get(k.id) ?? u?.overdueTasks ?? 0,
        complaints: cnt?.complaints.get(k.id) ?? 0, improved: cnt?.improved.get(k.id) ?? 0,
        delivery: tasks ? Math.round((100 * (cnt?.verified.get(k.id) ?? 0)) / tasks) : null, deliveryTasks: tasks,
        insufficient: sev(u) === 'insufficient' && !noData ? 1 : 0,
        canDrill: k.level !== 'school' && hasKids.has(k.id) ? 1 : 0,
        noData,
        reason: noData ? 'No demo data in this district' : u?.reason ?? 'No assessment data in scope',
        ...now.get(k.id),
      },
    };
  });

  const outline: GeoJSON.Feature | null = parent.level !== 'school' && parent.boundary
    ? { type: 'Feature', geometry: JSON.parse(parent.boundary), properties: { id: parent.id, name: parent.name } }
    : parent.level === 'school' ? (() => { const cl = geoUnit(pathOf('school', parent.id)!.cluster!); return cl?.boundary ? { type: 'Feature', geometry: JSON.parse(cl.boundary), properties: { id: cl.id, name: cl.name, context: 1 } } as GeoJSON.Feature : null; })() : null;

  let bbox: number[] | null = parent.bbox ? JSON.parse(parent.bbox) : null;
  if (parent.level === 'school' && parent.centroid_lon !== null) bbox = [parent.centroid_lon - 0.05, parent.centroid_lat! - 0.05, parent.centroid_lon + 0.05, parent.centroid_lat! + 0.05];
  if (!bbox && features.length) {
    const xs: number[] = [], ys: number[] = [];
    const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { xs.push(c[0] as number); ys.push(c[1] as number); } else if (Array.isArray(c)) c.forEach(walk); };
    features.forEach((f) => walk((f.geometry as GeoJSON.Polygon).coordinates));
    bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const hasUrban = ['state', 'district', 'city'].includes(parent.level) && !!one('select 1 x from geo_units where level = \'city\' limit 1');

  return {
    parent: { id: parent.id, name: parent.name, level: parent.level, bbox, geometry_source: parent.geometry_source, note: parent.note },
    childLevel, crumbs: breadcrumbs(s, parent.id, h), hierarchy: h, hasUrban,
    features: { type: 'FeatureCollection', features }, outline, compared,
    sources: realMap()
      ? { geometry: 'osm', attribution: realSchools()
        ? 'Real boundaries © OpenStreetMap contributors (ODbL). Schools are real (UDISE+ via India Data Portal, ODC-BY; names withheld, pins moved a few hundred metres); blocks, clusters and all learning figures are simulated.'
        : 'Real boundaries © OpenStreetMap contributors (ODbL). Blocks, clusters, school positions and all figures are simulated.' }
      : { geometry: 'illustrative', attribution: 'Illustrative geography generated for a fictional state — not real boundaries or locations.' },
  };
}

/** True when the state is drawn from real boundaries rather than the illustrative shapes. */
const realMap = () => one<{ g: string }>(`select geometry_source g from geo_units where level = 'state' limit 1`)?.g === 'osm';
const realSchools = () => one<{ g: string }>(`select geometry_source g from geo_units where level = 'school' and geometry_source = 'udise' limit 1`)?.g === 'udise';

/**
 * The "right now" figures for each child on the map: a school's own (teachers, last visit,
 * attendance), or for a larger area, how many of its schools are in each condition and an
 * overall level. Only schools the reader can see are counted.
 */
function situation(s: Session, childLevel: string | null, ids: string[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!childLevel || ids.length === 0) return out;
  const one_ = (n: SchoolNow) => ({
    enrolment: n.enrolment, teachersShort: n.teachers.short, teachersSanctioned: n.teachers.sanctioned,
    netTransfersOut: n.netTransfersOut, daysSinceVisit: n.daysSinceVisit, attChange: n.attendance.change,
    teacherLevel: n.teacherLevel, visitLevel: n.visitLevel, attendanceLevel: n.attendanceLevel,
  });
  if (childLevel === 'school') {
    for (const [id, n] of schoolsNow(s, ids)) out.set(id, one_(n));
    return out;
  }
  // Which schools sit in each child area.
  const inIds = `(${ids.map(() => '?').join(',')})`;
  const rows = childLevel === 'city'
    ? all<{ id: string; area: string }>(
      `select sc.id, r.parent_id area from schools sc join geo_relationships r on r.child_id = sc.cluster_id and r.hierarchy_id = 'urban'
        where r.parent_id in ${inIds}`, ...ids)
    : ['district', 'block', 'cluster'].includes(childLevel)
      ? all<{ id: string; area: string }>(`select id, ${childLevel}_id area from schools where ${childLevel}_id in ${inIds}`, ...ids)
      : [];
  const now = schoolsNow(s, rows.map((r) => r.id));
  const byArea = new Map<string, SchoolNow[]>();
  for (const r of rows) { const n = now.get(r.id); if (n) byArea.set(r.area, [...(byArea.get(r.area) ?? []), n]); }
  const bad = (l: NowLevel) => l === 'critical' || l === 'significant';
  for (const [area, list] of byArea) {
    out.set(area, {
      teacherLevel: areaLevel(list.map((n) => n.teacherLevel)),
      visitLevel: areaLevel(list.map((n) => n.visitLevel)),
      attendanceLevel: areaLevel(list.map((n) => n.attendanceLevel)),
      schoolsShort: list.filter((n) => bad(n.teacherLevel)).length,
      schoolsUnvisited: list.filter((n) => bad(n.visitLevel)).length,
      schoolsAttendanceDown: list.filter((n) => bad(n.attendanceLevel)).length,
      schoolsCounted: list.length,
    });
  }
  return out;
}

/** Search for places the user may open. */
export function geoSearch(s: Session, q: string): Crumb[] {
  const t = q.trim();
  if (t.length < 2) return [];
  return all<GeoUnitRow>(`select * from geo_units where (name like ? or id like ?) and level <> 'country' order by case level when 'district' then 0 when 'city' then 1 when 'block' then 2 when 'cluster' then 3 else 4 end, name limit 60`, `%${t}%`, `%${t}%`)
    .filter((u) => canOpen(s, u)).slice(0, 10).map((u) => ({ id: u.id, name: u.name, level: u.level }));
}

export const _test = { counts };
export type { Pred };
