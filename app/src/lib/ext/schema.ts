import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateGeography, generateInsideReal, unionUnit, toMultiPolygon, circleRing, insideGeometry,
  type GenUnit, type Geometry,
} from './geogen';
import { ensureCollabTables } from './collab-schema';
import { ensureApiTables } from './api-schema';
import { ensureRealData, realDataVersion } from './realdata';
import { ensureFeedbackTables } from './feedback-schema';

/**
 * Extension schema: geography, organisational hierarchy, complaints, onboarding and sign-in sessions.
 *
 * The seed's own tables are never altered. These tables are created next to them in the app's
 * SQLite copy, idempotently, every time a connection opens — so a demo reset (which restores
 * the pristine seed file) brings them back automatically. Their demo content is derived
 * deterministically from seed rows (users, roles, schools) and is tagged synthetic_demo.
 *
 * Against Postgres this file becomes a migration plus a seed script; the column names are
 * chosen to port directly.
 */

export const EXT_VERSION = 'ext-v2';
const AS_OF = '2026-10-24';

const DDL = `
create table if not exists geo_hierarchies (id text primary key, name text not null, description text not null);
create table if not exists geo_levels (hierarchy_id text not null, level text not null, rank integer not null, label text not null, primary key (hierarchy_id, level));
create table if not exists geo_units (
  id text primary key, level text not null, name text not null, code text,
  geometry_source text not null, centroid_lon real, centroid_lat real, bbox text, boundary text, note text
);
create index if not exists geo_units_level on geo_units(level);
create table if not exists geo_relationships (child_id text not null, parent_id text not null, hierarchy_id text not null, primary key (child_id, hierarchy_id));
create index if not exists geo_rel_parent on geo_relationships(parent_id, hierarchy_id);

create table if not exists reporting_lines (
  user_id text primary key, manager_user_id text, relation text not null, source text not null, updated_at text not null, updated_by text
);
create index if not exists reporting_manager on reporting_lines(manager_user_id);
create table if not exists delegations (
  id text primary key, from_user_id text not null, to_user_id text not null, role text not null,
  scope_type text not null, scope_id text not null, starts_on text not null, ends_on text not null,
  reason text not null, created_by text not null, created_at text not null, revoked_at text, revoked_by text
);
create index if not exists delegations_to on delegations(to_user_id);

create table if not exists complaint_categories (
  key text primary key, label text not null, description text not null,
  route text not null, route_level text, confidential_default integer not null default 0, sort integer not null
);
create table if not exists escalation_policies (
  category_key text not null, priority text not null, ack_sla_days integer not null, resolve_sla_days integer not null,
  escalate_to text not null, critical_direct_level text, notify_roles text not null, primary key (category_key, priority)
);
create table if not exists complaints (
  id text primary key, category_key text not null, title text not null, description text not null,
  reporter_user_id text not null, reporter_role text not null, organisation text,
  school_id text, cluster_id text, block_id text, district_id text, state_id text,
  priority text not null, severity text not null, confidentiality text not null, accused_user_id text,
  status text not null, assigned_user_id text, assigned_role text, escalation_level integer not null default 0,
  case_id text, ack_due text, resolve_due text, acknowledged_at text, resolved_at text, closed_at text,
  resolution_summary text, created_at text not null, updated_at text not null, provenance text not null
);
create index if not exists complaints_assigned on complaints(assigned_user_id);
create index if not exists complaints_reporter on complaints(reporter_user_id);
create index if not exists complaints_geo on complaints(district_id, block_id, cluster_id);
create table if not exists complaint_events (
  id text primary key, complaint_id text not null, ts text not null, actor_user_id text, actor_label text not null,
  kind text not null, from_status text, to_status text, note text, internal integer not null default 0, assigned_to text
);
create index if not exists complaint_events_c on complaint_events(complaint_id, ts);

create table if not exists registration_requests (
  id text primary key, request_type text not null, full_name text not null, email text not null, mobile text,
  organisation text, requested_role text not null, scope_type text not null, scope_id text not null,
  reporting_user_id text, affiliation_ref text, status text not null, email_code text not null,
  verifier_user_id text, duplicate_of text, target_user_id text, created_user_id text,
  info_request text, decision_reason text, decided_by text, created_at text not null, updated_at text not null, provenance text not null
);
create index if not exists reg_verifier on registration_requests(verifier_user_id, status);
create table if not exists account_status_history (
  id text primary key, user_id text not null, from_status text, to_status text not null,
  actor_user_id text, reason text, ts text not null
);
-- Sign-in sessions. The cookie carries a random token; only its SHA-256 lives here, so a copy of
-- the database cannot be replayed as a cookie. Created on every open, so a demo reset signs
-- everyone out.
create table if not exists sessions (
  id text primary key, user_id text not null, created_at text not null, expires_at text not null,
  revoked_at text, user_agent text
);
create index if not exists sessions_user on sessions(user_id);

-- Photos attached to proof. The file sits in .data/evidence-files under its own SHA-256, which
-- the server computes from the bytes it received; serving a file re-hashes it first.
create table if not exists evidence_files (
  evidence_id text primary key, sha256 text not null, mime text not null, bytes integer not null,
  original_name text, created_at text not null
);
create index if not exists evidence_files_sha on evidence_files(sha256);

create table if not exists ext_meta (key text primary key, value text not null);
`;

type Row = Record<string, unknown>;
const q = <T = Row>(c: DatabaseSync, sql: string, ...p: (string | number | null)[]) => c.prepare(sql).all(...p) as T[];
const one = <T = Row>(c: DatabaseSync, sql: string, ...p: (string | number | null)[]) => (c.prepare(sql).get(...p) ?? null) as T | null;
const exec = (c: DatabaseSync, sql: string, ...p: (string | number | null)[]) => { c.prepare(sql).run(...p); };

function geojson(u: GenUnit): string {
  return JSON.stringify(toMultiPolygon(u.rings));
}

export function ensureExtensions(c: DatabaseSync): void {
  c.exec(DDL);
  // First, so deriving the demo content below can use the indexes too.
  migratePerf(c);
  // Round import and case threads keep their own version markers (see collab-schema.ts).
  ensureCollabTables(c);
  // Real schools, calibrated results and PAB costs (data/real/), before anything is derived from the schools.
  ensureRealData(c);
  // The read-only API for state dashboards: keys and the call log (see api-schema.ts).
  ensureApiTables(c);
  // What people tell us about the app: thumbs on Claude, the feedback form (see feedback-schema.ts).
  ensureFeedbackTables(c);
  const v = one<{ value: string }>(c, `select value from ext_meta where key = 'version'`)?.value;
  if (v !== EXT_VERSION) {
    c.exec('begin immediate');
    try {
      seedGeography(c);
      seedReporting(c);
      seedComplaintPolicy(c);
      seedComplaints(c);
      seedRegistrations(c);
      exec(c, `insert into ext_meta (key, value) values ('version', ?) on conflict(key) do update set value = excluded.value`, EXT_VERSION);
      c.exec('commit');
    } catch (e) {
      try { c.exec('rollback'); } catch { /* already rolled back */ }
      throw e;
    }
  }
  ensureRealGeography(c);
  migrateIntegrity(c);
  migrateApprovalLever(c);
  migrateReminders(c);
  migrateProofSync(c);
}

