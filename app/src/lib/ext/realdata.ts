import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { detectFindings, type DetectRow } from '@domain/detect';
import { evaluateOutcome } from '@domain/outcome';
import { closureEligibility } from '@domain/lifecycle';
import type { DetectionSettings, OutcomeSchoolRow } from '@domain/types';
import { schoolLabelEn, schoolLabelHi } from '../school-label';

/**
 * The real-data layer: real schools (UDISE+, anonymised), learning results calibrated to the
 * published district figures (PRS 2024), and PAB 2025-26 unit costs on the intervention cards.
 *
 * It reads two committed files built by scripts/build-real-data.mjs — data/real/schools.json and
 * data/real/figures.json — so a fresh checkout needs none of the raw downloads. Without them the
 * app runs on the fictional seed as before.
 *
 * Applied once per database, like the other extension migrations (a demo reset restores the
 * pristine file, so it runs again there), and idempotent: the original Class 3 results are kept
 * in realdata_assess_orig and every application starts from them.
 *
 * What changes, and what does not:
 * - schools: the demo id, block, cluster, users and every case stay. Each school takes its real
 *   counterpart's enrolment, teachers and position, and an anonymised name ("School 0412 ·
 *   Rampur Sadar"); the real name and UDISE code are not in the files at all.
 * - assessment_results, Class 3 only, rounds R0–R3: one offset per district and subject, the
 *   same for every round, so each district's Class 3 average in R0 (the round nearest PRS 2024)
 *   equals the PRS figure. The offset is shared out within each cluster × competency × round
 *   (capped at 0 and at the number assessed), so cluster and district totals move by exactly the
 *   offset and the drops the detector measures stay as they were (to rounding).
 * - findings on Class 3 are re-measured from the calibrated rows; their status, case and driver
 *   schools are the record of what was decided and stay (realdata_findings keeps both
 *   measurements, for the finding page and the tests). Outcome checks on Class 3 are re-derived
 *   exactly as write.ts derives them, so re-running one gives the stored answer; the case moves
 *   that followed a check stay as recorded, and realdata_outcomes keeps the earlier reading.
 */

export const REAL_DIR = (): string => process.env.KV_REAL_DATA_DIR ?? join(process.cwd(), 'data', 'real');
const SEEDED_ROUNDS = ['RND-2025-02', 'RND-2025-07', 'RND-2026-02', 'RND-2026-07'];
const CAL_GRADE = 3;

// ------------------------------------------------------------------ the files
export interface RealSchool { pos: [number, number]; mgmt: string; cat: string; loc: string; enr: number[]; teachers: number; rooms: number }
export interface PabLine { key: string; amount_inr: number; unit: string; pdf_page: number; printed: string; line_en: string; line_hi: string }
export interface CardCost {
  basis: 'pab' | 'pab_proxy'; line: string; line_composite?: string; per: 'child_in_class' | 'teacher' | 'school';
  amount_inr: number; amount_composite_inr: number | null; unit: string; pdf_page: number; printed: string; note_en: string; note_hi: string;
}
export interface NfhsValue { en: string; hi: string; nfhs5: number | null; nfhs4: number | null }
export interface DistrictFigures {
  name: string; lgd_code: number; prs_code: string;
  prs: {
    language: number; mathematics: number; state: { language: number; mathematics: number }; national: { language: number; mathematics: number };
    participation: { schools: number; teachers: number; students: number };
    competencies: Record<'language' | 'mathematics', { code: string; en: string; hi: string; district: number; state: number }[]>;
    pages: { overall: { pdf: number; printed: string }; competencies: { pdf: number; printed: string } }; url: string;
  };
  aser: Record<'govt_school_enrolment_6_14' | 'not_in_school_6_14' | 'std3_5_read_std2' | 'std3_5_subtraction' | 'std6_8_read_std2' | 'std6_8_division', number> & { page: number };
  nfhs: Record<string, NfhsValue>;
  udise: { name: string; lgd_district: number; udise_rows: number; udise_rows_with_lgd_block: number; lgd_blocks: string[]; government_class_1_5: number; outside_outline_or_no_position: number; used: number; type_mismatches: number; mean_class3_gap: number };
}
export interface RealFigures {
  built: string;
  districts: Record<string, DistrictFigures>;
  state: { name: string; prs: { language: number; mathematics: number }; aser: Record<string, number> };
  pab: { title: string; url: string; revision_url: string; lines: Record<string, PabLine>; cards: Record<string, CardCost> };
  calibration: { anchor_round: string; grade: number; note: string };
}

