#!/usr/bin/env node
// Builds a local SQLite copy of the seed from ../out/csv, mirroring sql/schema.sql column for
// column. Lets the app run with no Postgres and no credentials; the Supabase adapter uses the
// same column names, so queries port across unchanged.
//
//   node --experimental-sqlite scripts/build-db.mjs
//
// Writes .data/karyavahi.db plus .data/karyavahi.pristine.db, the copy demo_reset() restores.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const ROOT = join(APP, '..');
const CSV = join(ROOT, 'out', 'csv');
const DATA = join(APP, '.data');
const DB_PATH = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');

// ---------------------------------------------------------------- column types
// Everything not listed is TEXT (ids, dates, enums and JSON blobs all store as text,
// matching how the CSV writer serialises them).
const INT = {
  schools: ['enrolment_total', 'enrolment_g1', 'enrolment_g2', 'enrolment_g3', 'teachers_sanctioned', 'teachers_in_position'],
  metric_definitions: ['version'],
  setting_versions: ['version'],
  interventions: ['duration_weeks', 'version'],
  import_batches: ['total_rows', 'accepted_rows', 'rejected_rows', 'warnings'],
  import_rejected_rows: ['row_number'],
  assessment_results: ['grade', 'enrolled', 'n_assessed', 'n_proficient'],
  attendance_monthly: ['working_days'],
  findings: ['grade', 'n_prev', 'n_curr', 'schools_reporting', 'schools_total'],
  cases: ['grade', 'reopen_count'],
  case_plans: ['cycle', 'version', 'estimated_cost_inr'],
  tasks: ['cycle', 'proof_count'],
  outcome_evaluations: ['cycle', 'grade'],
};
const REAL = {
  schools: ['ptr'],
  assessment_results: ['pct_proficient', 'participation_rate'],
  attendance_monthly: ['avg_attendance_pct'],
  findings: ['prev_value_pct', 'curr_value_pct', 'change_pp', 'district_change_pp', 'relative_change_pp', 'z_score', 'participation_rate'],
  outcome_evaluations: [
    'treated_baseline_mean', 'treated_followup_mean', 'comparison_baseline_mean', 'comparison_followup_mean',
    'treated_change_pp', 'comparison_change_pp', 'did_pp', 'ci_low_pp', 'ci_high_pp', 'success_threshold_pp',
  ],
};
const BOOL = {
  users: ['is_demo_account'],
  metric_definitions: ['higher_is_better'],
  case_plans: ['cost_is_illustrative'],
  approvals: ['ai_drafted'],
  tasks: ['cross_source', 'is_overdue'],
  outcome_evaluations: ['delivery_verified', 'cross_source_verified', 'closure_eligible', 'is_illustrative'],
  reports: ['demo_disclaimer'],
};

const typeOf = (table, col) => {
  if ((INT[table] ?? []).includes(col)) return 'INTEGER';
  if ((REAL[table] ?? []).includes(col)) return 'REAL';
  if ((BOOL[table] ?? []).includes(col)) return 'INTEGER';
  return 'TEXT';
};
const isBool = (table, col) => (BOOL[table] ?? []).includes(col);

// Load order respects foreign keys (same order as sql/load.sql).
const TABLES = [
  'states', 'districts', 'blocks', 'clusters', 'schools', 'users', 'user_roles', 'role_permissions',
  'competencies', 'metric_definitions', 'assessment_rounds', 'setting_versions', 'interventions',
  'datasets', 'import_batches', 'import_rejected_rows', 'assessment_results', 'attendance_monthly',
  'staff_events', 'findings', 'cases', 'diagnoses', 'case_plans', 'approvals', 'tasks', 'visits',
  'evidence', 'outcome_evaluations', 'case_events', 'notifications', 'outbox_messages', 'reports',
  'ai_interactions', 'audit_events', 'system_jobs',
];

const PRIMARY_KEY = { role_permissions: '"role", "action"' };