// ---------------------------------------------------------------- speed
/**
 * Indexes for the columns pages filter and join on that the seed was loaded without, and a
 * counter that moves whenever learning data changes. Additive only, once per database (a demo
 * reset restores the pristine file, so it runs again there), and before the demo content is
 * derived, because deriving the reporting lines looks people up by role and place.
 *
 * - user_roles (role, scope_id): "who is the CRC of this cluster" — asked once per account when
 *   the reporting lines are derived, and again for every task owner the plan composer offers
 * - users lower(email): sign-in by email
 * - tasks school_id, evidence submitted_by: the map's per-school task counts and the "proof I
 *   submitted" half of every evidence scope check
 * - learning_data_gen: bumped by a trigger on every insert, update or delete in assessment_results
 *   or schools. learning-cache.ts keeps the expensive learning sums only while it is unchanged,
 *   so an imported round shows up on the next request, whichever code path imported it.
 */
export const PERF_VERSION = 'perf-v1';
export const LEARNING_GEN_KEY = 'learning_data_gen';

const PERF_INDEXES: [name: string, table: string, cols: string][] = [
  ['ix_user_roles_role_scope', 'user_roles', '(role, scope_id)'],
  ['ix_users_email_lower', 'users', '(lower(email))'],
  ['ix_tasks_school', 'tasks', '(school_id)'],
  ['ix_evi_submitter', 'evidence', '(submitted_by)'],
];

