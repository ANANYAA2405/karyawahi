/**
 * Writes a realistic CSV for round R4 (Midline 2026-27, RND-2026-11) from the data already in
 * the database, so the round-import demo can run end to end.
 *
 * How the numbers are made (deterministic — same database, same options, same file):
 *   - every school that reported in R3 (July 2026) reports again; enrolment is the same cohort,
 *     participation moves a little around its July value
 *   - each grade x competency starts from the school's July result, plus a small midline gain
 *     (four months more teaching), then children are "assessed" by binomial sampling
 *   - schools whose case plan is due to be judged on R4 get a modest treatment effect, which
 *     varies by case (some plans work, some do not)
 *   - a few clusters get a planted drop in one grade x competency, so the detector has new
 *     hotspots to find; CLU-001 (the hero cluster) is left alone
 *
 *   npx tsx scripts/gen-r4.mts                       Rampur Sadar block (BLK-01), clean
 *   npx tsx scripts/gen-r4.mts --errors              ... plus one row of each kind of mistake
 *   npx tsx scripts/gen-r4.mts --scope DST-01        a whole district
 *   npx tsx scripts/gen-r4.mts --scope all           the whole state (~37,000 rows)
 *   npx tsx scripts/gen-r4.mts --out some/file.csv
 *
 * Reads the database only; writes nothing to it.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as rngModule from '../../src/lib/rng';
// The seed library is compiled as CommonJS here; take the named export from either shape.
const { rngFor } = ((rngModule as unknown as { default?: typeof rngModule }).default ?? rngModule);

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const scope = opt('--scope') ?? 'BLK-01';
const withErrors = args.includes('--errors');
const out = opt('--out') ?? join('samples', `R4_midline_${scope === 'all' ? 'all' : scope}${withErrors ? '_with_errors' : ''}.csv`);

const LIVE = join('.data', 'karyavahi.db');
const PRISTINE = join('.data', 'karyavahi.pristine.db');
const db = new DatabaseSync(existsSync(LIVE) ? LIVE : PRISTINE, { readOnly: true });
const q = <T,>(sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as unknown as T[];

const R3 = 'RND-2026-07';
const R4 = 'RND-2026-11';
const SEED = 20261116;

interface School { id: string; cluster_id: string; block_id: string; district_id: string }
const schools = q<School>('select id, cluster_id, block_id, district_id from schools order by id');
const inScope = (s: School) => scope === 'all' || s.block_id === scope || s.district_id === scope || s.cluster_id === scope;
const chosen = schools.filter(inScope);
if (chosen.length === 0) { console.error(`No schools match --scope ${scope}.`); process.exit(1); }
const chosenIds = new Set(chosen.map((s) => s.id));

const comps = q<{ id: string; code: string }>('select id, code from competencies order by id');
const codeOf = new Map(comps.map((c) => [c.id, c.code]));

interface Row { school_id: string; grade: number; competency_id: string; enrolled: number; n_assessed: number; pct_proficient: number; participation_rate: number }
const july = q<Row>(
  `select school_id, grade, competency_id, enrolled, n_assessed, pct_proficient, participation_rate
     from assessment_results where round_id = ? order by school_id, grade, competency_id`, R3,
).filter((r) => chosenIds.has(r.school_id));

// Treatment: plans whose pre-registered follow-up is R4.
const treated = new Map<string, number>(); // "school|grade|comp" -> effect on p
for (const p of q<{ case_id: string; grade: number; competency_id: string; school_ids: string }>(
  `select c.id case_id, c.grade, c.competency_id, pl.school_ids
     from cases c join case_plans pl on pl.id = c.current_plan_id
    where json_extract(pl.pre_registration, '$.followup_round_id') = ?
      and c.status in ('assigned', 'in_progress', 'awaiting_verification', 'outcome_pending')`, R4,
)) {
  const g = rngFor(SEED, `treat:${p.case_id}`);
  const effect = g.float(-0.02, 0.13); // some plans move the needle, some do not
  for (const sid of JSON.parse(p.school_ids) as string[]) treated.set(`${sid}|${p.grade}|${p.competency_id}`, effect);
}

// Planted drops: about one cluster in six, never the hero cluster.
const clusters = [...new Set(chosen.map((s) => s.cluster_id))].filter((c) => c !== 'CLU-001').sort();
const pick = rngFor(SEED, `shocks:${scope}`);
const nShocks = Math.max(2, Math.round(clusters.length / 6));
const shocks = new Map<string, { grade: number; competency_id: string; cut: number }>();
while (shocks.size < Math.min(nShocks, clusters.length)) {
  const c = clusters[pick.int(0, clusters.length - 1)];
  if (shocks.has(c)) continue;
  shocks.set(c, { grade: pick.int(1, 3), competency_id: comps[pick.int(0, comps.length - 1)].id, cut: pick.float(0.35, 0.5) });
}
const clusterOf = new Map(schools.map((s) => [s.id, s.cluster_id]));

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lines = ['round_code,school_id,grade,competency_code,enrolled,n_assessed,n_proficient,assessment_date'];
const julyParticipation = new Map<string, number>();
for (const r of july) if (!julyParticipation.has(r.school_id)) julyParticipation.set(r.school_id, r.participation_rate);
const participationBySchool = new Map<string, number>();
for (const r of july) {
  const g = rngFor(SEED, `${r.school_id}|${r.grade}|${r.competency_id}`);
  if (!participationBySchool.has(r.school_id)) {
    const base = julyParticipation.get(r.school_id)!;
    participationBySchool.set(r.school_id, clamp(base + rngFor(SEED, `part:${r.school_id}`).normal(0, 0.03), 0.45, 0.99));
  }
  const participation = participationBySchool.get(r.school_id)!;
  const enrolled = r.enrolled;
  const nA = Math.max(1, Math.round(enrolled * participation));
  let p = clamp(r.pct_proficient / 100 + 0.04 + g.normal(0, 0.02), 0.03, 0.97);
  p = clamp(p + (treated.get(`${r.school_id}|${r.grade}|${r.competency_id}`) ?? 0), 0.03, 0.97);
  const shock = shocks.get(clusterOf.get(r.school_id)!);
  if (shock && shock.grade === r.grade && shock.competency_id === r.competency_id && g.chance(0.85)) p = clamp(p * (1 - shock.cut), 0.03, 0.97);
  const nP = g.binomial(nA, p);
  const day = 16 + (parseInt(r.school_id.slice(-3), 10) % 5); // 16–20 Nov
  lines.push(`R4,${r.school_id},${r.grade},${codeOf.get(r.competency_id)},${enrolled},${nA},${nP},2026-11-${day}`);
}

if (withErrors) {
  const first = july[0];
  const code = codeOf.get(first.competency_id);
  const outside = schools.find((s) => !inScope(s));
  lines.push(
    `R4,SCH-99999,1,L1,30,27,12,2026-11-18`,                                                  // unknown school
    `R4,${first.school_id},${first.grade},${code},${first.enrolled},20,25,2026-11-18`,          // proficient > assessed
    `R4,${first.school_id},${first.grade},${code},${first.enrolled},20,9,31-11-2026`,           // unreadable date
    `R4,${first.school_id},${first.grade},${code},${first.enrolled},20,9,2026-10-02`,           // outside the window
    `R4,${first.school_id},${first.grade},${code},${first.enrolled},,9,2026-11-18`,             // blank n_assessed
    `R4,${first.school_id},${first.grade},${code},forty,20,9,2026-11-18`,                       // not a number
    `R4,${first.school_id},${first.grade},N9,${first.enrolled},20,9,2026-11-18`,                // unknown competency
    lines[1],                                                                                   // duplicate of row 2
  );
  if (outside && scope !== 'all') lines.push(`R4,${outside.id},1,L1,30,27,12,2026-11-18`);   // not in the uploader's area
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${out}: ${lines.length - 1} rows for ${chosen.length} schools in ${scope}.`);
console.log(`Planted drops: ${[...shocks.entries()].map(([c, s]) => `${c} grade ${s.grade} ${codeOf.get(s.competency_id)} (-${Math.round(s.cut * 100)}%)`).join('; ')}`);
console.log(`Treated school-rows judged on R4: ${[...treated.keys()].filter((k) => chosenIds.has(k.split('|')[0])).length}`);