const INDEXES = [
  'create index if not exists ix_user_roles_user on user_roles (user_id)',
  'create index if not exists ix_user_roles_scope on user_roles (scope_type, scope_id)',
  'create index if not exists ix_schools_cluster on schools (cluster_id)',
  'create index if not exists ix_schools_block on schools (block_id)',
  'create index if not exists ix_schools_district on schools (district_id)',
  'create index if not exists ix_ar_school_round on assessment_results (school_id, round_id)',
  'create index if not exists ix_ar_round on assessment_results (round_id, grade, competency_id)',
  'create index if not exists ix_att_school on attendance_monthly (school_id, month)',
  'create index if not exists ix_staff_school on staff_events (school_id, event_date)',
  'create index if not exists ix_cases_block on cases (block_id, status)',
  'create index if not exists ix_cases_district on cases (district_id, status)',
  'create index if not exists ix_cases_cluster on cases (cluster_id)',
  'create index if not exists ix_cases_owner on cases (owner_user_id)',
  'create index if not exists ix_findings_case on findings (case_id)',
  'create index if not exists ix_findings_cluster on findings (cluster_id, status)',
  'create index if not exists ix_findings_block on findings (block_id, status)',
  'create index if not exists ix_diag_case on diagnoses (case_id)',
  'create index if not exists ix_plans_case on case_plans (case_id)',
  'create index if not exists ix_appr_case on approvals (case_id)',
  'create index if not exists ix_appr_plan on approvals (plan_id)',
  'create index if not exists ix_tasks_owner on tasks (owner_user_id, status)',
  'create index if not exists ix_tasks_case on tasks (case_id)',
  'create index if not exists ix_tasks_plan on tasks (plan_id)',
  'create index if not exists ix_tasks_due on tasks (due_date)',
  'create index if not exists ix_visits_school on visits (school_id, visit_date)',
  'create index if not exists ix_visits_case on visits (case_id)',
  'create index if not exists ix_visits_user on visits (visitor_user_id, visit_date)',
  'create index if not exists ix_evi_task on evidence (task_id)',
  'create index if not exists ix_evi_case on evidence (case_id, status)',
  'create index if not exists ix_evi_status on evidence (status)',
  'create index if not exists ix_out_case on outcome_evaluations (case_id)',
  'create index if not exists ix_cev_case on case_events (case_id, ts)',
  'create index if not exists ix_ntf_user on notifications (user_id, read_at)',
  'create index if not exists ix_out_msg_user on outbox_messages (user_id)',
  'create index if not exists ix_aud_entity on audit_events (entity_type, entity_id)',
  'create index if not exists ix_aud_ts on audit_events (ts)',
  'create index if not exists ix_aud_actor on audit_events (actor_user_id)',
  'create index if not exists ix_ai_user on ai_interactions (user_id, ts)',
  'create index if not exists ix_reports_scope on reports (scope_type, scope_id)',
  'create index if not exists ix_imp_dataset on import_batches (dataset_id, uploaded_at)',
  'create index if not exists ix_imp_rej on import_rejected_rows (import_batch_id)',
];

