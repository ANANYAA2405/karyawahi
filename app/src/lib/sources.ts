import { all, one } from './db';
import { realFigures, type DistrictFigures, type RealFigures } from './ext/realdata';

/**
 * Read side of the real-data layer: what the Sources page, the district context card and the
 * tests show. The published figures come from data/real/figures.json; the simulated side is
 * measured from the database every time, so the table says what the data really holds.
 */

export interface ReconRow {
  districtId: string; district: string; subject: 'language' | 'mathematics';
  published: number; simulatedBefore: number | null; simulated: number | null; offset: number | null; diff: number | null;
  page: number;
}

/** PRS 2024 Class 3 average vs the demo's Class 3 average in the anchor round, per district and subject. */
export function reconciliation(): ReconRow[] {
  const f = realFigures();
  if (!f) return [];
  const anchor = f.calibration.anchor_round;
  const sim = all<{ district_id: string; domain: string; pct: number }>(
    `select s.district_id, k.domain, 100.0 * sum(r.n_proficient) / sum(r.n_assessed) pct
       from assessment_results r join schools s on s.id = r.school_id join competencies k on k.id = r.competency_id
      where r.round_id = ? and r.grade = ? and r.n_assessed > 0
      group by s.district_id, k.domain`, anchor, f.calibration.grade,
  );
  const hasCal = !!one(`select 1 from sqlite_master where type = 'table' and name = 'realdata_calibration'`);
  const cal = hasCal ? all<{ district_id: string; subject: string; before_pct: number; offset_pp: number }>('select district_id, subject, before_pct, offset_pp from realdata_calibration') : [];
  const out: ReconRow[] = [];
  for (const [id, d] of Object.entries(f.districts)) {
    for (const subject of ['language', 'mathematics'] as const) {
      const domain = subject === 'language' ? 'literacy' : 'numeracy';
      const s = sim.find((x) => x.district_id === id && x.domain === domain)?.pct ?? null;
      const c = cal.find((x) => x.district_id === id && x.subject === subject);
      out.push({
        districtId: id, district: d.name, subject, published: d.prs[subject],
        simulatedBefore: c?.before_pct ?? null, simulated: s === null ? null : Math.round(s * 10) / 10,
        offset: c?.offset_pp ?? null, diff: s === null ? null : Math.round((s - d.prs[subject]) * 10) / 10,
        page: d.prs.pages.overall.pdf,
      });
    }
  }
  return out;
}

export const districtFigures = (districtId: string): DistrictFigures | null => realFigures()?.districts[districtId] ?? null;
export const figures = (): RealFigures | null => realFigures();

/** Which cards carry a PAB cost, with the line, amount and page. */
export function pabCosts(): { id: string; name: string; basis: 'pab' | 'pab_proxy'; amount: number; composite: number | null; unit: string; page: number; printed: string; lineEn: string; lineHi: string; noteEn: string; noteHi: string }[] {
  const f = realFigures();
  if (!f) return [];
  const names = new Map(all<{ id: string; name: string }>('select id, name from interventions').map((r) => [r.id, r.name]));
  return Object.entries(f.pab.cards).map(([id, c]) => {
    const l = f.pab.lines[c.line];
    return { id, name: names.get(id) ?? id, basis: c.basis, amount: c.amount_inr, composite: c.amount_composite_inr, unit: c.unit, page: c.pdf_page, printed: c.printed,
      lineEn: l.line_en, lineHi: l.line_hi, noteEn: c.note_en, noteHi: c.note_hi };
  });
}

/** The UDISE+ facts kept for a real school (no name, no code), or null on the fictional seed. */
export function schoolProfile(schoolId: string): { management: string; category: string; location: string; enrolment: number[]; teachers: number; classrooms: number } | null {
  if (!one(`select 1 from sqlite_master where type = 'table' and name = 'school_profile'`)) return null;
  const r = one<{ management: string; category: string; location: string; enrolment: string; teachers: number; classrooms: number }>(
    'select management, category, location, enrolment, teachers, classrooms from school_profile where school_id = ?', schoolId,
  );
  return r ? { ...r, enrolment: JSON.parse(r.enrolment) as number[] } : null;
}

/** How many schools are real (UDISE+-backed) in the database, and how many seed findings moved a detection gate when calibrated. */
export function realDataStatus(): { realSchools: number; schools: number; findingsGateMoved: number; findingsChecked: number; outcomesCategoryMoved: number; outcomesChecked: number } {
  const t = (n: string) => !!one(`select 1 from sqlite_master where type = 'table' and name = ?`, n);
  const n = (sql: string) => Number(one<{ c: number }>(sql)?.c ?? 0);
  return {
    realSchools: t('school_profile') ? n(`select count(*) c from schools where provenance = 'udise_anonymised'`) : 0,
    schools: n('select count(*) c from schools'),
    findingsChecked: t('realdata_findings') ? n('select count(*) c from realdata_findings') : 0,
    findingsGateMoved: t('realdata_findings') ? n('select count(*) c from realdata_findings where gate_before <> gate_after') : 0,
    outcomesChecked: t('realdata_outcomes') ? n('select count(*) c from realdata_outcomes') : 0,
    outcomesCategoryMoved: t('realdata_outcomes') ? n('select count(*) c from realdata_outcomes where category_before <> category_after') : 0,
  };
}