const cache = new Map<string, { mtime: number; value: unknown }>();
function readJson<T>(name: string): T | null {
  const p = join(REAL_DIR(), name);
  if (!existsSync(p)) return null;
  const mtime = statSync(p).mtimeMs;
  const hit = cache.get(p);
  if (hit && hit.mtime === mtime) return hit.value as T;
  const value = JSON.parse(readFileSync(p, 'utf8')) as T;
  cache.set(p, { mtime, value });
  return value;
}
export const realFigures = (): RealFigures | null => readJson<RealFigures>('figures.json');
export const realSchools = (): { built: string; schools: Record<string, RealSchool> } | null => readJson('schools.json');

/** A short fingerprint of both files, or null when the real-data layer is off. */
export function realDataVersion(): string | null {
  const a = join(REAL_DIR(), 'schools.json'), b = join(REAL_DIR(), 'figures.json');
  if (!existsSync(a) || !existsSync(b)) return null;
  const h = createHash('sha256').update(readFileSync(a)).update(readFileSync(b)).update('realdata-v1').digest('hex');
  return `realdata-v1:${h.slice(0, 12)}`;
}

// ------------------------------------------------------------------ names
/** Teacher posts the RTE Act's schedule asks for, from enrolment (an estimate: UDISE+ has no sanctioned posts). */
export function rteTeacherPosts(enr: number[], upper: boolean): number {
  const p = enr.slice(0, 5).reduce((t, x) => t + x, 0);
  const primary = p <= 60 ? 2 : p <= 90 ? 3 : p <= 120 ? 4 : p <= 200 ? 5 : Math.ceil(p / 40) + 1;
  if (!upper) return primary;
  const u = enr.slice(5).reduce((t, x) => t + x, 0);
  return primary + Math.max(3, Math.ceil(u / 35));
}

// ------------------------------------------------------------------ the migration
const DDL = `
create table if not exists school_profile (
  school_id text primary key, label_en text not null, label_hi text not null, management text, category text, location text,
  enrolment text, teachers integer, classrooms integer, lon real, lat real, source text not null
);
create index if not exists ix_assessment_results_id on assessment_results(id);
create index if not exists ix_findings_id on findings(id);
create table if not exists realdata_assess_orig (id text primary key, n_proficient integer not null, pct_proficient real not null);
create table if not exists realdata_calibration (
  district_id text not null, subject text not null, published real not null, before_pct real not null, after_pct real not null,
  offset_pp real not null, anchor_round text not null, grade integer not null, rows integer not null, capped_rows integer not null,
  primary key (district_id, subject)
);
create table if not exists realdata_findings (
  finding_id text primary key, z_before real, z_after real, change_before real, change_after real, rel_before real, rel_after real,
  gate_before text, gate_after text
);
create table if not exists realdata_outcomes (outcome_id text primary key, did_before real, did_after real, category_before text, category_after text);
`;

