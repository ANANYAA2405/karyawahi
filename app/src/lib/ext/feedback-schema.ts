import type { DatabaseSync } from 'node:sqlite';

/**
 * Extension table for what people tell us about the app while they use it.
 *
 *   feedback — one row per thumbs up / down on a Claude draft or chat answer, and one per
 *              "Feedback / सुझाव दें" form. Who gave it (user id and the role they acted in),
 *              on which page, about what (the draft task and record, or the AI interaction id),
 *              the rating, a few fixed tags, an optional comment of at most 1000 characters, the
 *              interface language, and when (wall-clock time: feedback is about the app itself,
 *              not the demo world, so the demo clock does not apply).
 *
 * Ratings: a page form is 1 to 5 ("how easy was this"); a Claude rating is 1 (up) or -1 (down).
 * A person may change their mind: a second rating on the same Claude draft or answer is a new
 * row, and the review page counts only each person's latest one.
 *
 * Same rules as ext/api-schema.ts: the seed's own tables are never altered, this is created next
 * to them idempotently whenever a connection opens, and a demo reset (which restores the pristine
 * seed file) brings it back empty. Its own version marker in ext_meta.
 */

export const FEEDBACK_VERSION = 'feedback-v1';

const FEEDBACK_DDL = `
create table if not exists feedback (
  id text primary key,
  user_id text not null,
  role text not null,
  page_path text not null,
  kind text not null check (kind in ('page', 'claude_draft', 'claude_answer')),
  target text,
  ai_interaction_id text,
  rating integer not null check ((kind = 'page' and rating between 1 and 5) or (kind <> 'page' and rating in (-1, 1))),
  tags text not null default '[]',
  trying text,
  comment text check (comment is null or length(comment) <= 1000),
  language text not null check (language in ('en', 'hi')),
  created_at text not null
);
create index if not exists feedback_user_ts on feedback(user_id, created_at);
create index if not exists feedback_kind_ts on feedback(kind, created_at);
create index if not exists feedback_ai on feedback(ai_interaction_id);
`;

export function ensureFeedbackTables(c: DatabaseSync): void {
  const r = c.prepare(`select value from ext_meta where key = 'feedback_version'`).get() as { value: string } | undefined;
  if (r?.value === FEEDBACK_VERSION) return;
  c.exec(FEEDBACK_DDL);
  c.prepare(
    `insert into ext_meta (key, value) values ('feedback_version', ?) on conflict(key) do update set value = excluded.value`,
  ).run(FEEDBACK_VERSION);
}
