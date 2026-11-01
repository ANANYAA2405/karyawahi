/**
 * The real-data layer: real schools (anonymised), Class 3 results calibrated to PRS 2024, PAB
 * 2025-26 costs on the intervention cards, and the fallback when the files are missing.
 *
 * Without a URL it runs on scratch copies of the pristine seed and restores the demo database
 * afterwards (do not run it while a server holds the database). With a base URL it leaves the
 * database alone, signs in over HTTP and scans pages and API answers for real school names and
 * UDISE codes, and checks the Sources page, the costs, the labels and the banner:
 *
 *   npx tsx --conditions=react-server scripts/realdata-test.mts
 *   npx tsx --conditions=react-server scripts/realdata-test.mts http://localhost:3081
 *
 * When the raw downloads are present (.data/sources/udise/), the scan looks for every real
 * school name and UDISE code in the three districts; without them it looks for anything shaped
 * like a UDISE code and checks every school carries the anonymised label.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const APP = process.cwd();
const DATA = join(APP, '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.realdatatestbackup.db');
const SCRATCH = join(DATA, 'realdata-test-fallback.db');
const BASE = process.argv[2]?.replace(/\/$/, '') ?? null;
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };

// ------------------------------------------------------------------ what a leak would look like
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); f = ''; rows.push(row); row = []; } else if (ch !== '\r') f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const UDISE_DIR = join(DATA, 'sources', 'udise');
const GENERIC = new Set(['P.S.', 'PS', 'U.P.S.', 'UPS', 'PRIMARY', 'SCHOOL', 'UPPER', 'COMPOSITE', 'GOVT', 'GOVT.', 'GOVERNMENT', 'P.S', 'U.P.S', 'PRATHMIK', 'VIDYALAYA', 'PRA.', 'VI.', 'KANYA', 'JUNIOR', 'HIGH', 'MADARSA', 'PUBLIC', 'ACADEMY', 'CONVENT', 'SCHOOL,', 'NO.', '1', '2', '3', 'I', 'II', 'III', '-', 'AND', 'OF', 'THE']);
const realNames: string[] = []; const realCodes = new Set<string>();
const haveSources = existsSync(UDISE_DIR) && readdirSync(UDISE_DIR).some((f) => f.endsWith('.csv'));
if (haveSources) {
  for (const f of readdirSync(UDISE_DIR).filter((x) => x.endsWith('.csv'))) {
    for (const r of parseCsv(readFileSync(join(UDISE_DIR, f), 'utf8'))) {
      const code = r.udise_school_code?.trim();
      if (code) { realCodes.add(code); realCodes.add(code.padStart(11, '0')); }
      const name = (r.school_name ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
      // A name made only of generic words ("PRIMARY SCHOOL") identifies nothing and would match ordinary text.
      if (name.length >= 8 && name.split(' ').some((w) => !GENERIC.has(w) && w.length >= 3)) realNames.push(name);
    }
  }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRe = realNames.length ? new RegExp(`(?:^|[^A-Z0-9])(${[...new Set(realNames)].sort((a, b) => b.length - a.length).map(esc).join('|')})(?=$|[^A-Z0-9])`) : null;
const codeShape = /(?<![0-9])(?:09\d{9}|9\d{9})(?![0-9])/g;
/** The first real school name or UDISE code found in the text, or null. */
function leak(text: string): string | null {
  const T = text.toUpperCase().replace(/\s+/g, ' ');
  if (nameRe) { const m = nameRe.exec(T); if (m) return `name "${m[1]}"`; }
  for (const m of text.matchAll(codeShape)) {
    if (!haveSources || realCodes.has(m[0])) return `code-like number ${m[0]}`;
  }
  return null;
}