type Row = Record<string, unknown>;
const q = <T = Row>(c: DatabaseSync, sql: string, ...p: (string | number | null)[]) => c.prepare(sql).all(...p) as T[];
const one = <T = Row>(c: DatabaseSync, sql: string, ...p: (string | number | null)[]) => (c.prepare(sql).get(...p) ?? null) as T | null;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function ensureRealData(c: DatabaseSync): void {
  const ver = realDataVersion();
  if (!ver) return;
  c.exec(DDL);
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'realdata'`)?.value === ver) return;
  const schools = realSchools();
  const figures = realFigures();
  if (!schools || !figures) return;
  c.exec('begin immediate');
  try {
    applySchools(c, schools.schools);
    calibrate(c, figures);
    applyCosts(c, figures);
    c.prepare(`insert into ext_meta (key, value) values ('realdata', ?) on conflict(key) do update set value = excluded.value`).run(ver);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

function applySchools(c: DatabaseSync, file: Record<string, RealSchool>) {
  const rows = q<{ id: string; block: string; category: string }>(c, 'select s.id, b.name block, s.category from schools s join blocks b on b.id = s.block_id');
  const upd = c.prepare(`update schools set name = ?, enrolment_total = ?, enrolment_g1 = ?, enrolment_g2 = ?, enrolment_g3 = ?,
    teachers_sanctioned = ?, teachers_in_position = ?, ptr = ?, provenance = 'udise_anonymised', source_ref = ? where id = ?`);
  const prof = c.prepare(`insert into school_profile values (?,?,?,?,?,?,?,?,?,?,?,?)
    on conflict(school_id) do update set label_en = excluded.label_en, label_hi = excluded.label_hi, management = excluded.management,
      category = excluded.category, location = excluded.location, enrolment = excluded.enrolment, teachers = excluded.teachers,
      classrooms = excluded.classrooms, lon = excluded.lon, lat = excluded.lat, source = excluded.source`);
  const SOURCE = 'UDISE+ 2020-21 via India Data Portal (ODC-BY) · name withheld';
  for (const s of rows) {
    const r = file[s.id];
    if (!r) continue;
    const total = r.enr.reduce((t, x) => t + x, 0);
    const teachers = Math.max(1, r.teachers);
    const posts = Math.max(rteTeacherPosts(r.enr, r.cat !== 'primary'), 1);
    upd.run(schoolLabelEn(s.id, s.block), total, r.enr[0], r.enr[1], r.enr[2], posts, r.teachers, r1(total / teachers), SOURCE, s.id);
    prof.run(s.id, schoolLabelEn(s.id, s.block), schoolLabelHi(s.id, s.block), r.mgmt, r.cat, r.loc, JSON.stringify(r.enr), r.teachers, r.rooms, r.pos[0], r.pos[1], SOURCE);
  }
}

// ------------------------------------------------------------------ calibration
interface CalRow { id: string; round_id: string; school_id: string; district_id: string; cluster_id: string; competency_id: string; domain: string; n_assessed: number; n_proficient: number }
const SUBJECT: Record<string, 'language' | 'mathematics'> = { literacy: 'language', numeracy: 'mathematics' };

/**
 * Shift one cluster × competency (all its rounds) by `off` points on average. Every school moves
 * by the same number of points in every round, so its own changes stay as they were; a school
 * close to 100% (or 0%) moves only as far as it can, and the others in the cluster move a little
 * more, so the cluster as a whole moves by the offset.
 */
function shiftGroup(rows: CalRow[], off: number): void {
  const bySchool = new Map<string, CalRow[]>();
  for (const r of rows) { const g = bySchool.get(r.school_id); if (g) g.push(r); else bySchool.set(r.school_id, [r]); }
  const schools = [...bySchool.values()].map((rs) => {
    const pcts = rs.map((r) => (100 * r.n_proficient) / r.n_assessed);
    return { rs, w: rs.reduce((t, r) => t + r.n_assessed, 0), up: 100 - Math.max(...pcts), down: Math.min(...pcts) };
  });
  const W = schools.reduce((t, x) => t + x.w, 0);
  if (!W) return;
  const clamp = (lam: number, x: { up: number; down: number }) => Math.min(x.up, Math.max(-x.down, lam));
  const mean = (lam: number) => schools.reduce((t, x) => t + x.w * clamp(lam, x), 0) / W;
  let lo = -100, hi = 100;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (mean(mid) < off) lo = mid; else hi = mid; }
  const lam = (lo + hi) / 2;
  const delta = new Map<CalRow, number>();
  for (const x of schools) for (const r of x.rs) delta.set(r, clamp(lam, x));
  // Whole children: each school rounds the same way in every round (a fixed fraction per school),
  // so its round-to-round change survives the rounding, and over a cluster the roundings cancel out.
  for (const r of rows) {
    const u = parseInt(createHash('sha256').update(`${r.school_id}|${r.competency_id}`).digest('hex').slice(0, 8), 16) / 0x100000000;
    const k = Math.floor((delta.get(r)! * r.n_assessed) / 100 + u);
    r.n_proficient = Math.min(r.n_assessed, Math.max(0, r.n_proficient + k));
  }
}

function calibrate(c: DatabaseSync, figures: RealFigures) {
  const anchor = figures.calibration.anchor_round;
  const inRounds = SEEDED_ROUNDS.map(() => '?').join(',');
  // Keep the originals once; every application starts from them.
  c.prepare(`insert or ignore into realdata_assess_orig (id, n_proficient, pct_proficient)
    select id, n_proficient, pct_proficient from assessment_results where grade = ${CAL_GRADE} and round_id in (${inRounds})`).run(...SEEDED_ROUNDS);
  c.exec(`update assessment_results set n_proficient = o.n_proficient, pct_proficient = o.pct_proficient
    from realdata_assess_orig o where o.id = assessment_results.id and assessment_results.n_proficient <> o.n_proficient`);

  const rows = q<CalRow>(c, `select r.id, r.round_id, r.school_id, s.district_id, s.cluster_id, r.competency_id, k.domain, r.n_assessed, r.n_proficient
      from assessment_results r join schools s on s.id = r.school_id join competencies k on k.id = r.competency_id
     where r.grade = ${CAL_GRADE} and r.round_id in (${inRounds}) and r.n_assessed > 0
     order by r.round_id, s.cluster_id, r.competency_id, r.school_id`, ...SEEDED_ROUNDS);
  const original = new Map(rows.map((r) => [r.id, r.n_proficient]));
  const groups = new Map<string, CalRow[]>();
  for (const r of rows) {
    const k = `${r.cluster_id}|${r.competency_id}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const anchorPct = (district: string, domain: string) => {
    let n = 0, p = 0;
    for (const r of rows) if (r.round_id === anchor && r.district_id === district && r.domain === domain) { n += r.n_assessed; p += r.n_proficient; }
    return n ? (100 * p) / n : null;
  };
  const before = new Map<string, number>();
  const offsets = new Map<string, number>();
  const targets = new Map<string, number>();
  for (const [did, d] of Object.entries(figures.districts)) {
    for (const domain of ['literacy', 'numeracy']) {
      const b = anchorPct(did, domain);
      if (b === null) continue;
      const t = d.prs[SUBJECT[domain]];
      before.set(`${did}|${domain}`, b);
      targets.set(`${did}|${domain}`, t);
      offsets.set(`${did}|${domain}`, t - b);
    }
  }
  const apply = () => {
    for (const r of rows) r.n_proficient = original.get(r.id)!;
    for (const g of groups.values()) {
      const off = offsets.get(`${g[0].district_id}|${g[0].domain}`);
      if (off === undefined) continue;
      shiftGroup(g, off);
    }
  };
  apply();
  // Capping at 100% loses a little of the shift; nudge the offset until the anchor round lands on the figure.
  for (let i = 0; i < 6; i++) {
    let worst = 0;
    for (const [k, t] of targets) {
      const [did, domain] = k.split('|');
      const got = anchorPct(did, domain)!;
      worst = Math.max(worst, Math.abs(t - got));
      offsets.set(k, offsets.get(k)! + (t - got));
    }
    if (worst < 0.05) break;
    apply();
  }

  const upd = c.prepare('update assessment_results set n_proficient = ?, pct_proficient = ? where id = ?');
  for (const r of rows) {
    if (r.n_proficient === original.get(r.id)) continue;
    upd.run(r.n_proficient, r1((100 * r.n_proficient) / r.n_assessed), r.id);
  }
  c.exec('delete from realdata_calibration');
  const ins = c.prepare('insert into realdata_calibration values (?,?,?,?,?,?,?,?,?,?)');
  for (const [k, t] of targets) {
    const [did, domain] = k.split('|');
    const mine = rows.filter((r) => r.district_id === did && r.domain === domain);
    const capped = mine.filter((r) => r.n_proficient === r.n_assessed && original.get(r.id)! < r.n_assessed).length;
    ins.run(did, SUBJECT[domain], t, r1(before.get(k)!), Math.round(anchorPct(did, domain)! * 100) / 100, Math.round(offsets.get(k)! * 100) / 100, anchor, CAL_GRADE, mine.length, capped);
  }
  remeasureFindings(c, original);
  remeasureOutcomes(c);
}

