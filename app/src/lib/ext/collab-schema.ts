import type { DatabaseSync } from 'node:sqlite';

/**
 * Extension tables for two features added after the seed:
 *
 *   round import   — remembers the fingerprint (sha256) of every assessment file that was
 *                    committed, so uploading the same file twice adds nothing.
 *   case threads   — a discussion on each case: comments, @mentions and who follows the case.
 *
 * Same rules as ext/schema.ts: the seed's own tables are never altered, these are created next
 * to them idempotently whenever a connection opens, and a demo reset (which restores the
 * pristine seed file) brings them back empty. Each feature has its own version marker in
 * ext_meta, so a later change to one of them can migrate without touching the other.
 */

export const ROUND_IMPORT_VERSION = 'round-import-v1';
export const THREADS_VERSION = 'threads-v1';

const ROUND_IMPORT_DDL = `
create table if not exists import_file_hashes (
  sha256 text not null, round_id text not null, scope_type text not null, scope_id text not null,
  import_batch_id text not null, file_name text not null, uploaded_by text not null, created_at text not null,
  primary key (sha256, round_id, scope_type, scope_id)
);
`;

const THREADS_DDL = `
create table if not exists case_comments (
  id text primary key, case_id text not null, author_user_id text not null, author_role text not null,
  body text not null, is_decision integer not null default 0, case_event_id text,
  created_at text not null, edited_at text, version integer not null default 1
);
create index if not exists case_comments_case on case_comments(case_id, created_at);
create table if not exists case_comment_mentions (
  comment_id text not null, user_id text not null, notified_at text, primary key (comment_id, user_id)
);
create index if not exists case_comment_mentions_user on case_comment_mentions(user_id);
create table if not exists case_watchers (
  case_id text not null, user_id text not null, following integer not null,
  reason text not null, updated_at text not null, primary key (case_id, user_id)
);
create index if not exists case_watchers_user on case_watchers(user_id);
`;

function marker(c: DatabaseSync, key: string): string | null {
  const r = c.prepare('select value from ext_meta where key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

function setMarker(c: DatabaseSync, key: string, value: string): void {
  c.prepare(
    `insert into ext_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value`,
  ).run(key, value);
}

/** Called from ensureExtensions() after ext_meta exists. Cheap when both markers are current. */
export function ensureCollabTables(c: DatabaseSync): void {
  if (marker(c, 'round_import_version') !== ROUND_IMPORT_VERSION) {
    c.exec(ROUND_IMPORT_DDL);
    setMarker(c, 'round_import_version', ROUND_IMPORT_VERSION);
  }
  if (marker(c, 'threads_version') !== THREADS_VERSION) {
    c.exec(THREADS_DDL);
    setMarker(c, 'threads_version', THREADS_VERSION);
  }
}