// Over HTTP the server holds the demo database, so only the pages are checked.
if (!BASE) { swap(LIVE, BACKUP); swap(PRISTINE, LIVE); }
try {
  if (!BASE) {
  const { one, all } = await import('../src/lib/db');
  const sources = await import('../src/lib/sources');
  const rd = await import('../src/lib/ext/realdata');
  const { schoolName } = await import('../src/lib/school-label');
  const figures = rd.realFigures();
  const pristine = new DatabaseSync(PRISTINE, { readOnly: true });

  console.log(`--- the files (${haveSources ? `downloads present: ${realNames.length} distinctive names, ${realCodes.size / 2} codes to look for` : 'downloads absent: shape checks only'}) ---`);
  ok('data/real/schools.json and figures.json are present', !!rd.realSchools() && !!figures);
  const committed = ['schools.json', 'figures.json'].map((f) => readFileSync(join(APP, 'data', 'real', f), 'utf8')).join('\n');
  ok('the committed files hold no school name or UDISE code', !leak(committed) && !/"(school_name|udise_school_code|udise_code|village)"\s*:/.test(committed), leak(committed) ?? 'a name or code field');
  ok('no committed file under data/ or samples/ carries a real name or code', (() => {
    for (const dir of ['data', 'samples']) for (const f of readdirSync(join(APP, dir))) {
      const p = join(APP, dir, f);
      if (statSync(p).isFile() && statSync(p).size < 5e6 && leak(readFileSync(p, 'utf8'))) return false;
    }
    return true;
  })());

  console.log('\n--- real schools, anonymised ---');
  one('select 1');
  const schools = all<{ id: string; name: string; provenance: string; enrolment_g3: number; teachers_in_position: number }>('select id, name, provenance, enrolment_g3, teachers_in_position from schools');
  ok('every school is a real UDISE+ school', schools.every((s) => s.provenance === 'udise_anonymised'), `${schools.filter((s) => s.provenance !== 'udise_anonymised').length} not`);
  ok('every school carries the anonymised label "School NNNN · <block>"', schools.every((s) => /^School \d{4} · [A-Za-z ]+$/.test(s.name) && s.name.slice(7, 11) === s.id.slice(-4)));
  ok('the label has real Hindi', schoolName('School 0412 · Rampur Sadar', 'hi') === 'विद्यालय 0412 · रामपुर सदर');
  const file = rd.realSchools()!.schools;
  ok('enrolment and teachers come from the file', schools.every((s) => file[s.id] && file[s.id].enr[2] === s.enrolment_g3 && file[s.id].teachers === s.teachers_in_position));
  const geo = all<{ id: string; geometry_source: string; centroid_lon: number; centroid_lat: number; name: string }>(`select id, geometry_source, centroid_lon, centroid_lat, name from geo_units where level = 'school'`);
  ok('every school is pinned at its (moved) UDISE+ position', geo.length === 2109 && geo.every((g) => g.geometry_source === 'udise' && file[g.id] && g.centroid_lon === file[g.id].pos[0] && g.centroid_lat === file[g.id].pos[1]));
  const ids = new Set(pristine.prepare('select id from schools').all().map((r) => (r as { id: string }).id));
  ok('the case ledger keeps its school ids, blocks and clusters', schools.length === ids.size && schools.every((s) => ids.has(s.id))
    && Number(one<{ c: number }>(`select count(*) c from schools s join clusters c on c.id = s.cluster_id and c.block_id = s.block_id`)!.c) === 2109);
  const textCols: [string, string][] = [['schools', 'name'], ['geo_units', 'name'], ['geo_units', 'note'], ['school_profile', 'label_en'], ['school_profile', 'label_hi'],
    ['cases', 'title'], ['notifications', 'title'], ['notifications', 'body'], ['findings', 'driver_schools'], ['interventions', 'cost_basis']];
  let dbLeak: string | null = null;
  for (const [t, c] of textCols) {
    try { for (const r of all<{ v: string }>(`select ${c} v from ${t} where ${c} is not null`)) { const l = leak(String(r.v)); if (l) { dbLeak = `${t}.${c}: ${l}`; break; } } } catch { /* column absent */ }
    if (dbLeak) break;
  }
  ok('no real school name or UDISE code in the columns the interface reads', !dbLeak, dbLeak ?? '');
  const profileCols = all<{ name: string }>(`select name from pragma_table_info('school_profile')`).map((r) => r.name);
  ok('school_profile stores no name, code or village column', !profileCols.some((c) => /udise|code|village|^name$/.test(c)), profileCols.join(','));

  console.log('\n--- calibration to PRS 2024 ---');
  const recon = sources.reconciliation();
  ok('six district × subject rows', recon.length === 6);
  for (const r of recon) ok(`${r.district} ${r.subject}: simulated ${r.simulated} vs PRS ${r.published} — within 1 pp`, r.diff !== null && Math.abs(r.diff) <= 1);
  const touched = Number(one<{ c: number }>(`select count(*) c from assessment_results a join realdata_assess_orig o on o.id = a.id`)!.c);
  ok('only Class 3 rows in rounds R0–R3 were touched', Number(one<{ c: number }>(`select count(*) c from realdata_assess_orig o join assessment_results a on a.id = o.id where a.grade <> 3 or a.round_id not in ('RND-2025-02','RND-2025-07','RND-2026-02','RND-2026-07')`)!.c) === 0 && touched > 0);
  ok('n_proficient stays consistent with pct_proficient and within 0..n_assessed', Number(one<{ c: number }>(`select count(*) c from assessment_results where grade = 3 and n_assessed > 0
      and (n_proficient < 0 or n_proficient > n_assessed or abs(pct_proficient - round(100.0 * n_proficient / n_assessed, 1)) > 0.051)`)!.c) === 0);
  const g12 = pristine.prepare(`select sum(n_proficient) p from assessment_results where grade in (1, 2)`).get() as { p: number };
  ok('Classes 1 and 2 are not changed', Number(one<{ p: number }>(`select sum(n_proficient) p from assessment_results where grade in (1, 2)`)!.p) === Number(g12.p));

  console.log('\n--- drops, findings and cases unchanged ---');
  const before = new Map((pristine.prepare('select id, status, case_id, grade, change_pp, relative_change_pp, district_change_pp, driver_schools from findings').all() as Record<string, unknown>[]).map((r) => [r.id as string, r]));
  const after = all<Record<string, unknown>>('select id, status, case_id, grade, change_pp, relative_change_pp, district_change_pp, driver_schools from findings');
  const ids2 = (j: unknown) => (JSON.parse(String(j)) as { school_id: string }[]).map((d) => d.school_id).join(',');
  ok('every finding keeps its status, case and driver schools', after.length === before.size && after.every((f) => { const b = before.get(f.id as string)!; return b && b.status === f.status && b.case_id === f.case_id && ids2(b.driver_schools) === ids2(f.driver_schools); }));
  ok('findings on Classes 1 and 2 are untouched', after.filter((f) => f.grade !== 3).every((f) => { const b = before.get(f.id as string)!; return b.change_pp === f.change_pp && b.relative_change_pp === f.relative_change_pp; }));
  const g3 = after.filter((f) => f.grade === 3).map((f) => { const b = before.get(f.id as string)!; return { rel: Math.abs(Number(f.relative_change_pp) - Number(b.relative_change_pp)), chg: Math.abs(Number(f.change_pp) - Number(b.change_pp)), dist: Math.abs(Number(f.district_change_pp) - Number(b.district_change_pp)) }; });
  const within1 = g3.filter((x) => x.rel <= 1 && x.chg <= 1).length;
  const maxRel = Math.max(...g3.map((x) => x.rel)), maxChg = Math.max(...g3.map((x) => x.chg)), maxDist = Math.max(...g3.map((x) => x.dist));
  console.log(`  --   Class 3 findings: ${g3.length}; drop moved ≤ 1 pp in ${within1}; largest move: change ${maxChg.toFixed(1)} pp, vs district ${maxRel.toFixed(1)} pp, district change ${maxDist.toFixed(1)} pp`);
  ok('every Class 3 drop (cluster change and change beyond the district) moves by at most 2.5 pp', maxRel <= 2.5 && maxChg <= 2.5);
  ok('at least 95% of Class 3 drops move by at most 1 pp', within1 >= 0.95 * g3.length, `${within1}/${g3.length}`);
  const titles = all<{ id: string; title: string; change_pp: number }>(`select c.id, c.title, f.change_pp from cases c join findings f on f.id = c.finding_id where f.grade = 3`);
  const titleDrift = titles.map((t) => { const m = /fell ([\d.]+) pts/.exec(t.title); return m ? Math.abs(Number(m[1]) + t.change_pp) : 0; });
  ok('case titles ("fell X pts") still match the re-measured drop within 2.5 pts', titleDrift.every((d) => d <= 2.5), `max ${Math.max(...titleDrift).toFixed(1)}`);
  const gates = all<{ gate_before: string; gate_after: string; status: string }>(`select r.gate_before, r.gate_after, f.status from realdata_findings r join findings f on f.id = r.finding_id`);
  ok('no case-opened finding falls below the materiality line', gates.filter((g) => g.status === 'case_opened').every((g) => g.gate_after !== 'below_materiality'));
  const moved = gates.filter((g) => g.gate_before !== g.gate_after);
  console.log(`  --   ${moved.length} of ${gates.length} Class 3 findings would pass or fail the z-test differently on the calibrated level (the decision stays; the finding page says so)`);
  ok('the detection gates agree for at least 85% of Class 3 findings', gates.length > 0 && moved.length <= 0.15 * gates.length, `${moved.length}/${gates.length}`);
  const { detectFindings } = await import('../../src/domain/detect');
  const set1 = JSON.parse(one<{ detection: string }>(`select detection from setting_versions where id = 'SET-v1'`)!.detection);
  const rowsOf = (r: string) => all<{ school_id: string; grade: number; competency_id: string; enrolled: number; n_assessed: number; n_proficient: number }>(`select school_id, grade, competency_id, enrolled, n_assessed, n_proficient from assessment_results where round_id = ? and grade = 3`, r);
  const sch = all<{ id: string; cluster_id: string; block_id: string; district_id: string }>('select id, cluster_id, block_id, district_id from schools');
  const cand = detectFindings(rowsOf('RND-2025-07'), rowsOf('RND-2026-02'), sch, { ...set1, materiality_pp: -1e9 });
  const stored = all<{ cluster_id: string; competency_id: string; change_pp: number; z_score: number }>(`select cluster_id, competency_id, change_pp, z_score from findings where grade = 3 and round_id = 'RND-2026-02' and settings_version_id = 'SET-v1'`);
  ok('stored Class 3 findings are what the detector measures on the calibrated rows', stored.length > 0 && stored.every((f) => { const c = cand.find((x) => x.cluster_id === f.cluster_id && x.competency_id === f.competency_id); return !!c && c.change_pp === f.change_pp && c.z_score === f.z_score; }));
  const outs = all<{ category_before: string; category_after: string }>('select category_before, category_after from realdata_outcomes');
  console.log(`  --   ${outs.filter((o) => o.category_before !== o.category_after).length} of ${outs.length} Class 3 outcome checks read differently after calibration (re-derived; the case page says so)`);
  ok('case statuses are untouched', (() => { const p = new Map((pristine.prepare('select id, status, closure_type from cases').all() as { id: string; status: string; closure_type: string | null }[]).map((r) => [r.id, `${r.status}|${r.closure_type}`])); return all<{ id: string; status: string; closure_type: string | null }>('select id, status, closure_type from cases').every((c) => p.get(c.id) === `${c.status}|${c.closure_type}`); })());
  const { verifyAuditChain } = await import('../src/lib/feed');
  const { loadSession } = await import('../src/lib/session');
  const auditorId = one<{ user_id: string }>(`select user_id from user_roles where role in ('auditor', 'demo_admin') order by role limit 1`)!.user_id;
  const v = verifyAuditChain(loadSession(auditorId)!);
  ok('the audit chain still verifies (links and content)', v.checked > 0 && v.linked && v.contentOk, JSON.stringify(v));

  console.log('\n--- PAB 2025-26 costs carry citations ---');
  const cards = figures!.pab.cards;
  const ivs = all<{ id: string; cost_basis: string }>('select id, cost_basis from interventions').map((r) => ({ id: r.id, cb: JSON.parse(r.cost_basis) }));
  ok('nine cards carry a PAB cost', Object.keys(cards).length === 9 && ivs.filter((i) => i.cb.citation).length === 9);
  ok('each one: amount, unit, basis, page and archived link', ivs.filter((i) => cards[i.id]).every((i) => i.cb.illustrative === false && i.cb.amount_inr === cards[i.id].amount_inr
    && i.cb.unit === cards[i.id].unit && ['pab', 'pab_proxy'].includes(i.cb.basis) && Number.isInteger(i.cb.citation.pdf_page) && /^https:\/\/web\.archive\.org\//.test(i.cb.citation.url)));
  ok('every other card is still marked illustrative', ivs.filter((i) => !cards[i.id]).every((i) => i.cb.illustrative === true && !i.cb.citation));
  ok('the known unit costs: TLM ₹165/child, library ₹2,000/₹3,000, teacher material ₹100, community ₹1,500, in-service ₹1,500, assessment ₹65, remedial ₹500',
    cards['INT-08'].amount_inr === 165 && cards['INT-16'].amount_inr === 2000 && cards['INT-16'].amount_composite_inr === 3000 && cards['INT-05'].amount_inr === 100
    && cards['INT-10'].amount_inr === 1500 && cards['INT-14'].amount_inr === 1500 && cards['INT-15'].amount_inr === 65 && cards['INT-01'].amount_inr === 500);
  const plans = await import('../src/lib/plans');
  const studio = await import('../src/lib/studio');
  const repo = await import('../src/lib/repo');
  const sample = all<{ id: string }>(`select id from schools where block_id = 'BLK-01' order by id limit 4`).map((r) => r.id);
  const counts = plans.planCounts(sample, 3);
  const tlm = studio.feasibility(repo.intervention('INT-08')!, { schools: 4, budgetInr: null, teachersAvailable: null, weeksAvailable: null, attendancePct: null, trainingComplete: false, connectivity: false, ...counts });
  ok('a plan estimate multiplies the PAB unit cost by the real Class 3 enrolment', counts.children > 0 && tlm.totalCost === 165 * counts.children, `${tlm.totalCost} vs 165 × ${counts.children}`);

  console.log('\n--- without the files, and without the downloads ---');
  ok('the app reads only data/real/, never .data/sources/', (() => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    return walk(join(APP, 'src')).every((f) => !/\.data[\\/]sources|'sources'\)/.test(readFileSync(f, 'utf8')));
  })());
  const empty = mkdtempSync(join(tmpdir(), 'kv-noreal-'));
  const copyDir = mkdtempSync(join(tmpdir(), 'kv-real-'));
  try {
    const { ensureExtensions } = await import('../src/lib/ext/schema');
    for (const [dir, label] of [[empty, 'missing'], [copyDir, 'copied elsewhere']] as const) {
      if (dir === copyDir) for (const f of ['schools.json', 'figures.json']) copyFileSync(join(APP, 'data', 'real', f), join(copyDir, f));
      process.env.KV_REAL_DATA_DIR = dir;
      for (const s of ['', '-wal', '-shm']) rmSync(`${SCRATCH}${s}`, { force: true });
      copyFileSync(PRISTINE, SCRATCH);
      const c = new DatabaseSync(SCRATCH);
      ensureExtensions(c);
      const prov = c.prepare(`select provenance p, count(*) n from schools group by 1`).all() as { p: string; n: number }[];
      const src = c.prepare(`select geometry_source g, count(*) n from geo_units where level = 'school' group by 1`).all() as { g: string; n: number }[];
      if (label === 'missing') {
        ok('with data/real/ missing the app runs on the fictional seed', prov.length === 1 && prov[0].p === 'synthetic_demo' && src[0]?.g === 'simulated'
          && !c.prepare(`select 1 from sqlite_master where name = 'school_profile'`).get());
      } else {
        ok('with only the two committed files (no downloads needed) the real layer applies', prov.length === 1 && prov[0].p === 'udise_anonymised' && src[0]?.g === 'udise');
      }
      c.close();
    }
  } finally {
    delete process.env.KV_REAL_DATA_DIR;
    for (const s of ['', '-wal', '-shm']) rmSync(`${SCRATCH}${s}`, { force: true });
    rmSync(empty, { recursive: true, force: true }); rmSync(copyDir, { recursive: true, force: true });
  }
  pristine.close();
  }

  if (BASE) {
    console.log(`\n--- over HTTP: ${BASE} ---`);
    const post = (path: string, body: Record<string, string>) => fetch(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams(body), headers: { origin: BASE }, redirect: 'manual' });
    const cookieOf = (r: Response) => /kv_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const pagesFor: Record<string, string[]> = {
      'state.lead@demo.karyavahi.test': ['/overview', '/hotspots', '/schools', '/schools/SCH-00001', '/schools/SCH-01200', '/cases/CASE-0184', '/interventions', '/interventions/INT-08', '/interventions/INT-16',
        '/findings', '/api/geo/map', '/api/geo/map?parent=DST-01', '/api/geo/map?parent=BLK-01', '/api/geo/map?parent=CLU-001', '/api/geo/detail?id=SCH-00001', '/api/geo/detail?id=DST-02', '/search?q=school', '/reports', '/sources'],
      'deo.rmp@demo.karyavahi.test': ['/district', '/hotspots', '/cases/CASE-0184', '/schools'],
      'hm.sch-00002@demo.karyavahi.test': ['/school', '/today'],
    };
    let scanned = 0; let httpLeak: string | null = null; let bad: string | null = null;
    for (const [email, paths] of Object.entries(pagesFor)) {
      const r = await post('/api/sign-in', { email });
      const ck = cookieOf(r);
      if (!ck) { bad = `could not sign in as ${email}`; break; }
      for (const lang of ['en', 'hi']) {
        for (const p of paths) {
          const res = await fetch(`${BASE}${p}`, { headers: { cookie: `kv_session=${ck}; kv_lang=${lang}` }, redirect: 'manual' });
          const body = await res.text();
          if (res.status >= 400 && res.status !== 404) { bad = `${p} → ${res.status}`; }
          scanned++;
          const l = leak(body);
          if (l) { httpLeak = `${p} (${lang}): ${l}`; break; }
        }
        if (httpLeak) break;
      }
      if (httpLeak) break;
    }
    ok(`no real school name or UDISE code in ${scanned} pages and API answers (two languages, three roles)`, !httpLeak && !bad, httpLeak ?? bad ?? '');
    const pub = await (await fetch(`${BASE}/sources`)).text();
    ok('/sources is public and carries the reconciliation table and every source', pub.includes('reconciliation') && ['UDISE+', 'PARAKH', 'ASER', 'NFHS', 'PAB', 'LGD', 'OpenStreetMap'].every((k) => pub.includes(k)));
    const pubHi = await (await fetch(`${BASE}/sources`, { headers: { cookie: 'kv_lang=hi' } })).text();
    ok('/sources has Hindi', pubHi.includes('स्रोत और श्रेय'));
    const st = await post('/api/sign-in', { email: 'state.lead@demo.karyavahi.test' });
    const ck = cookieOf(st);
    const iv = await (await fetch(`${BASE}/interventions/INT-08`, { headers: { cookie: `kv_session=${ck}; kv_lang=en` } })).text();
    ok('an intervention page shows the PAB cost with its page', iv.includes('UP PAB 2025-26') && iv.includes('p. 48') && iv.includes('₹165'));
    const sp = await (await fetch(`${BASE}/schools/SCH-00412`, { headers: { cookie: `kv_session=${ck}; kv_lang=hi` } })).text();
    ok('a school page shows the anonymised label in Hindi and the UDISE+ profile', sp.includes('विद्यालय 0412') && (sp.includes('UDISE+') || sp.includes('यू-डाइस+')));
    const hs = await (await fetch(`${BASE}/hotspots`, { headers: { cookie: `kv_session=${ck}; kv_lang=en` } })).text();
    ok('the hotspot view shows district context labelled "context, not cause"', hs.includes('Context, not cause') && hs.includes('ASER 2024') && hs.includes('NFHS-5'));
    const ov = await (await fetch(`${BASE}/overview`, { headers: { cookie: `kv_session=${ck}; kv_lang=en` } })).text();
    ok('the demo banner says what is real and links to /sources', ov.includes('DEMO MODE') && ov.includes('UDISE+') && ov.includes('PRS 2024') && ov.includes('href="/sources"'));
  }
} catch (e) {
  fail++;
  console.log(`  FAIL the test crashed: ${(e as Error).stack}`);
} finally {
  if (!BASE) {
    const { db } = await import('../src/lib/db');
    try { db().close(); } catch { /* already closed */ }
    swap(BACKUP, LIVE);
    for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