function migratePerf(c: DatabaseSync): void {
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'perf'`)?.value === PERF_VERSION) return;
  c.exec('begin immediate');
  try {
    for (const [name, table, cols] of PERF_INDEXES) exec(c, `create index if not exists "${name}" on "${table}" ${cols}`);
    exec(c, `insert into ext_meta (key, value) values (?, '0') on conflict(key) do nothing`, LEARNING_GEN_KEY);
    const bump = `insert into ext_meta (key, value) values ('${LEARNING_GEN_KEY}', '1')
                    on conflict(key) do update set value = cast(value as integer) + 1`;
    for (const table of ['assessment_results', 'schools']) {
      for (const ev of ['insert', 'update', 'delete']) {
        c.exec(`create trigger if not exists "kv_gen_${table}_${ev}" after ${ev} on "${table}" begin ${bump}; end`);
      }
    }
    exec(c, `insert into ext_meta (key, value) values ('perf', ?) on conflict(key) do update set value = excluded.value`, PERF_VERSION);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ---------------------------------------------------------------- approvals
/**
 * Which lever each approval was decided under.
 *
 * A case's lever is the lever of its current plan: drafting a new plan (a block-level coaching
 * plan replacing a district-level one, say) moves it, and a PAB referral sets it to 'pab'. An
 * approval belongs to one plan, so the role it needs comes from the lever in force when that plan
 * was submitted, not from whatever the case's lever is today. The seed stored only the role;
 * this records the lever beside it (from the approval's own plan) and makes the role agree with
 * it through requiredRoleFor(), the same rule the decision gate in guard.ts applies.
 */
export const APPROVALS_VERSION = 'approvals-v1';

function migrateApprovalLever(c: DatabaseSync): void {
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'approvals'`)?.value === APPROVALS_VERSION) return;
  c.exec('begin immediate');
  try {
    if (q(c, `select 1 from pragma_table_info('approvals') where name = 'lever'`).length === 0) {
      exec(c, 'alter table approvals add column lever text');
    }
    exec(c, `update approvals set lever = coalesce(
                (select i.lever from case_plans p join interventions i on i.id = p.intervention_id where p.id = approvals.plan_id),
                (select cs.lever from cases cs where cs.id = approvals.case_id))
              where lever is null`);
    exec(c, `update approvals set required_role = case lever when 'block' then 'beo' else 'deo' end
              where lever is not null and required_role is not (case lever when 'block' then 'beo' else 'deo' end)`);
    exec(c, `insert into ext_meta (key, value) values ('approvals', ?) on conflict(key) do update set value = excluded.value`, APPROVALS_VERSION);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ---------------------------------------------------------------- reminders
/**
 * The overdue ("breach") nudge: one per task, the day after its due date passes without proof.
 * The seed already nudged the tasks that were overdue on the seed date — an in-app "task_overdue"
 * notification, or an "overdue_nudge" message in the outbox for people without the app — so the
 * column is filled from those rows, with the time they were recorded. Without that, the first
 * sweep after a reset would nudge every one of them a second time. Additive only, once per
 * database (a demo reset restores the pristine file, so it runs again there).
 */
export const REMINDERS_VERSION = 'reminders-v1';

function migrateReminders(c: DatabaseSync): void {
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'reminders'`)?.value === REMINDERS_VERSION) return;
  c.exec('begin immediate');
  try {
    if (q(c, `select 1 from pragma_table_info('tasks') where name = 'breach_nudged_at'`).length === 0) {
      exec(c, 'alter table tasks add column breach_nudged_at text');
    }
    exec(c, `update tasks set breach_nudged_at = (
                select min(ts) from (
                  select n.ts from notifications n where n.entity_type = 'task' and n.entity_id = tasks.id and n.kind = 'task_overdue'
                  union all
                  select o.ts from outbox_messages o where o.entity_type = 'task' and o.entity_id = tasks.id and o.template = 'overdue_nudge'))
              where breach_nudged_at is null`);
    exec(c, `insert into ext_meta (key, value) values ('reminders', ?) on conflict(key) do update set value = excluded.value`, REMINDERS_VERSION);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ---------------------------------------------------------------- offline proof and GPS
/**
 * Proof handed in from a phone that may have had no signal, with the phone's own location.
 *
 * - evidence.client_id: an id the phone makes up when the proof is first saved. A proof queued
 *   offline can be sent twice (the page and the service worker both retry, or the answer is
 *   lost on a weak line); the server keeps one row per (submitter, client_id), so a retry
 *   returns the proof already recorded instead of adding another. The unique index is the
 *   backstop under the check in submitEvidence().
 * - evidence.gps_lat / gps_lng / gps_accuracy_m: the fix the phone reported, read once at the
 *   moment of handing in (never tracked). gps_distance_m is what the SERVER worked out against
 *   the school's position, and gps_status is set from that distance, never from the form.
 *
 * Additive only, once per database.
 */
export const PROOF_SYNC_VERSION = 'proof-sync-v1';

function migrateProofSync(c: DatabaseSync): void {
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'proof_sync'`)?.value === PROOF_SYNC_VERSION) return;
  const hasColumn = (col: string) => q(c, `select 1 from pragma_table_info('evidence') where name = ?`, col).length > 0;
  c.exec('begin immediate');
  try {
    for (const [col, type] of [['client_id', 'text'], ['gps_lat', 'real'], ['gps_lng', 'real'], ['gps_accuracy_m', 'real'], ['gps_distance_m', 'real']]) {
      if (!hasColumn(col)) exec(c, `alter table evidence add column ${col} ${type}`);
    }
    exec(c, 'create unique index if not exists evidence_client_uq on evidence (submitted_by, client_id) where client_id is not null');
    exec(c, `insert into ext_meta (key, value) values ('proof_sync', ?) on conflict(key) do update set value = excluded.value`, PROOF_SYNC_VERSION);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ---------------------------------------------------------------- integrity
/**
 * Keys and ordering the seed tables were loaded without. Additive only — indexes and columns,
 * never a rebuild — so it is safe on a demo with live changes, and runs once per database
 * (a demo reset restores the pristine file, so it runs again there).
 *
 * - a unique index on every `id`: lookups stop scanning, duplicate ids are refused
 * - audit_events.seq: the chain's own order, in insert order, so moving the demo clock back
 *   cannot reorder it (the chain was previously walked by timestamp)
 * - a version column on cases, plans and tasks for conflict checks; every case move bumps it,
 *   and plans and tasks start using it with collaborative editing
 * - id counters that were seeded from the wrong prefix start from the real highest id
 */
export const INTEGRITY_VERSION = 'integrity-v1';

function migrateIntegrity(c: DatabaseSync): void {
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'integrity'`)?.value === INTEGRITY_VERSION) return;
  const hasColumn = (table: string, col: string) => q(c, 'select 1 from pragma_table_info(?) where name = ?', table, col).length > 0;
  const uniqueOnId = (table: string) => q<{ name: string; unique: number }>(c, 'select name, "unique" from pragma_index_list(?)', table)
    .some((ix) => ix.unique && q<{ name: string }>(c, 'select name from pragma_index_info(?)', ix.name).map((r) => r.name).join() === 'id');

  c.exec('begin immediate');
  try {
    const tables = q<{ name: string }>(c, `select m.name from sqlite_master m
       where m.type = 'table' and m.name not like 'sqlite_%'
         and exists (select 1 from pragma_table_info(m.name) p where p.name = 'id')`);
    for (const { name } of tables) {
      if (uniqueOnId(name)) continue;
      try {
        exec(c, `create unique index "${name}_id_uq" on "${name}" (id)`);
      } catch (e) {
        // Duplicate ids already in the data: leave the table as it was rather than refuse to start.
        console.warn(`[integrity] ${name}: ids are not unique, no index created (${(e as Error).message})`);
      }
    }

    if (!hasColumn('audit_events', 'seq')) {
      exec(c, 'alter table audit_events add column seq integer');
      exec(c, `update audit_events set seq = x.rn
                 from (select rowid r, row_number() over (order by rowid) rn from audit_events) x
                where x.r = audit_events.rowid`);
      exec(c, 'create unique index audit_events_seq_uq on audit_events (seq)');
    }

    for (const t of ['cases', 'case_plans', 'tasks']) {
      if (!hasColumn(t, 'version')) exec(c, `alter table "${t}" add column version integer not null default 0`);
    }

    for (const [name, table, prefix] of [['batch', 'import_batches', 'IMP-'], ['ai', 'ai_interactions', 'AII-']]) {
      exec(c, `insert into app_sequences (name, value)
                 select ?, coalesce(max(cast(substr(id, ?) as integer)), 0) from "${table}" where id like ?
               on conflict(name) do update set value = max(app_sequences.value, excluded.value)`,
        name, prefix.length + 1, `${prefix}%`);
    }

    exec(c, `insert into ext_meta (key, value) values ('integrity', ?) on conflict(key) do update set value = excluded.value`, INTEGRITY_VERSION);
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ---------------------------------------------------------------- geography
function seedGeography(c: DatabaseSync) {
  // The illustrative shapes replace any real-map geography, so the real map must be re-applied.
  exec(c, `delete from ext_meta where key = 'geo'`);
  exec(c, 'delete from geo_units'); exec(c, 'delete from geo_relationships'); exec(c, 'delete from geo_levels'); exec(c, 'delete from geo_hierarchies');
  exec(c, `insert into geo_hierarchies values ('admin', 'Administrative', 'Country → State → District → Block → Cluster → School')`);
  exec(c, `insert into geo_hierarchies values ('urban', 'Urban areas', 'Country → State → District → City → Cluster → School (city clusters only)')`);
  [['country', 0, 'Country'], ['state', 1, 'State'], ['district', 2, 'District'], ['block', 3, 'Block'], ['cluster', 4, 'Cluster'], ['school', 5, 'School']]
    .forEach(([l, r, lab]) => exec(c, `insert into geo_levels values ('admin', ?, ?, ?)`, l, r, lab));
  [['country', 0, 'Country'], ['state', 1, 'State'], ['district', 2, 'District'], ['city', 3, 'City'], ['cluster', 4, 'Cluster'], ['school', 5, 'School']]
    .forEach(([l, r, lab]) => exec(c, `insert into geo_levels values ('urban', ?, ?, ?)`, l, r, lab));

  const state = one<{ id: string; name: string }>(c, 'select id, name from states limit 1')!;
  const districts = q<{ id: string; name: string; code: string; schools: number }>(c, `select d.id, d.name, d.code, (select count(*) from schools s where s.district_id = d.id) schools from districts d order by d.id`);
  const blocks = q<{ id: string; name: string; code: string; district_id: string; schools: number }>(c, `select b.id, b.name, b.code, b.district_id, (select count(*) from schools s where s.block_id = b.id) schools from blocks b order by b.id`);
  const clusters = q<{ id: string; name: string; block_id: string; district_id: string; schools: number }>(c, `select cl.id, cl.name, cl.block_id, cl.district_id, (select count(*) from schools s where s.cluster_id = cl.id) schools from clusters cl order by cl.id`);
  const schools = q<{ id: string; name: string; cluster_id: string }>(c, 'select id, name, cluster_id from schools order by id');

  const g = generateGeography({ districts, blocks, clusters, schools });
  const ins = c.prepare(`insert into geo_units values (?,?,?,?,?,?,?,?,?,?)`);
  const rel = c.prepare(`insert into geo_relationships values (?,?,?)`);
  const put = (id: string, level: string, name: string, code: string | null, u: GenUnit | null, note: string | null) =>
    ins.run(id, level, name, code, u ? 'illustrative' : 'none', u?.centroid[0] ?? null, u?.centroid[1] ?? null, u ? JSON.stringify(u.bbox) : null, u ? geojson(u) : null, note);

  put('IN', 'country', 'India', 'IN', null, 'Country outline intentionally not drawn: only the fictional demo state is mapped.');
  put(state.id, 'state', state.name, null, g.state, 'Illustrative shape of a fictional state.');
  rel.run(state.id, 'IN', 'admin'); rel.run(state.id, 'IN', 'urban');
  for (const d of districts) { put(d.id, 'district', d.name, d.code, g.units.get(d.id)!, null); rel.run(d.id, state.id, 'admin'); rel.run(d.id, state.id, 'urban'); }
  for (const b of blocks) { put(b.id, 'block', b.name, b.code, g.units.get(b.id)!, null); rel.run(b.id, b.district_id, 'admin'); }
  for (const cl of clusters) { put(cl.id, 'cluster', cl.name, null, g.units.get(cl.id)!, null); rel.run(cl.id, cl.block_id, 'admin'); }
  const pins = c.prepare(`insert into geo_units values (?,?,?,?,?,?,?,?,?,?)`);
  for (const s of schools) {
    const p = g.schoolPoints.get(s.id);
    pins.run(s.id, 'school', s.name, null, p ? 'illustrative' : 'none', p?.[0] ?? null, p?.[1] ?? null, null, p ? JSON.stringify({ type: 'Point', coordinates: p }) : null,
      'Illustrative position inside its cluster. Not a real location.');
    rel.run(s.id, s.cluster_id, 'admin');
    rel.run(s.id, s.cluster_id, 'urban');
  }

  // Cities: a district headquarters town made of the 2–3 clusters nearest the district centre.
  // Demonstrates a second hierarchy in which city ≠ district and clusters belong to a city.
  for (const [i, d] of districts.entries()) {
    const du = g.units.get(d.id)!;
    const dcl = clusters.filter((cl) => cl.district_id === d.id)
      .map((cl) => ({ cl, u: g.units.get(cl.id)! }))
      .sort((a, b) => ((a.u.centroid[0] - du.centroid[0]) ** 2 + (a.u.centroid[1] - du.centroid[1]) ** 2) - ((b.u.centroid[0] - du.centroid[0]) ** 2 + (b.u.centroid[1] - du.centroid[1]) ** 2))
      .slice(0, 3);
    const id = `CTY-${String(i + 1).padStart(2, '0')}`;
    const cu = unionUnit(id, dcl.flatMap((x) => g.hexOf.get(x.cl.id) ?? []));
    put(id, 'city', `${d.name} Nagar`, null, cu, 'Illustrative urban area made of the clusters around the district headquarters.');
    rel.run(id, d.id, 'urban');
    for (const x of dcl) rel.run(x.cl.id, id, 'urban');
  }
}

// ---------------------------------------------------------------- the real map
/**
 * When data/up-geo.json is present (real OpenStreetMap boundaries for Uttar Pradesh, built by
 * scripts/fetch-up-boundaries.mjs), the demo is placed on the real map: its three districts
 * become Rampur, Lucknow and Varanasi with their real outlines; its blocks, clusters and schools
 * are drawn inside them as simulated subdivisions; the other 72 districts appear with no data;
 * the three cities are approximate circles around their real centres. The learning data stays
 * simulated, and every unit records where its shape came from (geometry_source).
 */
export const GEO_FILE = join(process.cwd(), 'data', 'up-geo.json');
const REAL_GEO_VERSION = 'up-osm-v3';
/** The geography is redrawn whenever the real-data files change, because school positions come from them. */
const geoVersion = () => `${REAL_GEO_VERSION}${realDataVersion() ? `+${realDataVersion()}` : ''}`;
/** Which real district each demo district is placed in, in district id order. */
const REAL_DISTRICTS = ['Rampur', 'Lucknow', 'Varanasi'];

interface UpGeo {
  attribution: string;
  state: { name: string; osm_id: number; geometry: Geometry };
  districts: { name: string; osm_id: number; geometry: Geometry }[];
  cities: { district: string; name: string; center: [number, number]; radius_km: number }[];
}

function ensureRealGeography(c: DatabaseSync) {
  if (!existsSync(GEO_FILE)) return;
  if (one<{ value: string }>(c, `select value from ext_meta where key = 'geo'`)?.value === geoVersion()) return;
  const up = JSON.parse(readFileSync(GEO_FILE, 'utf8')) as UpGeo;
  c.exec('begin immediate');
  try {
    seedRealGeography(c, up);
    exec(c, `insert into ext_meta (key, value) values ('geo', ?) on conflict(key) do update set value = excluded.value`, geoVersion());
    c.exec('commit');
  } catch (e) {
    try { c.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

function seedRealGeography(c: DatabaseSync, up: UpGeo) {
  const shape = (g: Geometry): string => JSON.stringify(g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g);
  const bboxOf = (g: Geometry): [number, number, number, number] => {
    const pts = (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).flat();
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  };

  const state = one<{ id: string }>(c, 'select id from states limit 1')!;
  const districts = q<{ id: string; code: string; schools: number }>(c, `select d.id, d.code, (select count(*) from schools s where s.district_id = d.id) schools from districts d order by d.id`);
  // The demo's districts take the real names; the state takes its real name.
  districts.forEach((d, i) => { if (REAL_DISTRICTS[i]) exec(c, 'update districts set name = ? where id = ?', REAL_DISTRICTS[i], d.id); });
  exec(c, 'update states set name = ? where id = ?', up.state.name, state.id);

  const blocks = q<{ id: string; name: string; code: string; district_id: string; schools: number }>(c, `select b.id, b.name, b.code, b.district_id, (select count(*) from schools s where s.block_id = b.id) schools from blocks b order by b.id`);
  const clusters = q<{ id: string; name: string; block_id: string; district_id: string; schools: number }>(c, `select cl.id, cl.name, cl.block_id, cl.district_id, (select count(*) from schools s where s.cluster_id = cl.id) schools from clusters cl order by cl.id`);
  const schools = q<{ id: string; name: string; cluster_id: string }>(c, 'select id, name, cluster_id from schools order by id');
  const outlines = new Map<string, Geometry>();
  districts.forEach((d, i) => { const real = up.districts.find((x) => x.name === REAL_DISTRICTS[i]); if (real) outlines.set(d.id, real.geometry); });
  // Real school positions (UDISE+, moved a few hundred metres) when the real-data layer is on.
  const hasProfile = !!one(c, `select 1 from sqlite_master where type = 'table' and name = 'school_profile'`);
  const points = new Map<string, [number, number]>(hasProfile
    ? q<{ school_id: string; lon: number; lat: number }>(c, 'select school_id, lon, lat from school_profile where lon is not null').map((r) => [r.school_id, [r.lon, r.lat]])
    : []);
  const g = generateInsideReal({ districts, blocks, clusters, schools, outlines, points });

  exec(c, 'delete from geo_units'); exec(c, 'delete from geo_relationships'); exec(c, 'delete from geo_levels'); exec(c, 'delete from geo_hierarchies');
  exec(c, `insert into geo_hierarchies values ('admin', 'Administrative', 'Country → State → District → Block → Cluster → School')`);
  exec(c, `insert into geo_hierarchies values ('urban', 'Urban areas', 'Country → State → District → City → Cluster → School (city clusters only)')`);
  [['country', 0, 'Country'], ['state', 1, 'State'], ['district', 2, 'District'], ['block', 3, 'Block'], ['cluster', 4, 'Cluster'], ['school', 5, 'School']]
    .forEach(([l, r, lab]) => exec(c, `insert into geo_levels values ('admin', ?, ?, ?)`, l, r, lab));
  [['country', 0, 'Country'], ['state', 1, 'State'], ['district', 2, 'District'], ['city', 3, 'City'], ['cluster', 4, 'Cluster'], ['school', 5, 'School']]
    .forEach(([l, r, lab]) => exec(c, `insert into geo_levels values ('urban', ?, ?, ?)`, l, r, lab));

  const ins = c.prepare(`insert into geo_units values (?,?,?,?,?,?,?,?,?,?)`);
  const rel = c.prepare(`insert into geo_relationships values (?,?,?)`);
  const putReal = (id: string, level: string, name: string, code: string | null, geom: Geometry, centroid: [number, number], note: string) =>
    ins.run(id, level, name, code, 'osm', centroid[0], centroid[1], JSON.stringify(bboxOf(geom)), shape(geom), note);
  const putSim = (id: string, level: string, name: string, code: string | null, u: GenUnit | undefined, note: string) =>
    ins.run(id, level, name, code, u ? 'simulated' : 'none', u?.centroid[0] ?? null, u?.centroid[1] ?? null, u ? JSON.stringify(u.bbox) : null, u ? geojson(u) : null, note);

  const OSM_NOTE = `Real boundary. ${up.attribution}`;
  ins.run('IN', 'country', 'India', 'IN', 'none', null, null, null, null, 'Country outline not drawn; the map shows one state.');
  const sb = bboxOf(up.state.geometry);
  putReal(state.id, 'state', up.state.name, null, up.state.geometry, [(sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2], OSM_NOTE);
  rel.run(state.id, 'IN', 'admin'); rel.run(state.id, 'IN', 'urban');

  // The demo districts: real outline, label placed inside by the generator.
  districts.forEach((d, i) => {
    const u = g.units.get(d.id);
    if (!u || !outlines.get(d.id)) return;
    putReal(d.id, 'district', REAL_DISTRICTS[i], d.code, outlines.get(d.id)!, u.centroid, `${OSM_NOTE} Learning data inside it is simulated.`);
    rel.run(d.id, state.id, 'admin'); rel.run(d.id, state.id, 'urban');
  });
  // Every other district of the state, shown so the state view is complete, with no data.
  for (const x of up.districts) {
    if (REAL_DISTRICTS.includes(x.name)) continue;
    const bb = bboxOf(x.geometry);
    const id = `UPD-${x.osm_id}`;
    putReal(id, 'district', x.name, null, x.geometry, [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], `${OSM_NOTE} No demo data in this district.`);
    rel.run(id, state.id, 'admin'); rel.run(id, state.id, 'urban');
  }
  const SIM_NOTE = points.size
    ? 'Demo grouping drawn around the real positions of its schools (UDISE+). Not a real boundary.'
    : 'Simulated subdivision drawn inside the real district outline. Not a real boundary.';
  for (const b of blocks) { putSim(b.id, 'block', b.name, b.code, g.units.get(b.id), SIM_NOTE); rel.run(b.id, b.district_id, 'admin'); }
  for (const cl of clusters) { putSim(cl.id, 'cluster', cl.name, null, g.units.get(cl.id), SIM_NOTE); rel.run(cl.id, cl.block_id, 'admin'); }
  for (const s of schools) {
    const p = g.schoolPoints.get(s.id);
    const real = points.has(s.id);
    ins.run(s.id, 'school', s.name, null, p ? (real ? 'udise' : 'simulated') : 'none', p?.[0] ?? null, p?.[1] ?? null, null, p ? JSON.stringify({ type: 'Point', coordinates: p }) : null,
      real ? 'Real school (UDISE+ 2020-21), shown a few hundred metres from its true position; name withheld. Its learning results are simulated.'
        : 'Simulated position inside its cluster. Not a real school or location.');
    rel.run(s.id, s.cluster_id, 'admin');
    rel.run(s.id, s.cluster_id, 'urban');
  }

  // Cities: a circle around the real city centre, made of the demo clusters whose centre falls
  // inside it (at least the two nearest, so every city has something to show).
  districts.forEach((d, i) => {
    const city = up.cities.find((x) => x.district === REAL_DISTRICTS[i]);
    if (!city) return;
    const ring = circleRing(city.center, city.radius_km);
    const area: Geometry = { type: 'Polygon', coordinates: [ring] };
    const near = clusters.filter((cl) => cl.district_id === d.id && g.units.has(cl.id))
      .map((cl) => ({ cl, u: g.units.get(cl.id)! }))
      .sort((a, b) => ((a.u.centroid[0] - city.center[0]) ** 2 + (a.u.centroid[1] - city.center[1]) ** 2) - ((b.u.centroid[0] - city.center[0]) ** 2 + (b.u.centroid[1] - city.center[1]) ** 2));
    const inside = near.filter((x) => insideGeometry(x.u.centroid, area));
    const members = inside.length >= 2 ? inside : near.slice(0, 2);
    const id = `CTY-${String(i + 1).padStart(2, '0')}`;
    ins.run(id, 'city', city.name, null, 'approximate', city.center[0], city.center[1], JSON.stringify(bboxOf(area)), shape(area),
      `Approximate area: a ${city.radius_km} km circle around the real city centre (${up.attribution}). Clusters inside it are simulated.`);
    rel.run(id, d.id, 'urban');
    for (const x of members) rel.run(x.cl.id, id, 'urban');
  });
}

// ---------------------------------------------------------------- reporting lines
function seedReporting(c: DatabaseSync) {
  exec(c, `delete from reporting_lines where source = 'derived_from_seed'`);
  // The first active holder of each role in each place, read once rather than once per account.
  const firstHolder = new Map<string, string>();
  for (const r of q<{ user_id: string; role: string; scope_id: string }>(c, `select ur.user_id, ur.role, ur.scope_id from user_roles ur join users u on u.id = ur.user_id where u.status = 'active' order by ur.user_id`)) {
    const k = `${r.role}|${r.scope_id}`;
    if (!firstHolder.has(k)) firstHolder.set(k, r.user_id);
  }
  const first = (role: string, scope: string) => firstHolder.get(`${role}|${scope}`) ?? null;
  const stateAdmin = one<{ user_id: string }>(c, `select user_id from user_roles where role = 'state_admin' order by user_id limit 1`)?.user_id ?? null;
  const rows = q<{ user_id: string; role: string; scope_id: string }>(c, `select user_id, role, scope_id from user_roles order by user_id`);
  const ins = c.prepare(`insert into reporting_lines (user_id, manager_user_id, relation, source, updated_at, updated_by) values (?,?,?,?,?,null) on conflict(user_id) do nothing`);
  for (const r of rows) {
    let mgr: string | null = null;
    if (r.role === 'headmaster') {
      const cl = one<{ cluster_id: string }>(c, 'select cluster_id from schools where id = ?', r.scope_id)?.cluster_id;
      mgr = cl ? first('crc', cl) : null;
    } else if (r.role === 'crc') {
      const b = one<{ block_id: string }>(c, 'select block_id from clusters where id = ?', r.scope_id)?.block_id;
      mgr = b ? first('beo', b) : null;
    } else if (r.role === 'brc') mgr = first('beo', r.scope_id);
    else if (r.role === 'beo') {
      const d = one<{ district_id: string }>(c, 'select district_id from blocks where id = ?', r.scope_id)?.district_id;
      mgr = d ? first('deo', d) : null;
    } else if (r.role === 'deo' || r.role === 'auditor') mgr = stateAdmin;
    if (mgr === r.user_id) mgr = null;
    ins.run(r.user_id, mgr, 'designated_authority', 'derived_from_seed', `${AS_OF}T00:00:00.000Z`);
  }
  // One demo acting arrangement: the CRC of CLU-003 holds acting charge of CLU-002 while its CRC is on leave.
  const crc3 = first('crc', 'CLU-003');
  const crc2 = first('crc', 'CLU-002');
  exec(c, `delete from delegations where id = 'DLG-0001'`);
  if (crc3 && crc2) {
    exec(c, `insert into delegations values ('DLG-0001', ?, ?, 'crc', 'cluster', 'CLU-002', '2026-10-15', '2026-11-05',
      'CRC of Kusumgarh on medical leave; neighbouring CRC holds acting charge.', ?, '2026-10-14T06:00:00.000Z', null, null)`, crc2, crc3, first('beo', 'BLK-01') ?? crc3);
  }
}

// ---------------------------------------------------------------- complaint policy
function seedComplaintPolicy(c: DatabaseSync) {
  exec(c, 'delete from complaint_categories'); exec(c, 'delete from escalation_policies');
  const cats: [string, string, string, string, string | null, number][] = [
    ['material_shortage', 'Teaching material shortage', 'Kits, workbooks or reading material not available.', 'immediate', null, 0],
    ['teacher_availability', 'Teacher availability', 'A post is vacant, a teacher is deputed elsewhere, or absent for long periods.', 'immediate', null, 0],
    ['infrastructure', 'Infrastructure issue', 'Classrooms, toilets, water or electricity. Routed straight to the block office, which holds the budget.', 'level', 'block', 0],
    ['academic_support_delay', 'Academic support delay', 'Promised coaching visits or academic support have not happened.', 'immediate', null, 0],
    ['training_requirement', 'Training requirement', 'Teachers need training before an activity can be delivered.', 'immediate', null, 0],
    ['assessment_issue', 'Assessment issue', 'Problems with how an assessment round was conducted or recorded.', 'immediate', null, 0],
    ['resource_allocation', 'Resource allocation', 'Funds or staff allocated unevenly across schools or clusters.', 'level', 'district', 0],
    ['administrative_delay', 'Administrative delay', 'An approval or decision is overdue.', 'immediate', null, 0],
    ['conduct', 'Conduct of an officer', 'An allegation about an officer. Always restricted; routed around the person concerned.', 'independent', null, 1],
    ['other', 'Other', 'Anything else.', 'immediate', null, 0],
  ];
  cats.forEach(([k, l, d, r, rl, conf], i) => exec(c, `insert into complaint_categories values (?,?,?,?,?,?,?)`, k, l, d, r, rl, conf, i));
  const pri: [string, number, number, string | null][] = [['low', 5, 21, null], ['medium', 3, 14, null], ['high', 2, 7, null], ['critical', 1, 3, 'district']];
  for (const [k] of cats) {
    for (const [p, ack, res, crit] of pri) {
      exec(c, `insert into escalation_policies values (?,?,?,?,?,?,?)`, k, p, ack, res, 'next_authority',
        k === 'conduct' ? 'district' : k === 'teacher_availability' || k === 'infrastructure' ? crit : null,
        JSON.stringify(p === 'critical' ? ['assignee', 'next_authority'] : ['assignee']));
    }
  }
}

// ---------------------------------------------------------------- demo complaints
function seedComplaints(c: DatabaseSync) {
  exec(c, `delete from complaint_events where complaint_id in (select id from complaints where provenance = 'synthetic_demo')`);
  exec(c, `delete from complaints where provenance = 'synthetic_demo'`);
  const userOf = (role: string, scope: string) => one<{ id: string; full_name: string }>(c, `select u.id, u.full_name from users u join user_roles ur on ur.user_id = u.id where ur.role = ? and ur.scope_id = ? order by u.id limit 1`, role, scope);
  const mgr = (uid: string) => one<{ manager_user_id: string | null }>(c, 'select manager_user_id from reporting_lines where user_id = ?', uid)?.manager_user_id ?? null;
  const roleOf = (uid: string) => one<{ role: string }>(c, 'select role from user_roles where user_id = ? limit 1', uid)?.role ?? 'unknown';
  const name = (uid: string | null) => (uid ? one<{ full_name: string }>(c, 'select full_name from users where id = ?', uid)?.full_name ?? uid : 'system');
  const add = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const geoOfSchool = (sid: string) => one<{ cluster_id: string; block_id: string; district_id: string; state_id: string }>(c, 'select cluster_id, block_id, district_id, state_id from schools where id = ?', sid)!;
  const policy = (cat: string, pri: string) => one<{ ack_sla_days: number; resolve_sla_days: number }>(c, 'select ack_sla_days, resolve_sla_days from escalation_policies where category_key = ? and priority = ?', cat, pri)!;

  let evN = 0;
  const ev = (cid: string, ts: string, actor: string | null, kind: string, from: string | null, to: string | null, note: string | null, internal = 0, assigned: string | null = null) => {
    evN++;
    exec(c, `insert into complaint_events values (?,?,?,?,?,?,?,?,?,?,?)`, `CEVT-${String(evN).padStart(5, '0')}`, cid, ts, actor, name(actor), kind, from, to, note, internal, assigned);
  };

  type Spec = { school: string; reporterRole?: 'headmaster' | 'crc' | 'beo'; cat: string; pri: string; sev: string; title: string; desc: string; day: number; story: string[]; accused?: 'crc'; };
  // Story steps: ack, investigate, info, propose, verify, resolve, close, reject, reopen, escalate_sla, escalate_manual
  const specs: Spec[] = [
    { school: 'SCH-00002', cat: 'material_shortage', pri: 'medium', sev: 'moderate', title: 'Number-activity kits not received for Class 3', desc: 'The remedial-hour plan needs level-wise activity cards. None have arrived; teachers are improvising with the blackboard.', day: -2, story: [] },
    { school: 'SCH-00004', cat: 'teacher_availability', pri: 'high', sev: 'high', title: 'Class 3 teacher deputed for election duty', desc: 'Our only Class 3 teacher has been deputed for two weeks. The remedial hour cannot run.', day: -14, story: ['ack', 'investigate'] },
    { school: 'SCH-00007', cat: 'academic_support_delay', pri: 'medium', sev: 'moderate', title: 'No CRC coaching visit in 70 days', desc: 'The coaching cycle agreed in the plan has not started. No visit since August.', day: -23, story: ['escalate_sla', 'ack', 'investigate'] },
    { school: 'SCH-00001', cat: 'infrastructure', pri: 'medium', sev: 'moderate', title: 'Roof leak in the Class 2 room', desc: 'Water comes in during rain; children are moved to the verandah.', day: -6, story: ['ack'] },
    { school: 'SCH-00002', cat: 'conduct', pri: 'high', sev: 'high', title: 'Visit records entered without visits taking place', desc: 'Visit logs show coaching visits on dates when no one came to the school.', day: -9, story: ['ack', 'investigate'], accused: 'crc' },
    { school: 'SCH-00003', cat: 'assessment_issue', pri: 'low', sev: 'low', title: 'Wrong roll numbers on the R3 assessment sheet', desc: 'Six children were marked absent who were present.', day: -40, story: ['ack', 'investigate', 'propose', 'verify', 'resolve', 'close'] },
    { school: 'SCH-00005', cat: 'training_requirement', pri: 'medium', sev: 'moderate', title: 'Teachers not oriented on level-wise grouping', desc: 'The plan assumes teachers know how to group by level. They were never oriented.', day: -12, story: ['ack', 'info'] },
    { school: 'SCH-00006', cat: 'other', pri: 'low', sev: 'low', title: 'Request for an extra blackboard', desc: 'Would help with grouping.', day: -20, story: ['reject'] },
    { school: 'SCH-00008', cat: 'material_shortage', pri: 'medium', sev: 'moderate', title: 'Reading cards delivered for the wrong class', desc: 'We received Class 1 cards instead of Class 3.', day: -30, story: ['ack', 'investigate', 'propose', 'verify', 'resolve', 'reopen'] },
    { school: 'SCH-00009', cat: 'teacher_availability', pri: 'critical', sev: 'critical', title: 'Single-teacher school: teacher on long leave', desc: 'The school has been closed four days this week. 63 children enrolled.', day: -3, story: ['ack'] },
    { school: 'SCH-00010', cat: 'administrative_delay', pri: 'medium', sev: 'moderate', title: 'Deputation order not issued after approval', desc: 'The plan was approved a month ago but the deputation order has not been issued.', day: -16, story: ['ack', 'investigate', 'escalate_manual'] },
    { school: 'SCH-00011', cat: 'academic_support_delay', pri: 'medium', sev: 'moderate', title: 'Spot assessment results not shared', desc: 'The CRC assessed children last month but we never saw the results.', day: -11, story: ['ack', 'investigate', 'propose'] },
  ];
  // A few more across other blocks and districts, so district and state views have material.
  const others = q<{ id: string }>(c, `select s.id from schools s where s.block_id <> 'BLK-01' and s.id in (select min(id) from schools group by block_id) order by s.id limit 12`);
  const cats2 = ['material_shortage', 'teacher_availability', 'academic_support_delay', 'training_requirement', 'infrastructure', 'assessment_issue'];
  const stories2 = [[], ['ack'], ['ack', 'investigate'], ['escalate_sla'], ['ack', 'investigate', 'propose', 'verify', 'resolve', 'close'], ['ack', 'info']];
  others.forEach((s, i) => specs.push({ school: s.id, cat: cats2[i % cats2.length], pri: i % 5 === 0 ? 'high' : 'medium', sev: 'moderate', title: ['Workbooks short by half', 'Teacher post vacant since June', 'Coaching visits not happening', 'Orientation needed before remedial hour', 'Boundary wall collapsed', 'Assessment held during exam week'][i % 6], desc: 'Raised by the headmaster through Karyavahi.', day: -(5 + i * 3), story: stories2[i % stories2.length] }));
  // An officer-raised complaint going up the chain: BEO → DEO, unacknowledged and past SLA.
  specs.push({ school: 'SCH-00001', reporterRole: 'beo', cat: 'resource_allocation', pri: 'high', sev: 'high', title: 'Remedial kits allocated to only 2 of 6 blocks', desc: 'District allocation left Rampur Sadar without kits for 9 clusters.', day: -5, story: [] });

  specs.forEach((sp, i) => {
    const cid = `CMP-${String(i + 1).padStart(4, '0')}`;
    const geo = geoOfSchool(sp.school);
    const reporter = sp.reporterRole === 'beo' ? userOf('beo', geo.block_id) : userOf('headmaster', sp.school);
    if (!reporter) return;
    const created = add(AS_OF, sp.day);
    const pol = policy(sp.cat, sp.pri);
    // Initial authority, from the same rules the live engine applies.
    const crc = userOf('crc', geo.cluster_id)?.id ?? null;
    const beo = userOf('beo', geo.block_id)?.id ?? null;
    const deo = userOf('deo', geo.district_id)?.id ?? null;
    let assignee = mgr(reporter.id);
    let accused: string | null = null;
    let confidentiality = 'standard';
    if (sp.cat === 'infrastructure') assignee = beo;
    if (sp.cat === 'resource_allocation') assignee = deo;
    if (sp.pri === 'critical' && (sp.cat === 'teacher_availability' || sp.cat === 'infrastructure')) assignee = deo;
    if (sp.accused === 'crc') { accused = crc; confidentiality = 'restricted'; assignee = beo; }
    let status = 'submitted';
    let ackAt: string | null = null, resolvedAt: string | null = null, closedAt: string | null = null, resolution: string | null = null;
    let level = 0;
    let t = created;
    ev(cid, `${created}T05:30:00.000Z`, reporter.id, 'submitted', 'draft', 'submitted', null, 0, assignee);
    if (assignee !== mgr(reporter.id)) {
      ev(cid, `${created}T05:30:01.000Z`, null, 'routed', null, null,
        sp.accused ? 'Restricted: routed around the officer concerned to the next independent authority.' : sp.pri === 'critical' ? 'Critical priority: policy routes directly to the district.' : 'Category rule routes this complaint to a specific level.', 1, assignee);
    }
    let ackDue = add(created, pol.ack_sla_days);
    let resDue = add(created, pol.resolve_sla_days);
    for (const step of sp.story) {
      t = add(t, 1);
      const ts = `${t}T06:00:00.000Z`;
      if (step === 'ack') { ev(cid, ts, assignee, 'acknowledged', status, 'acknowledged', 'Acknowledged. Looking into it.'); status = 'acknowledged'; ackAt = ts; }
      if (step === 'investigate') { ev(cid, ts, assignee, 'status_changed', status, 'under_investigation', 'Checking with the school and the block office.', 1); status = 'under_investigation'; }
      if (step === 'info') { ev(cid, ts, assignee, 'information_requested', status, 'information_requested', 'Please share which teachers need orientation and when they are free.'); status = 'information_requested'; }
      if (step === 'propose') { ev(cid, ts, assignee, 'resolution_proposed', status, 'resolution_proposed', 'Proposed: corrected material dispatched from the BRC store.'); status = 'resolution_proposed'; }
      if (step === 'verify') { ev(cid, ts, assignee, 'status_changed', status, 'awaiting_verification', 'Waiting for the school to confirm.'); status = 'awaiting_verification'; }
      if (step === 'resolve') { ev(cid, ts, reporter.id, 'resolved', status, 'resolved', 'Confirmed by the school.'); status = 'resolved'; resolvedAt = ts; resolution = 'Correct material delivered and confirmed by the school.'; }
      if (step === 'close') { ev(cid, ts, assignee, 'closed', status, 'closed', null); status = 'closed'; closedAt = ts; }
      if (step === 'reject') { ev(cid, ts, assignee, 'rejected', status, 'rejected', 'Outside the scope of this complaint process; raise through the school grant instead.'); status = 'rejected'; }
      if (step === 'reopen') { ev(cid, ts, reporter.id, 'reopened', status, 'reopened', 'The replacement cards are also for the wrong class.'); status = 'reopened'; resolvedAt = null; }
      if (step === 'escalate_sla' || step === 'escalate_manual') {
        const next = assignee ? mgr(assignee) : null;
        if (next) {
          ev(cid, ts, step === 'escalate_sla' ? null : assignee, 'escalated', status, 'escalated',
            step === 'escalate_sla' ? `Acknowledgement SLA (${pol.ack_sla_days} days) missed by ${name(assignee)}. Escalated to the next designated authority.` : 'Needs a district-level order. Escalating with reason.', 0, next);
          assignee = next; status = 'escalated'; level++;
          ackDue = add(t, pol.ack_sla_days); resDue = add(t, pol.resolve_sla_days);
        }
      }
    }
    exec(c, `insert into complaints values (${Array(30).fill('?').join(',')})`,
      cid, sp.cat, sp.title, sp.desc, reporter.id, roleOf(reporter.id), null,
      sp.reporterRole === 'beo' ? null : sp.school, sp.reporterRole === 'beo' ? null : geo.cluster_id, geo.block_id, geo.district_id, geo.state_id,
      sp.pri, sp.sev, confidentiality, accused, status, assignee, assignee ? roleOf(assignee) : null, level,
      null, ackDue, resDue, ackAt, resolvedAt, closedAt, resolution, `${created}T05:30:00.000Z`, `${t}T06:00:00.000Z`, 'synthetic_demo');
  });
}

// ---------------------------------------------------------------- demo registrations
function seedRegistrations(c: DatabaseSync) {
  exec(c, `delete from registration_requests where provenance = 'synthetic_demo'`);
  const userOf = (role: string, scope: string) => one<{ id: string }>(c, `select u.id from users u join user_roles ur on ur.user_id = u.id where ur.role = ? and ur.scope_id = ? order by u.id limit 1`, role, scope)?.id ?? null;
  const existing = one<{ email: string }>(c, `select u.email from users u join user_roles ur on ur.user_id = u.id where ur.role = 'headmaster' and ur.scope_id = 'SCH-00012'`)?.email ?? 'hm.sch-00012@demo.karyavahi.test';
  const rows: [string, string, string, string, string, string, string, string | null, string | null][] = [
    ['REG-0001', 'Asha Verma', 'asha.verma@demo.karyavahi.test', 'headmaster', 'school', 'SCH-00013', 'approval_pending', userOf('beo', 'BLK-01'), null],
    ['REG-0002', 'Ravi Pandey', 'ravi.pandey@demo.karyavahi.test', 'crc', 'cluster', 'CLU-002', 'institutional_verification_pending', userOf('beo', 'BLK-01'), null],
    ['REG-0003', 'Neha Srivastava', 'neha.s@demo.karyavahi.test', 'beo', 'block', 'BLK-02', 'approval_pending', userOf('deo', 'DST-01'), null],
    ['REG-0004', 'Duplicate of an existing headmaster', existing, 'headmaster', 'school', 'SCH-00012', 'approval_pending', userOf('beo', 'BLK-01'), 'existing_user'],
    ['REG-0005', 'Imran Khan', 'imran.k@demo.karyavahi.test', 'headmaster', 'school', 'SCH-00014', 'email_verification_pending', null, null],
    ['REG-0006', 'Sunil Yadav', 'sunil.y@demo.karyavahi.test', 'deo', 'district', 'DST-01', 'rejected', userOf('state_admin', 'STA-01'), null],
  ];
  for (const [id, n, email, role, st, sid, status, verifier, dup] of rows) {
    exec(c, `insert into registration_requests values (${Array(23).fill('?').join(',')})`,
      id, 'new', n, email, null, 'Fictional demo organisation', role, st, sid, null, `EMP-DEMO-${id.slice(4)}`, status,
      String(100000 + (Number(id.slice(4)) * 7919) % 900000), verifier, dup, null, null, null,
      status === 'rejected' ? 'A district post is filled by state order, not by registration.' : null,
      status === 'rejected' ? verifier : null, `${AS_OF}T04:00:00.000Z`, `${AS_OF}T04:00:00.000Z`, 'synthetic_demo');
  }
}
