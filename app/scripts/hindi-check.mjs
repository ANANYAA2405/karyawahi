#!/usr/bin/env node
/**
 * Loads the field workers' pages in Hindi and reports any English interface text.
 *
 * Data is allowed to be in English, because that is how it is stored: school and village names,
 * people's names, complaint titles, case titles, reasons officers typed. So each piece of text
 * on the page is checked against the database first; only text that is not data, and still
 * contains Latin letters once ids and accepted acronyms are removed, is reported.
 *
 *   node scripts/hindi-check.mjs [baseUrl]
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const db = new DatabaseSync(join(process.cwd(), '.data', 'karyavahi.db'), { readOnly: true });
// Some tables are created by the app on first use, so a missing one is simply empty.
const q = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch { return []; } };

// Every string the field pages may show from the data, joined so a substring test is one search.
const DATA = [
  ...q('select name v from schools'), ...q('select village v from schools'), ...q('select full_name v from users'),
  ...q('select name v from clusters'), ...q('select name v from blocks'), ...q('select name v from districts'),
  ...q('select name v from interventions'), ...q('select title v from cases'),
  ...q(`select title v from complaints`), ...q(`select coalesce(rejection_reason, '') v from evidence`),
  ...q(`select coalesce(reassign_reason, '') v from tasks`), ...q(`select coalesce(deadline_change_reason, '') v from tasks`),
  ...q(`select coalesce(notes, '') v from visits`), ...q(`select coalesce(description, '') v from blockers`),
  ...q(`select steps v from interventions`), ...q(`select resources v from interventions`),
  ...q(`select coalesce(json_extract(summary, '$.note'), '') v from evidence`),
].map((r) => String(r.v)).join('\u0001');

/** Words that are the same in Hindi interface text: role and scheme acronyms, units, the brand. */
const ACCEPTED = new Set(['CRC', 'BRC', 'BEO', 'DEO', 'HM', 'AI', 'PAB', 'GPS', 'KB', 'MB', 'pp', 'Karyavahi', 'Claude', 'ID', 'PTR']);
const ID = /\b[A-Z]{2,5}-\d{2,}(-\d+)?\b/g;

const pick = (sql, ...p) => db.prepare(sql).get(...p);
const hmTask = pick(`select t.owner_user_id u, t.id from tasks t where t.owner_role = 'headmaster' and t.status in ('in_progress','sent_back') order by t.id limit 1`);
const ACCOUNTS = [
  { email: 'crc.clu-001@demo.karyavahi.test', routes: ['/today', '/field', '/tasks'] },
  { email: 'brc1.blk-01@demo.karyavahi.test', routes: ['/today', '/tasks'] },
  { userId: hmTask.u, routes: ['/today', '/school', '/tasks', `/tasks/${hmTask.id}`] },
];
for (const a of ACCOUNTS.slice(0, 2)) {
  const t = pick(`select t.id from tasks t join users u on u.id = t.owner_user_id where u.email = ? order by t.status = 'verified', t.id limit 1`, a.email);
  if (t) a.routes.push(`/tasks/${t.id}`);
}

async function signIn(a) {
  const body = new URLSearchParams(a.email ? { email: a.email } : { user_id: a.userId });
  const res = await fetch(`${BASE}/api/sign-in`, { method: 'POST', body, redirect: 'manual' });
  const token = /kv_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!token) throw new Error(`could not sign in ${a.email ?? a.userId}`);
  return `kv_session=${token}; kv_lang=hi`;
}

/** The text pieces a reader sees in the page body, split where markup splits them. */
function textPieces(html) {
  const body = html.slice(html.indexOf('<body'));
  return body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '\u0000')
    .replace(/<[^>]+>/g, '\u0000')
    .split('\u0000')
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Avatar initials ("PG"), short hashes ("4e0dfa0e…3278") and the word "sha256" beside them. */
const CODE = /^[A-Z]{1,3}$|^[0-9a-f]{6,}…[0-9a-f]{3,}$|^·? ?sha256$/;

function leaks(pieces) {
  const out = [];
  for (const p of pieces) {
    if (!/[A-Za-z]/.test(p)) continue;
    if (CODE.test(p) || DATA.includes(p)) continue;
    // A list joined from the data, such as an intervention's resources.
    if (p.includes(', ') && p.split(', ').every((part) => DATA.includes(part))) continue;
    const rest = p.replace(ID, ' ').split(/[^A-Za-z]+/).filter((w) => w && !ACCEPTED.has(w));
    if (rest.length && !rest.every((w) => DATA.includes(w) && /^[A-Z]/.test(w))) out.push(p);
  }
  return [...new Set(out)];
}

let problems = 0;
for (const a of ACCOUNTS) {
  const cookie = await signIn(a);
  for (const route of a.routes) {
    const res = await fetch(`${BASE}${route}`, { headers: { cookie }, redirect: 'manual' });
    const found = res.status === 200 ? leaks(textPieces(await res.text())) : [`HTTP ${res.status}`];
    const who = (a.email ?? a.userId).padEnd(34);
    if (found.length === 0) console.log(`ok   ${who} ${route}`);
    else {
      problems += found.length;
      console.log(`FAIL ${who} ${route}`);
      for (const f of found.slice(0, 40)) console.log(`       "${f.slice(0, 110)}"`);
    }
  }
}
console.log(`\n${problems === 0 ? 'no English interface text on the field pages' : `${problems} English piece(s) of interface text`}`);
process.exit(problems === 0 ? 0 : 1);
