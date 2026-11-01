import 'server-only';
import { all, one, run, tx, nextIdFor, type Param } from './db';
import { Refused, actingRole, may } from './guard';
import { appendAudit } from './write';
import type { Session } from './session';
import {
  FEEDBACK_KINDS, FEEDBACK_TAGS, COMMENT_MAX, TRYING_MAX,
  type FeedbackKind, type FeedbackTag,
} from './feedback-shared';

/**
 * Feedback from the people using the app: a thumbs up or down on a Claude draft or chat answer
 * (with a few quick reasons on a thumbs down), and the "Feedback / सुझाव दें" form on every
 * signed-in page.
 *
 * Who may do what:
 *   - anyone signed in may give feedback, and read back only their own
 *   - the state programme team and the demo administrator ('feedback.review') read everyone's,
 *     see the counts, and export it as CSV for the user-testing analysis
 *
 * Every saved piece of feedback appends an audit row (without the comment text: what someone
 * wrote stays in the feedback table, where only reviewers read it). An export is audited too.
 * A person may send at most RATE_LIMIT pieces of feedback in RATE_WINDOW_MIN minutes, counted
 * from the table itself, so the limit holds across server restarts.
 *
 * Times are wall-clock: feedback is about the app, not the demo world, and moving the demo
 * clock must not reopen or widen the rate-limit window.
 */

export const RATE_LIMIT = 20;
export const RATE_WINDOW_MIN = 10;
const PATH_MAX = 200;

const wallNow = (): string => new Date().toISOString();

export interface FeedbackRow {
  id: string;
  user_id: string;
  role: string;
  page_path: string;
  kind: FeedbackKind;
  target: string | null;
  ai_interaction_id: string | null;
  rating: number;
  tags: string;
  trying: string | null;
  comment: string | null;
  language: 'en' | 'hi';
  created_at: string;
}

export interface FeedbackInput {
  kind: string;
  rating: number | string;
  pagePath: string;
  target?: string | null;
  aiInteractionId?: string | null;
  tags?: unknown;
  trying?: string | null;
  comment?: string | null;
  language?: string;
}

const DRAFT_TARGET = /^(explain_finding|suggest_plan|summarise_discussion|explain_outcome|report_narrative):(CASE-\d{4}|RPT-\d{5})$/;
const AI_ID = /^AII-\d{6}$/;
// Control characters other than tab and newlines have no place in a comment.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const mayReview = (s: Session): boolean => may(s, 'feedback.review');

