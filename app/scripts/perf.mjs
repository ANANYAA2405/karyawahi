#!/usr/bin/env node
/**
 * How long the main pages take, per role, against a running server.
 *
 *   npx next build && npx next start -p 3012     (a production build: dev-mode compile time is not the app)
 *   node scripts/perf.mjs http://localhost:3012 [--runs 3] [--json out.json] [--compare before.json]
 *
 * Signs in the way the browser does (POST /api/sign-in, keep the session cookie), warms each
 * route once, then times it `--runs` times and reports the median. With --compare it prints the
 * earlier median beside the new one. Read-only: nothing here changes the database.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://localhost:3012';
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const RUNS = Number(opt('--runs', 3));
const JSON_OUT = opt('--json', null);
const COMPARE = opt('--compare', null);
const TARGET_MS = 1000;

const db = new DatabaseSync(join(process.cwd(), '.data', 'karyavahi.db'), { readOnly: true });
const userByEmail = (email) => db.prepare('select id from users where lower(email) = ?').get(email)?.id;
const firstHeadmaster = db.prepare(`select u.id, ur.scope_id from users u join user_roles ur on ur.user_id = u.id
  where ur.role = 'headmaster' and u.status = 'active' order by u.id limit 1`).get();
const someCase = (col, val) => db.prepare(`select id from cases where ${col} = ? order by id limit 1`).get(val)?.id;
const someTask = (userId) => db.prepare('select id from tasks where owner_user_id = ? order by id limit 1').get(userId)?.id;
const someSchool = (col, val) => db.prepare(`select id from schools where ${col} = ? order by id limit 1`).get(val)?.id;

const COMMON = ['/cases', '/hotspots', '/execution', '/tasks', '/schools', '/notifications', '/complaints', '/search?q=CASE-0184', '/api/geo/map'];
// What the hotspots map asks for as you drill in, and the side panel for a selected area.
const MAP_STATE = ['/api/geo/map?h=urban', '/api/geo/map?parent=DST-01', '/api/geo/map?parent=BLK-01', '/api/geo/detail?id=DST-01', '/api/geo/detail?id=BLK-01'];

const ROLES = [
  { label: 'state lead', email: 'state.lead@demo.karyavahi.test',
    extra: ['/overview', '/', '/cases/CASE-0184', '/approvals', '/evidence', '/impact', '/reports', '/interventions', `/schools/${someSchool('district_id', 'DST-01')}`, ...MAP_STATE] },
  { label: 'district (DEO)', email: 'deo.rmp@demo.karyavahi.test',
    extra: ['/overview', '/cases/CASE-0184', '/approvals', '/evidence', '/impact'] },
  { label: 'block (BEO)', email: 'beo.blk-01@demo.karyavahi.test',
    extra: ['/overview', '/', '/cases/CASE-0184', '/cases/CASE-0184/plan', '/approvals', '/evidence', '/impact', '/reports', `/schools/${someSchool('block_id', 'BLK-01')}`, '/api/geo/detail?id=BLK-01', '/api/geo/map?parent=CLU-001'] },
  { label: 'cluster (CRC)', email: 'crc.clu-001@demo.karyavahi.test',
    extra: ['/today', `/cases/${someCase('cluster_id', 'CLU-001') ?? 'CASE-0184'}`, `/tasks/${someTask(userByEmail('crc.clu-001@demo.karyavahi.test'))}`] },
  { label: 'headmaster', userId: firstHeadmaster.id, skipCommon: true,
    extra: ['/today', '/school', '/tasks', '/notifications', '/complaints'] },
];
db.close();

async function signIn(role) {
  const body = new URLSearchParams(role.userId ? { user_id: role.userId } : { email: role.email });
  const res = await fetch(`${BASE}/api/sign-in`, { method: 'POST', body, redirect: 'manual', headers: { origin: BASE } });
  const token = /kv_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (res.status !== 303 || !token) throw new Error(`sign-in failed for ${role.label}: ${res.status} ${res.headers.get('location') ?? ''}`);
  return token;
}

async function time(token, route) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${route}`, { headers: { cookie: `kv_session=${token}; kv_lang=en` }, redirect: 'manual' });
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const before = COMPARE && existsSync(COMPARE) ? JSON.parse(readFileSync(COMPARE, 'utf8')) : null;
const results = {};
let slow = 0, bad = 0;

console.log(`Timing against ${BASE}, median of ${RUNS} after one warm-up${before ? `, compared with ${COMPARE}` : ''}\n`);
const head = before
  ? `${'role'.padEnd(16)} ${'route'.padEnd(44)} ${'1st before'.padStart(10)} ${'1st after'.padStart(10)} ${'before'.padStart(9)} ${'after'.padStart(9)}  status`
  : `${'role'.padEnd(16)} ${'route'.padEnd(44)} ${'1st hit'.padStart(9)} ${'median'.padStart(9)}  status`;
console.log(head);
console.log('-'.repeat(head.length + 4));

for (const role of ROLES) {
  const token = await signIn(role);
  const routes = [...new Set([...(role.extra ?? []), ...(role.skipCommon ? [] : COMMON)])];
  for (const route of routes) {
    const cold = await time(token, route); // warm-up: the first hit of a route also pays for loading its code
    const runs = [];
    let status = 0;
    for (let i = 0; i < RUNS; i++) { const r = await time(token, route); runs.push(r.ms); status = r.status; }
    const m = median(runs);
    const key = `${role.label} ${route}`;
    results[key] = { role: role.label, route, ms: Math.round(m), first: Math.round(cold.ms), status };
    if (m > TARGET_MS) slow++;
    if (status >= 400) bad++;
    const flag = m > TARGET_MS ? '  SLOW' : '';
    const prev = before?.[key];
    const ms = (v) => (v != null ? `${v} ms` : '-');
    console.log(before
      ? `${role.label.padEnd(16)} ${route.slice(0, 44).padEnd(44)} ${ms(prev?.first).padStart(10)} ${ms(Math.round(cold.ms)).padStart(10)} ${ms(prev?.ms).padStart(9)} ${ms(Math.round(m)).padStart(9)}  ${status}${flag}`
      : `${role.label.padEnd(16)} ${route.slice(0, 44).padEnd(44)} ${ms(Math.round(cold.ms)).padStart(9)} ${ms(Math.round(m)).padStart(9)}  ${status}${flag}`);
  }
}

const all = Object.values(results).map((r) => r.ms);
const firsts = Object.values(results).map((r) => r.first);
console.log(`\n${all.length} routes · median ${median(all)} ms · slowest ${Math.max(...all)} ms · slowest first hit ${Math.max(...firsts)} ms · ${slow} over ${TARGET_MS} ms · ${bad} error status`);
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(results, null, 2)); console.log(`saved ${JSON_OUT}`); }
process.exit(bad ? 1 : 0);