/** Every finding on Class 3, measured again on the calibrated rows; status, case and driver schools stay. */
function remeasureFindings(c: DatabaseSync, original: Map<string, number>) {
  const findings = q<{
    id: string; round_id: string; prev_round_id: string; cluster_id: string; grade: number; competency_id: string; settings_version_id: string;
    z_score: number; change_pp: number; relative_change_pp: number; driver_schools: string; thresholds: string;
  }>(c, `select id, round_id, prev_round_id, cluster_id, grade, competency_id, settings_version_id, z_score, change_pp, relative_change_pp, driver_schools, thresholds
           from findings where grade = ${CAL_GRADE}`);
  if (!findings.length) return;
  const schools = q<{ id: string; cluster_id: string; block_id: string; district_id: string }>(c, 'select id, cluster_id, block_id, district_id from schools');
  const settings = new Map(q<{ id: string; detection: string }>(c, 'select id, detection from setting_versions').map((s) => [s.id, JSON.parse(s.detection) as DetectionSettings]));
  const rowsOf = (round: string) => q<DetectRow & { id: string }>(c, `select id, school_id, grade, competency_id, enrolled, n_assessed, n_proficient
      from assessment_results where round_id = ? and grade = ${CAL_GRADE} and metric_id = 'MET-PCT-PROF'`, round);
  const upd = c.prepare(`update findings set prev_value_pct = ?, curr_value_pct = ?, change_pp = ?, district_change_pp = ?, relative_change_pp = ?,
      z_score = ?, n_prev = ?, n_curr = ?, dq_checks = ?, driver_schools = ? where id = ?`);
  const log = c.prepare('insert into realdata_findings values (?,?,?,?,?,?,?,?,?) on conflict(finding_id) do update set z_after = excluded.z_after, change_after = excluded.change_after, rel_after = excluded.rel_after, gate_after = excluded.gate_after');
  const pairs = new Map<string, typeof findings>();
  for (const f of findings) { const k = `${f.prev_round_id}|${f.round_id}|${f.settings_version_id}`; pairs.set(k, [...(pairs.get(k) ?? []), f]); }
  for (const [k, fs] of pairs) {
    const [prevId, currId, setId] = k.split('|');
    const s = settings.get(setId);
    if (!s) continue;
    const prev = rowsOf(prevId), curr = rowsOf(currId);
    // Every cluster is measured (no materiality cut), so a drop that moved by a rounding step is still found.
    const all = detectFindings(prev, curr, schools, { ...s, materiality_pp: -1e9 });
    const byKey = new Map(all.map((x) => [`${x.cluster_id}|${x.grade}|${x.competency_id}`, x]));
    const pct = new Map([...prev.map((r) => [`${prevId}|${r.school_id}|${r.competency_id}`, r] as const), ...curr.map((r) => [`${currId}|${r.school_id}|${r.competency_id}`, r] as const)]);
    // The same measurement on the original rows, for the record of what calibration moved.
    const orig = (rs: (DetectRow & { id: string })[]) => rs.map((r) => ({ ...r, n_proficient: original.get(r.id) ?? r.n_proficient }));
    const before = new Map(detectFindings(orig(prev), orig(curr), schools, { ...s, materiality_pp: -1e9 }).map((x) => [`${x.cluster_id}|${x.grade}|${x.competency_id}`, x]));
    const gate = (x: { relative_change_pp: number; z_score: number } | undefined) =>
      !x ? 'none' : x.relative_change_pp > -s.materiality_pp ? 'below_materiality' : x.z_score > -s.z_threshold ? 'noise' : 'passes';
    for (const f of fs) {
      const key = `${f.cluster_id}|${f.grade}|${f.competency_id}`;
      const x = byKey.get(key);
      if (!x) continue;
      const drivers = (JSON.parse(f.driver_schools || '[]') as { school_id: string; prev_pct: number; curr_pct: number; change_pp: number; contribution_share: number }[]).map((d) => {
        const p = pct.get(`${prevId}|${d.school_id}|${f.competency_id}`), q2 = pct.get(`${currId}|${d.school_id}|${f.competency_id}`);
        if (!p || !q2 || !p.n_assessed || !q2.n_assessed) return d;
        const pp = (100 * p.n_proficient) / p.n_assessed, cp = (100 * q2.n_proficient) / q2.n_assessed;
        return { ...d, prev_pct: r1(pp), curr_pct: r1(cp), change_pp: r1(cp - pp) };
      });
      upd.run(x.prev_value_pct, x.curr_value_pct, x.change_pp, x.district_change_pp, x.relative_change_pp, x.z_score, x.n_prev, x.n_curr,
        JSON.stringify(x.dq_checks), JSON.stringify(drivers), f.id);
      const b = before.get(key);
      log.run(f.id, b?.z_score ?? f.z_score, x.z_score, b?.change_pp ?? f.change_pp, x.change_pp, b?.relative_change_pp ?? f.relative_change_pp, x.relative_change_pp, gate(b), gate(x));
    }
  }
}

