import 'server-only';
import { all } from './db';
import type { Session } from './session';
import { and, casesPred, findingsPred } from './scope';
import { lifecycleCounts } from './overview';
import { STAGES, stageIndex } from './case-stage';
import { competency } from './repo';

/**
 * The few figures the command-centre home shows beside its map. Each is a small, scoped read:
 * the latest hotspots found in the reader's area, and how their open cases spread across the
 * seven stages. The map itself comes from /api/geo/map.
 */

export interface HomeHotspot {
  id: string; caseId: string | null; cluster: string; block: string; grade: number; competency: string;
  severity: 'critical' | 'high' | 'medium'; changePp: number; relPp: number; status: string;
}

const SEV_RANK = `case f.severity when 'critical' then 0 when 'high' then 1 else 2 end`;

/** The worst hotspots of the latest round in the reader's area: real findings, not noise. */
export function topHotspots(s: Session, limit = 4): HomeHotspot[] {
  const p = and(findingsPred(s, 'f'), {
    sql: `f.status in ('case_opened','monitoring') and f.round_id = (select max(round_id) from findings)`, params: [],
  });
  return all<{ id: string; case_id: string | null; cluster: string; block: string; grade: number; competency_id: string; severity: HomeHotspot['severity']; change_pp: number; relative_change_pp: number; status: string }>(
    `select f.id, f.case_id, cl.name cluster, b.name block, f.grade, f.competency_id, f.severity, f.change_pp, f.relative_change_pp, f.status
       from findings f join clusters cl on cl.id = f.cluster_id join blocks b on b.id = f.block_id
      where ${p.sql} order by ${SEV_RANK}, f.relative_change_pp limit ?`, ...p.params, limit,
  ).map((r) => ({
    id: r.id, caseId: r.case_id, cluster: r.cluster, block: r.block, grade: r.grade,
    competency: competency(r.competency_id)?.name_en ?? r.competency_id,
    severity: r.severity, changePp: r.change_pp, relPp: r.relative_change_pp, status: r.status,
  }));
}

/** How many of the reader's cases sit at each of the seven stages. */
export function stageStrip(s: Session): { key: string; en: string; hi: string; n: number }[] {
  const counts = new Array(STAGES.length).fill(0) as number[];
  for (const r of lifecycleCounts(s)) counts[stageIndex(r.status)] += r.c;
  return STAGES.map((st, i) => ({ key: st.key, en: st.en, hi: st.hi, n: counts[i] }));
}

/** Open cases by severity, for the headline. */
export function openBySeverity(s: Session): Record<string, number> {
  const p = and(casesPred(s, 'c'), { sql: `c.status not in ('closed','dismissed','referred_pab')`, params: [] });
  return Object.fromEntries(all<{ severity: string; n: number }>(
    `select c.severity, count(*) n from cases c where ${p.sql} group by c.severity`, ...p.params,
  ).map((r) => [r.severity, Number(r.n)]));
}
