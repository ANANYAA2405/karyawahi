import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { ensureExtensions } from './ext/schema';

/**
 * Local SQLite adapter. Column names match sql/schema.sql exactly, so the same SQL
 * runs against Postgres/Supabase once a DATABASE_URL is configured.
 *
 * Scoping is NOT done here. Postgres enforces it with row-level security; this adapter
 * has no RLS, so every read goes through the scope predicates in scope.ts. Nothing in the
 * app may query a scoped table without them.
 */

const DATA_DIR = join(process.cwd(), '.data');
export const DB_PATH = join(DATA_DIR, 'karyavahi.db');
export const PRISTINE_PATH = join(DATA_DIR, 'karyavahi.pristine.db');

type Holder = { db: DatabaseSync | null };
const holder: Holder = ((globalThis as unknown as { __kv_db?: Holder }).__kv_db ??= { db: null });

export function db(): DatabaseSync {
  if (holder.db) return holder.db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `No database at ${DB_PATH}. Build it from the seed CSVs first:\n\n    npm run db:build\n`,
    );
  }
  const conn = new DatabaseSync(DB_PATH);
  conn.exec('pragma journal_mode = wal');
  conn.exec('pragma foreign_keys = off');
  // Geography, hierarchy, complaints and onboarding tables live beside the seed's (see ext/schema.ts).
  ensureExtensions(conn);
  holder.db = conn;
  return conn;
}

export type Row = Record<string, string | number | bigint | null | Uint8Array>;
export type Param = string | number | bigint | null;

export function all<T = Row>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as unknown as T[];
}

export function one<T = Row>(sql: string, ...params: Param[]): T | null {
  const r = db().prepare(sql).get(...params);
  return (r ?? null) as T | null;
}

export function count(sql: string, ...params: Param[]): number {
  const r = one<{ c: number }>(sql, ...params);
  return Number(r?.c ?? 0);
}

/** Runs a write and returns how many rows it changed. */
export function run(sql: string, ...params: Param[]): number {
  return Number(db().prepare(sql).run(...params).changes);
}

type Depth = { n: number };
const depth: Depth = ((globalThis as unknown as { __kv_tx?: Depth }).__kv_tx ??= { n: 0 });

/**
 * Transaction, re-entrant. The write functions compose (decidePlan calls transitionCase), and
 * only the outermost call opens and commits; a nested call joins the one already open, so the
 * whole composite still commits or rolls back as a unit.
 */
export function tx<T>(fn: () => T): T {
  const conn = db();
  if (depth.n > 0) { depth.n++; try { return fn(); } finally { depth.n--; } }
  conn.exec('begin immediate');
  depth.n = 1;
  try {
    const out = fn();
    conn.exec('commit');
    return out;
  } catch (e) {
    try { conn.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    depth.n = 0;
  }
}

/** True when a transaction is open. Used to keep refusal audit rows out of a doomed one. */
export const inTransaction = (): boolean => depth.n > 0;

/** Parse a JSON text column. Returns the fallback for null/empty/malformed values. */
export function j<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';
export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Build a `in (?,?,?)` clause. Returns null when the list is empty (caller must short-circuit). */
export function inList(values: readonly string[]): { clause: string; params: string[] } | null {
  if (values.length === 0) return null;
  return { clause: values.map(() => '?').join(','), params: [...values] };
}

/** Next id for a counter kept in app_sequences, e.g. nextId('audit', 'AUD-', 7) -> 'AUD-0047062'. */
export function nextId(name: string, prefix: string, pad: number): string {
  const row = one<{ value: number }>('select value from app_sequences where name = ?', name);
  const next = Number(row?.value ?? 0) + 1;
  run(
    `insert into app_sequences (name, value) values (?, ?)
     on conflict(name) do update set value = excluded.value`,
    name, next,
  );
  return `${prefix}${String(next).padStart(pad, '0')}`;
}

/**
 * Next id from a counter kept in app_sequences, never behind the highest id already in the
 * table with that prefix, so new ids cannot collide with seeded rows or with rows an older
 * max(id)+1 writer added. For the small ledger tables; the audit chain keeps its plain counter.
 * `table` is a name from the code, never input.
 */
export function nextIdFor(name: string, table: string, prefix: string, pad: number): string {
  run(
    `insert into app_sequences (name, value)
       select ?, coalesce(max(cast(substr(id, ?) as integer)), 0) from "${table}" where id like ?
     on conflict(name) do update set value = max(app_sequences.value, excluded.value)`,
    name, prefix.length + 1, `${prefix}%`,
  );
  return nextId(name, prefix, pad);
}

/** Next value of a counter in app_sequences, as a number. */
export function nextSeq(name: string): number {
  const row = one<{ value: number }>('select value from app_sequences where name = ?', name);
  const next = Number(row?.value ?? 0) + 1;
  run(
    `insert into app_sequences (name, value) values (?, ?)
     on conflict(name) do update set value = excluded.value`,
    name, next,
  );
  return next;
}

export function getAppState(key: string): string | null {
  return one<{ value: string }>('select value from app_state where key = ?', key)?.value ?? null;
}

export function setAppState(key: string, value: string): void {
  run(
    `insert into app_state (key, value, updated_at) values (?, ?, ?)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    key, value, new Date().toISOString(),
  );
}

/**
 * Restore the pristine seed copy. Demo admin only — the caller checks that.
 *
 * The connection runs in WAL mode, so the database is three files, not one. Replacing only
 * karyavahi.db would leave a stale -wal beside it, and SQLite would then replay that journal
 * over the fresh copy and quietly resurrect the state the reset was meant to discard. Closing
 * the handle checkpoints and removes the journal; the unlinks below cover the case where a
 * previous process died before it could.
 */
export function restorePristine(): void {
  if (!existsSync(PRISTINE_PATH)) throw new Error('No pristine copy. Run: npm run db:build');
  if (holder.db) { holder.db.close(); holder.db = null; }
  for (const suffix of ['-wal', '-shm']) {
    try { rmSync(`${DB_PATH}${suffix}`); } catch { /* not there, which is the normal case */ }
  }
  copyFileSync(PRISTINE_PATH, DB_PATH);
}