// ---------------------------------------------------------------- CSV parsing
/** RFC 4180: double quotes escape, quoted fields may hold commas, quotes and newlines. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- build
mkdirSync(DATA, { recursive: true });
if (!existsSync(CSV)) {
  console.error(`No seed CSVs at ${CSV}. Run "npm run generate" in the project root first.`);
  process.exit(1);
}
for (const f of ['karyavahi.db', 'karyavahi.db-journal', 'karyavahi.db-wal', 'karyavahi.db-shm']) {
  try { readdirSync(DATA).includes(f) && (await import('node:fs')).rmSync(join(DATA, f)); } catch {}
}

const db = new DatabaseSync(DB_PATH);
db.exec('pragma journal_mode = wal');
db.exec('pragma synchronous = off');

const started = Date.now();
let grand = 0;
const report = [];

for (const table of TABLES) {
  const file = join(CSV, `${table}.csv`);
  if (!existsSync(file)) { console.warn(`  ! skipped ${table}: no ${table}.csv`); continue; }
  const rows = parseCsv(readFileSync(file, 'utf8'));
  if (rows.length === 0) { console.warn(`  ! skipped ${table}: empty file`); continue; }
  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));

  const cols = header.map((c) => `"${c}" ${typeOf(table, c)}`).join(', ');
  const pk = PRIMARY_KEY[table] ? `, primary key (${PRIMARY_KEY[table]})` : '';
  db.exec(`drop table if exists "${table}"`);
  db.exec(`create table "${table}" (${cols}${pk})`);

  const stmt = db.prepare(
    `insert into "${table}" (${header.map((c) => `"${c}"`).join(', ')}) values (${header.map(() => '?').join(', ')})`,
  );
  const boolCols = header.map((c) => isBool(table, c));
  const numCols = header.map((c) => typeOf(table, c) !== 'TEXT' && !isBool(table, c));

  db.exec('begin');
  for (const r of body) {
    const vals = new Array(header.length);
    for (let c = 0; c < header.length; c++) {
      const raw = r[c];
      if (raw === undefined || raw === '') { vals[c] = null; continue; }
      if (boolCols[c]) { vals[c] = raw === 'true' || raw === 't' || raw === '1' ? 1 : 0; continue; }
      if (numCols[c]) { const v = Number(raw); vals[c] = Number.isFinite(v) ? v : null; continue; }
      vals[c] = raw;
    }
    stmt.run(...vals);
  }
  db.exec('commit');

  grand += body.length;
  report.push([table, body.length]);
  process.stdout.write(`  ${table.padEnd(22)} ${String(body.length).padStart(7)}\n`);
}

for (const ix of INDEXES) db.exec(ix);
db.exec('analyze');

// A tiny key/value table for demo state the app owns (the demo clock, mostly).
db.exec(`create table if not exists app_state (key text primary key, value text not null, updated_at text not null)`);
db.prepare(`insert into app_state (key, value, updated_at) values ('demo_clock', ?, ?)
            on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`)
  .run('2026-10-24T06:30:00.000Z', new Date().toISOString());

// Monotonic counters so generated ids don't collide with seeded ones.
const maxId = (t, prefix) => {
  try {
    const r = db.prepare(`select max(cast(replace(id, '${prefix}', '') as integer)) as m from "${t}" where id like '${prefix}%'`).get();
    return Number(r?.m ?? 0);
  } catch { return 0; }
};
db.exec(`create table if not exists app_sequences (name text primary key, value integer not null)`);
const seqStmt = db.prepare(`insert into app_sequences (name, value) values (?, ?)
                            on conflict(name) do update set value = excluded.value`);
seqStmt.run('audit', maxId('audit_events', 'AUD-'));
seqStmt.run('notification', maxId('notifications', 'NTF-'));
seqStmt.run('case_event', maxId('case_events', 'CEV-'));
seqStmt.run('evidence', maxId('evidence', 'EVD-'));
seqStmt.run('job', maxId('system_jobs', 'JOB-'));
seqStmt.run('batch', maxId('import_batches', 'IMP-'));
seqStmt.run('report', maxId('reports', 'RPT-'));
seqStmt.run('ai', maxId('ai_interactions', 'AII-'));
seqStmt.run('outcome', maxId('outcome_evaluations', 'OUT-'));
seqStmt.run('approval', maxId('approvals', 'APR-'));

const integrity = db.prepare('pragma integrity_check').get();
db.close();
copyFileSync(DB_PATH, PRISTINE);

console.log(`\n  ${report.length} tables, ${grand.toLocaleString('en-IN')} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  integrity_check: ${integrity.integrity_check}`);
console.log(`  → ${DB_PATH}`);
console.log(`  → ${PRISTINE} (restored by demo reset)`);
