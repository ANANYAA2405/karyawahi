#!/usr/bin/env node
/**
 * Downloads the public sources the demo's real-data layer is built from, into
 * app/.data/sources/<source>/ (git-ignored; raw downloads are never committed).
 *
 *   npm run data:fetch                 # everything that is not already downloaded
 *   npm run data:fetch -- --only udise # one source (udise, parakh, aser, nfhs, pab, lgd)
 *   npm run data:fetch -- --force      # download again even if a good copy exists
 *
 * Then `npm run data:build` turns the downloads into the small, anonymised files in data/real/
 * that the app reads (see scripts/build-real-data.mjs).
 *
 * Rules this script keeps:
 * - throttled: one request every 4 s to the India Data Portal, backing off on HTTP 429/5xx;
 * - resumable: each UDISE+ page is saved on its own, so a rerun picks up where it stopped;
 * - checked: the content type and the first bytes must match what was asked for (a PDF starts
 *   with %PDF, a CSV has the expected header, a CKAN answer says success:true);
 * - safe: a download goes to a .part file and replaces the old copy only once it has passed
 *   the checks, so an error page never overwrites a good file.
 * Nothing about the app or its users is sent; only public files are requested.
 */
import { mkdirSync, existsSync, writeFileSync, renameSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, '.data', 'sources');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const UA = 'Karyavahi-demo/1.0 (public-data fetch for an education demo)';

const CKAN = 'https://ckandev.indiadataportal.com/api/3/action';
const UDISE_RESOURCE = '457fddf1-982f-4c85-855d-5095578accc1';
const UDISE_DISTRICTS = ['Rampur', 'Lucknow', 'Varanasi'];
const PAGE = 1000;
const THROTTLE_MS = 4000;

const PARAKH = [
  ['Report_Rampur_IND09176.pdf', 'https://parakh.ncert.gov.in/media/public_files/2025-08/Report_Rampur_IND09176.pdf'],
  ['Report_Lucknow_IND09162.pdf', 'https://parakh.ncert.gov.in/media/public_files/2025-08/Report_Lucknow_IND09162.pdf'],
  ['Report_Varanasi_IND09187.pdf', 'https://parakh.ncert.gov.in/media/public_files/2025-08/Report_Varanasi_IND09187.pdf'],
];
const ASER = [['Uttar-Pradesh_District-Estimates.pdf', 'https://asercentre.org/wp-content/uploads/2022/12/Uttar-Pradesh_District-Estimates.pdf']];
const PAB = [
  ['UP_PAB_Minutes_2025_26.pdf', 'https://web.archive.org/web/20250712214637id_/https://dsel.education.gov.in/sites/default/files/pab/UP_PAB_Minutes_2025_26.pdf'],
  ['PAB_minutes_revision_UP.pdf', 'https://web.archive.org/web/20250712222733id_/https://dsel.education.gov.in/sites/default/files/pab/PAB_minutes_revision_UP.pdf'],
];
/** India Data Portal CKAN resources downloaded whole: [file, resource id, a column the header must have]. */
const NFHS = [['nfhs-district.csv', 'b8ac1c23-d13f-4a91-aa4c-a056605f9115', 'district']];
const LGD = [
  ['lgd-districts.csv', '19df978a-675e-4ff5-8015-d0e1de447319', 'district'],
  ['lgd-blocks.csv', 'bdf22015-a213-4e23-b693-ca40bec4346e', 'block'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastPortalCall = 0;
async function throttle() {
  const wait = lastPortalCall + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastPortalCall = Date.now();
}
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`);

/** GET with retries: 429 and 5xx back off (8 s, 16 s, 32 s, 64 s); anything else fails. */
async function get(url, { portal = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (portal) await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      console.log(`  network error (${e.message}); retrying`);
      await sleep(8000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) || 0;
      const wait = Math.max(ra * 1000, 8000 * 2 ** attempt);
      console.log(`  HTTP ${res.status}; waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { type: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()) };
  }
  throw new Error(`gave up after 5 attempts: ${url}`);
}

/** Write to <file>.part, check it, and only then move it into place. */
function commit(file, body, check) {
  const problem = check(body);
  if (problem) throw new Error(`${file}: ${problem} — the existing copy (if any) was left alone`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, body);
  renameSync(`${file}.part`, file);
}
const isPdf = (type) => (b) => (b.subarray(0, 5).toString('latin1') !== '%PDF-' ? `not a PDF (content-type ${type})` : b.length < 10_000 ? 'suspiciously small' : null);
const isCsv = (type, col) => (b) => {
  const head = b.subarray(0, 4000).toString('utf8').toLowerCase();
  if (/<html|<!doctype/.test(head)) return `an HTML page, not CSV (content-type ${type})`;
  if (!head.split('\n')[0].includes(col)) return `the header has no "${col}" column`;
  return null;
};
const good = (file, minBytes) => !FORCE && existsSync(file) && statSync(file).size >= minBytes;