/** Outcome checks on Class 3, recomputed from the calibrated school results with the settings each plan locked. */
function remeasureOutcomes(c: DatabaseSync) {
  const outs = q<{ id: string; grade: number; competency_id: string; baseline_round_id: string; followup_round_id: string; treated: string; comparison: string;
    success_threshold_pp: number; settings_version_id: string; did_pp: number | null; category: string; delivery_verified: number; cross_source_verified: number }>(
    c, `select id, grade, competency_id, baseline_round_id, followup_round_id, treated, comparison, success_threshold_pp, settings_version_id, did_pp, category,
               delivery_verified, cross_source_verified
          from outcome_evaluations where grade = ${CAL_GRADE}`);
  const settings = new Map(q<{ id: string; outcome: string }>(c, 'select id, outcome from setting_versions').map((s) => [s.id, JSON.parse(s.outcome) as { participation_floor_ratio: number; min_participation: number }]));
  const res = c.prepare('select pct_proficient from assessment_results where school_id = ? and round_id = ? and grade = ? and competency_id = ?');
  // The check is re-derived exactly as write.ts derives it, so re-running it gives the stored answer.
  const upd = c.prepare(`update outcome_evaluations set treated = ?, comparison = ?, treated_baseline_mean = ?, treated_followup_mean = ?,
      comparison_baseline_mean = ?, comparison_followup_mean = ?, treated_change_pp = ?, comparison_change_pp = ?, did_pp = ?, ci_low_pp = ?, ci_high_pp = ?,
      ci_method = ?, participation_check = ?, category = ?, closure_eligible = ?, closure_blockers = ? where id = ?`);
  const log = c.prepare('insert into realdata_outcomes values (?,?,?,?,?) on conflict(outcome_id) do update set did_after = excluded.did_after, category_after = excluded.category_after');
  for (const o of outs) {
    const s = settings.get(o.settings_version_id);
    if (!s) continue;
    const reread = (list: OutcomeSchoolRow[]) => list.map((r) => {
      const b = r.baseline_pct === null ? null : (res.get(r.school_id, o.baseline_round_id, o.grade, o.competency_id) as { pct_proficient: number } | undefined)?.pct_proficient ?? r.baseline_pct;
      const f = r.followup_pct === null ? null : (res.get(r.school_id, o.followup_round_id, o.grade, o.competency_id) as { pct_proficient: number } | undefined)?.pct_proficient ?? r.followup_pct;
      return { ...r, baseline_pct: b, followup_pct: f };
    });
    const t = reread(JSON.parse(o.treated) as OutcomeSchoolRow[]);
    const cm = reread(JSON.parse(o.comparison) as OutcomeSchoolRow[]);
    const x = evaluateOutcome(t, cm, { success_threshold_pp: o.success_threshold_pp, participation_floor_ratio: s.participation_floor_ratio, min_participation: s.min_participation });
    const close = closureEligibility({
      allTasksVerified: !!o.delivery_verified, crossSourceVerified: !!o.cross_source_verified,
      outcomeCategory: x.category, participationPassed: x.participation_check.passed,
    });
    upd.run(JSON.stringify(t), JSON.stringify(cm), x.treated_baseline_mean, x.treated_followup_mean, x.comparison_baseline_mean, x.comparison_followup_mean,
      x.treated_change_pp, x.comparison_change_pp, x.did_pp, x.ci_low_pp, x.ci_high_pp, x.ci_method, JSON.stringify(x.participation_check), x.category,
      close.eligible ? 1 : 0, JSON.stringify(close.blockers), o.id);
    const prev = one<{ did_before: number | null; category_before: string }>(c, 'select did_before, category_before from realdata_outcomes where outcome_id = ?', o.id);
    log.run(o.id, prev ? prev.did_before : o.did_pp, x.did_pp, prev ? prev.category_before : o.category, x.category);
  }
}