/** A path on this site without its query string, or null. */
export function cleanPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const path = p.split(/[?#]/)[0].trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path.length > PATH_MAX || CONTROL.test(path) || /\s/.test(path)) return null;
  return path;
}

/** Text from the form: trimmed, null when empty, refused when too long. */
function text(v: unknown, max: number, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new Refused(`The ${what} must be text.`, 'input');
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (!t) return null;
  if (t.length > max) throw new Refused(`Keep the ${what} to ${max} characters or fewer.`, 'input');
  if (CONTROL.test(t)) throw new Refused(`The ${what} contains characters that cannot be saved.`, 'input');
  return t;
}

/** How many pieces of feedback this person sent in the current window. */
export function recentCount(userId: string): number {
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
  return Number(one<{ c: number }>('select count(*) c from feedback where user_id = ? and created_at > ?', userId, since)?.c ?? 0);
}

/** Saves one piece of feedback and returns its id. Throws Refused with code 'input' or 'rate'. */
export function saveFeedback(s: Session, input: FeedbackInput): { id: string } {
  const kind = input.kind as FeedbackKind;
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) throw new Refused('Unknown kind of feedback.', 'input');

  const rating = typeof input.rating === 'string'
    ? (input.rating === 'up' ? 1 : input.rating === 'down' ? -1 : Number(input.rating))
    : input.rating;
  if (!Number.isInteger(rating)) throw new Refused('Choose a rating.', 'input');
  if (kind === 'page' ? rating < 1 || rating > 5 : rating !== 1 && rating !== -1) {
    throw new Refused(kind === 'page' ? 'Choose a rating from 1 to 5.' : 'Choose thumbs up or thumbs down.', 'input');
  }

  const pagePath = cleanPath(input.pagePath);
  if (!pagePath) throw new Refused('The page this feedback is about was not recognised.', 'input');

  let tags: FeedbackTag[] = [];
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags) || input.tags.length > FEEDBACK_TAGS.length) throw new Refused('Unknown tags.', 'input');
    if (!input.tags.every((t) => (FEEDBACK_TAGS as readonly unknown[]).includes(t))) throw new Refused('Unknown tags.', 'input');
    tags = [...new Set(input.tags as FeedbackTag[])];
  }

  const comment = text(input.comment, COMMENT_MAX, 'comment');
  const trying = kind === 'page' ? text(input.trying, TRYING_MAX, 'answer about what you were trying to do') : null;
  const language = input.language === 'hi' ? 'hi' : 'en';

  // What the rating is about. A chat answer is named by its AI log id, and only the person who
  // asked can rate it; a draft by its task and record.
  let target: string | null = null;
  let aiInteractionId: string | null = null;
  const ownsInteraction = (id: string) => !!one('select 1 x from ai_interactions where id = ? and user_id = ?', id, s.user_id);
  if (kind === 'claude_answer') {
    target = typeof input.target === 'string' ? input.target.trim() : '';
    if (!AI_ID.test(target)) throw new Refused('Which answer is this about? The answer id is missing.', 'input');
    if (!ownsInteraction(target)) throw new Refused('You can rate only answers Claude gave you.', 'input');
    aiInteractionId = target;
  } else if (kind === 'claude_draft') {
    target = typeof input.target === 'string' ? input.target.trim() : '';
    if (!DRAFT_TARGET.test(target)) throw new Refused('Which draft is this about? The draft was not recognised.', 'input');
    const ai = typeof input.aiInteractionId === 'string' ? input.aiInteractionId.trim() : '';
    if (AI_ID.test(ai) && ownsInteraction(ai)) aiInteractionId = ai;
  }

  if (recentCount(s.user_id) >= RATE_LIMIT) {
    throw new Refused(`Thank you — that is a lot of feedback at once. Please wait a few minutes and send the rest.`, 'rate');
  }

  return tx(() => {
    const id = nextIdFor('feedback', 'feedback', 'FBK-', 6);
    const role = actingRole(s);
    run(
      `insert into feedback (id, user_id, role, page_path, kind, target, ai_interaction_id, rating, tags, trying, comment, language, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, s.user_id, role, pagePath, kind, target, aiInteractionId, rating, JSON.stringify(tags), trying, comment, language, wallNow(),
    );
    appendAudit({
      actorUserId: s.user_id, actorLabel: s.full_name, actorRole: role,
      action: 'feedback.submit', entityType: 'feedback', entityId: id,
      after: { kind, rating, tags, target, page_path: pagePath, has_comment: !!comment, language },
    });
    return { id };
  });
}

/** The feedback this person gave, newest first. Never anyone else's. */
export function ownFeedback(s: Session, limit = 50): FeedbackRow[] {
  return all<FeedbackRow>('select * from feedback where user_id = ? order by created_at desc, id desc limit ?', s.user_id, limit);
}

// ------------------------------------------------------------------ review (reviewers only)

export interface FeedbackFilter {
  kind?: string;
  /** 'down' (thumbs down or 1–2 on the form), 'up' (thumbs up or 4–5), 'mid' (3) */
  tone?: string;
  tag?: string;
  role?: string;
  page?: string;
  limit?: number;
}

export interface FeedbackListRow extends FeedbackRow { user_name: string }

function filterSql(f: FeedbackFilter): { sql: string; params: Param[] } {
  const parts: string[] = ['1=1'];
  const params: Param[] = [];
  if (f.kind && (FEEDBACK_KINDS as readonly string[]).includes(f.kind)) { parts.push('f.kind = ?'); params.push(f.kind); }
  if (f.tone === 'down') parts.push(`((f.kind = 'page' and f.rating <= 2) or (f.kind <> 'page' and f.rating = -1))`);
  if (f.tone === 'up') parts.push(`((f.kind = 'page' and f.rating >= 4) or (f.kind <> 'page' and f.rating = 1))`);
  if (f.tone === 'mid') parts.push(`(f.kind = 'page' and f.rating = 3)`);
  if (f.tag && (FEEDBACK_TAGS as readonly string[]).includes(f.tag)) { parts.push(`exists (select 1 from json_each(f.tags) where value = ?)`); params.push(f.tag); }
  if (f.role && /^[a-z_]{2,20}$/.test(f.role)) { parts.push('f.role = ?'); params.push(f.role); }
  if (f.page && f.page.startsWith('/')) { parts.push('f.page_path like ?'); params.push(`${f.page.replace(/[%_]/g, '')}%`); }
  return { sql: parts.join(' and '), params };
}

/** Everyone's feedback, newest first. Empty for anyone who is not a reviewer. */
export function listFeedback(s: Session, f: FeedbackFilter = {}): FeedbackListRow[] {
  if (!mayReview(s)) return [];
  const w = filterSql(f);
  return all<FeedbackListRow>(
    `select f.*, coalesce(u.full_name, f.user_id) user_name
       from feedback f left join users u on u.id = f.user_id
      where ${w.sql}
      order by f.created_at desc, f.id desc limit ?`,
    ...w.params, Math.min(Math.max(f.limit ?? 200, 1), 2000),
  );
}

/** Pages are grouped by route, so /cases/CASE-0184 and /cases/CASE-0201 count together. */
export const routeOf = (path: string): string => path.replace(/\b[A-Z]{2,5}-\d{2,}\b/g, '[id]');

/**
 * Each person's latest rating on each Claude draft or answer (a changed mind replaces the first
 * rating), plus every form. The counts and pictures on the review page read this.
 */
const LATEST = `
  with latest as (
    select f.*, row_number() over (partition by f.user_id, f.kind, coalesce(f.target, f.id) order by f.created_at desc, f.id desc) rn
      from feedback f
  )
  select * from latest where rn = 1`;

export interface FeedbackSummary {
  total: number;
  people: number;
  forms: number;
  formAvg: number | null;
  claude: { kind: FeedbackKind; up: number; down: number }[];
  byPage: { route: string; forms: number; formAvg: number | null; up: number; down: number }[];
  tags: { tag: string; c: number }[];
  byRole: { role: string; c: number }[];
}

export function feedbackSummary(s: Session): FeedbackSummary | null {
  if (!mayReview(s)) return null;
  const rows = all<FeedbackRow>(LATEST);
  const forms = rows.filter((r) => r.kind === 'page');
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

  const claude = (['claude_draft', 'claude_answer'] as const).map((kind) => ({
    kind,
    up: rows.filter((r) => r.kind === kind && r.rating === 1).length,
    down: rows.filter((r) => r.kind === kind && r.rating === -1).length,
  }));

  const pages = new Map<string, { forms: number[]; up: number; down: number }>();
  for (const r of rows) {
    const k = routeOf(r.page_path);
    const p = pages.get(k) ?? { forms: [], up: 0, down: 0 };
    if (r.kind === 'page') p.forms.push(r.rating);
    else if (r.rating === 1) p.up++;
    else p.down++;
    pages.set(k, p);
  }
  const byPage = [...pages.entries()]
    .map(([route, p]) => ({ route, forms: p.forms.length, formAvg: avg(p.forms), up: p.up, down: p.down }))
    .sort((a, b) => (b.forms + b.up + b.down) - (a.forms + a.up + a.down) || a.route.localeCompare(b.route));

  const tagCount = new Map<string, number>();
  for (const r of rows) {
    let ts: string[] = [];
    try { ts = JSON.parse(r.tags) as string[]; } catch { /* none */ }
    for (const t of ts) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  const roleCount = new Map<string, number>();
  for (const r of rows) roleCount.set(r.role, (roleCount.get(r.role) ?? 0) + 1);

  return {
    total: Number(one<{ c: number }>('select count(*) c from feedback')?.c ?? 0),
    people: new Set(rows.map((r) => r.user_id)).size,
    forms: forms.length,
    formAvg: avg(forms.map((r) => r.rating)),
    claude,
    byPage,
    tags: [...tagCount.entries()].map(([tag, c]) => ({ tag, c })).sort((a, b) => b.c - a.c),
    byRole: [...roleCount.entries()].map(([role, c]) => ({ role, c })).sort((a, b) => b.c - a.c),
  };
}

/** Thumbs per AI log row, for the AI activity log. Reviewers only; empty otherwise. */
export function feedbackForInteractions(s: Session, ids: string[]): Map<string, { up: number; down: number; tags: string[] }> {
  const out = new Map<string, { up: number; down: number; tags: string[] }>();
  if (!mayReview(s) || ids.length === 0) return out;
  const rows = all<FeedbackRow>(
    `select * from (${LATEST}) where ai_interaction_id in (${ids.map(() => '?').join(',')})`, ...ids,
  );
  for (const r of rows) {
    const k = r.ai_interaction_id!;
    const e = out.get(k) ?? { up: 0, down: 0, tags: [] };
    if (r.rating === 1) e.up++; else e.down++;
    try { for (const t of JSON.parse(r.tags) as string[]) if (!e.tags.includes(t)) e.tags.push(t); } catch { /* none */ }
    out.set(k, e);
  }
  return out;
}

/** Spreadsheet programs run a cell that starts with = + - @ as a formula; such text is quoted. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export const CSV_COLUMNS = ['id', 'created_at', 'user_id', 'role', 'page_path', 'kind', 'target', 'ai_interaction_id', 'rating', 'tags', 'trying', 'comment', 'language'] as const;

/** Everyone's feedback as CSV, for the analysis sheet. Reviewers only; refusals and exports are audited. */
export function feedbackCsv(s: Session, f: FeedbackFilter = {}): string {
  if (!mayReview(s)) {
    appendAudit({
      actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s),
      action: 'feedback.export', entityType: 'feedback', entityId: 'all',
      reason: 'role cannot review feedback', result: 'failure',
    });
    throw new Refused('Only the state programme team and the demo administrator can export feedback.', 'role');
  }
  const rows = listFeedback(s, { ...f, limit: 2000 });
  appendAudit({
    actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s),
    action: 'feedback.export', entityType: 'feedback', entityId: 'all',
    after: { rows: rows.length, filter: f },
  });
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const tags = (() => { try { return (JSON.parse(r.tags) as string[]).join(' '); } catch { return ''; } })();
    lines.push(CSV_COLUMNS.map((c) => csvCell(c === 'tags' ? tags : r[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
