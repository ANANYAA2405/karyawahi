import type { DatabaseSync } from 'node:sqlite';

/**
 * Extension tables for the read-only API that state dashboard systems (VSKs) pull from.
 *
 *   api_keys   — one row per client. Only the SHA-256 of the secret is kept; the secret itself
 *                is shown once, when the key is made, and cannot be recovered from this table.
 *                A key reads one geographic unit (state, district or block) and everything in it.
 *   api_calls  — one row per request: which key, which path, the status sent back, when, and
 *                how long it took. Never the query string, the request or the response body.
 *                The per-key rate limit is counted from this table.
 *
 * Same rules as ext/schema.ts and ext/collab-schema.ts: the seed's own tables are never
 * altered, these are created next to them idempotently whenever a connection opens, and a demo
 * reset (which restores the pristine seed file) brings them back empty — every key is revoked
 * by a reset, which is what a demo reset should do. Its own version marker in ext_meta.
 */

export const API_VERSION = 'api-v1';

const API_DDL = `
create table if not exists api_keys (
  id text primary key,
  name text not null,
  scope_type text not null check (scope_type in ('state', 'district', 'block')),
  scope_id text not null,
  secret_hash text not null,
  created_by text not null,
  created_at text not null,
  last_used_at text,
  revoked_at text,
  revoked_by text
);
create table if not exists api_calls (
  id integer primary key autoincrement,
  key_id text,
  method text not null,
  path text not null,
  status integer not null,
  ts text not null,
  ms integer not null default 0
);
create index if not exists api_calls_key_ts on api_calls(key_id, ts);
create index if not exists api_calls_ts on api_calls(ts);
`;

export function ensureApiTables(c: DatabaseSync): void {
  const r = c.prepare(`select value from ext_meta where key = 'api_version'`).get() as { value: string } | undefined;
  if (r?.value === API_VERSION) return;
  c.exec(API_DDL);
  c.prepare(
    `insert into ext_meta (key, value) values ('api_version', ?) on conflict(key) do update set value = excluded.value`,
  ).run(API_VERSION);
}