// ------------------------------------------------------------------ costs
function applyCosts(c: DatabaseSync, figures: RealFigures) {
  const rows = q<{ id: string; cost_basis: string }>(c, 'select id, cost_basis from interventions');
  const upd = c.prepare('update interventions set cost_basis = ? where id = ?');
  for (const r of rows) {
    const card = figures.pab.cards[r.id];
    const cur = JSON.parse(r.cost_basis || '{}') as Record<string, unknown>;
    const illustrative = (cur.illustrative_original ?? (cur.illustrative ? { amount_inr: cur.amount_inr, unit: cur.unit } : null)) as { amount_inr: number; unit: string } | null;
    if (!card) continue;
    const line = figures.pab.lines[card.line];
    upd.run(JSON.stringify({
      amount_inr: card.amount_inr,
      amount_composite_inr: card.amount_composite_inr,
      unit: card.unit,
      per: card.per,
      basis: card.basis,
      illustrative: false,
      note: `${card.basis === 'pab' ? 'UP PAB 2025-26 unit cost' : 'UP PAB 2025-26 rate from a neighbouring line'}: ${line.line_en}. ${card.note_en}`,
      note_hi: `${card.basis === 'pab' ? 'उ.प्र. PAB 2025-26 इकाई लागत' : 'उ.प्र. PAB 2025-26 की निकट पंक्ति की दर'}: ${line.line_hi}। ${card.note_hi}`,
      citation: { doc: figures.pab.title, url: figures.pab.url, pdf_page: card.pdf_page, printed_page: card.printed, line: line.line_en },
      illustrative_original: illustrative,
    }), r.id);
  }
}