async function pdfs(dir, list) {
  for (const [name, url] of list) {
    const file = join(SRC, dir, name);
    if (good(file, 10_000)) { console.log(`  have ${dir}/${name} (${kb(statSync(file).size)})`); continue; }
    const { type, body } = await get(url);
    if (!/pdf|octet-stream/i.test(type)) throw new Error(`${name}: content-type ${type}, expected a PDF`);
    commit(file, body, isPdf(type));
    console.log(`  got ${dir}/${name} (${kb(body.length)})`);
  }
}

async function ckanFiles(dir, list) {
  for (const [name, id, col] of list) {
    const file = join(SRC, dir, name);
    if (good(file, 1000)) { console.log(`  have ${dir}/${name} (${kb(statSync(file).size)})`); continue; }
    const meta = JSON.parse((await get(`${CKAN}/resource_show?id=${id}`, { portal: true })).body.toString('utf8'));
    if (!meta.success || !meta.result?.url) throw new Error(`resource ${id}: no download address`);
    const url = meta.result.url;
    if (!url.startsWith('https://')) throw new Error(`resource ${id}: refusing a non-https address`);
    const { type, body } = await get(url, { portal: true });
    if (!/csv|text|octet-stream/i.test(type)) throw new Error(`${name}: content-type ${type}, expected CSV`);
    commit(file, body, isCsv(type, col));
    writeFileSync(join(SRC, dir, `${name}.source.json`), JSON.stringify({ resource_id: id, url, licence: meta.result.license_id ?? null, fetched: new Date().toISOString() }, null, 2));
    console.log(`  got ${dir}/${name} (${kb(body.length)})`);
  }
}

/** One CSV per district, built from 1,000-row pages of the datastore API saved one by one. */
async function udise() {
  for (const district of UDISE_DISTRICTS) {
    const out = join(SRC, 'udise', `udise-${district.toLowerCase()}.csv`);
    if (good(out, 10_000)) { console.log(`  have udise/${district} (${kb(statSync(out).size)})`); continue; }
    const pages = join(SRC, 'udise', `pages-${district.toLowerCase()}`);
    mkdirSync(pages, { recursive: true });
    const filters = encodeURIComponent(JSON.stringify({ state_name: 'Uttar Pradesh', district_name: district }));
    let total = Infinity, header = null;
    for (let offset = 0; offset < total; offset += PAGE) {
      const pf = join(pages, `${String(offset).padStart(6, '0')}.json`);
      let page;
      if (!FORCE && existsSync(pf)) page = JSON.parse(readFileSync(pf, 'utf8'));
      else {
        const url = `${CKAN}/datastore_search?resource_id=${UDISE_RESOURCE}&filters=${filters}&limit=${PAGE}&offset=${offset}&records_format=csv`;
        const { type, body } = await get(url, { portal: true });
        if (!/json/i.test(type)) throw new Error(`UDISE ${district} @${offset}: content-type ${type}`);
        const j = JSON.parse(body.toString('utf8'));
        if (!j.success || typeof j.result?.records !== 'string') throw new Error(`UDISE ${district} @${offset}: not a successful CSV page`);
        page = { total: j.result.total, fields: j.result.fields.map((f) => f.id), records: j.result.records };
        writeFileSync(`${pf}.part`, JSON.stringify(page));
        renameSync(`${pf}.part`, pf);
        console.log(`  udise ${district}: rows ${offset}–${Math.min(offset + PAGE, page.total)} of ${page.total}`);
      }
      total = page.total;
      header = page.fields;
    }
    const parts = readdirSync(pages).filter((f) => f.endsWith('.json')).sort();
    const body = [header.join(','), ...parts.map((f) => JSON.parse(readFileSync(join(pages, f), 'utf8')).records.replace(/\s+$/, ''))].join('\n') + '\n';
    const rows = body.split('\n').filter((l) => /^\d/.test(l)).length;
    commit(out, Buffer.from(body), isCsv('text/csv', 'udise_school_code'));
    console.log(`  built udise/${district} (${kb(body.length)}, about ${rows} rows; the API reported ${total})`);
    rmSync(pages, { recursive: true, force: true });
  }
}

const steps = {
  udise: () => udise(),
  parakh: () => pdfs('parakh', PARAKH),
  aser: () => pdfs('aser', ASER),
  nfhs: () => ckanFiles('nfhs', NFHS),
  pab: () => pdfs('pab', PAB),
  lgd: () => ckanFiles('lgd', LGD),
};
const failed = [];
for (const [name, run] of Object.entries(steps)) {
  if (only && only !== name) continue;
  console.log(`${name}:`);
  try { await run(); } catch (e) { failed.push(name); console.error(`  FAILED: ${e.message}`); }
}
let total = 0;
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else total += statSync(p).size; } };
if (existsSync(SRC)) walk(SRC);
console.log(`\n${SRC}: ${kb(total)} in all.`);
if (failed.length) { console.error(`Failed: ${failed.join(', ')}. Run again to resume.`); process.exit(1); }
console.log('Next: npm run data:build');
