import 'server-only';
import { randomUUID } from 'node:crypto';
import { db, one, run, tx, nextId } from './db';
import { Refused, actingRole } from './guard';
import type { Session } from './session';
import { nowIso } from './clock';
import { appendAudit, notify, addCaseEvent, loadCaseForWrite } from './write';
import { userCanSeeCase, canRecordDecision, followersOf } from './threads';

/**
 * Writes for case discussion threads. Part of the write layer, same order of checks as
 * write.ts:
 *
 *   signed in → the case exists and is in your scope → the comment is yours (to edit) and has
 *   not changed since you opened it → every @mention can see the case → your role may record a
 *   decision (if flagged) → write, audit, notify
 *
 * A mention of someone outside the case's scope refuses the whole comment — nothing is
 * posted, nobody is notified, and the refused attempt is written to the audit chain. Telling
 * a person about a case they cannot open would leak the case to them.
 *
 * Audit rows use entity_type 'case' so they appear in the case's own audit trail, where a BEO
 * or DEO can see them.
 */

const MAX_BODY = 4000;
const MAX_MENTIONS = 10;

function cleanBody(body: string): string {
  const b = body.replace(/\r\n?/g, '\n').trim();
  if (!b) throw new Refused('Write something first.', 'empty');
  if (b.length > MAX_BODY) throw new Refused(`A comment can be at most ${MAX_BODY} characters.`, 'too_long');
  return b;
}

/** Validate mentions. Refuses (and audits) the whole comment if anyone cannot see the case. */
function checkMentions(s: Session, caseId: string, ids: readonly string[], corr: string): string[] {
  const unique = [...new Set(ids.map((x) => x.trim()).filter(Boolean))].filter((id) => id !== s.user_id);
  if (unique.length > MAX_MENTIONS) throw new Refused(`Mention at most ${MAX_MENTIONS} people in one comment.`, 'too_many');
  for (const id of unique) {
    const exists = one<{ id: string }>(`select id from users where id = ? and status = 'active'`, id);
    if (!exists || !userCanSeeCase(id, caseId)) {
      appendAudit({
        actorUserId: s.user_id, actorRole: actingRole(s), action: 'comment.mention_refused',
        entityType: 'case', entityId: caseId, after: { mentioned_user_id: id },
        reason: exists ? 'mentioned user cannot see this case' : 'mentioned user does not exist or is inactive',
        correlationId: corr, result: 'failure',
      });
      throw new Refused(
        `${id} cannot see this case, so they cannot be mentioned on it. Nothing was saved and nobody was notified.`,
        'mention_scope',
      );
    }
  }
  return unique;
}

function follow(caseId: string, userId: string, reason: string): void {
  // Only adds a follower who has no opinion yet; someone who unfollowed stays unfollowed.
  run(
    `insert into case_watchers (case_id, user_id, following, reason, updated_at) values (?,?,1,?,?)
     on conflict(case_id, user_id) do nothing`,
    caseId, userId, reason, nowIso(),
  );
}

function tellPeople(s: Session, caseId: string, caseTitle: string, commentId: string, body: string, newlyMentioned: string[], decision: boolean, edited: boolean): void {
  const who = s.full_name;
  const snippet = body.length > 140 ? `${body.slice(0, 137)}…` : body;
  const link = `/cases/${caseId}#comment-${commentId}`;
  for (const id of newlyMentioned) {
    notify({
      userId: id, kind: 'mention', title: `${who} mentioned you on ${caseId}`, body: snippet,
      entityType: 'case', entityId: caseId, link,
    });
    run('update case_comment_mentions set notified_at = ? where comment_id = ? and user_id = ?', nowIso(), commentId, id);
  }
  if (edited) return; // an edit tells only the people it newly mentions
  const already = new Set([s.user_id, ...newlyMentioned]);
  for (const id of followersOf(caseId)) {
    if (already.has(id)) continue;
    notify({
      userId: id, kind: decision ? 'decision_recorded' : 'case_comment',
      title: decision ? `Decision recorded on ${caseId}` : `${who} commented on ${caseId}`,
      body: `${caseTitle} — ${snippet}`, entityType: 'case', entityId: caseId, link,
    });
  }
}

// ------------------------------------------------------------------ post
export function postComment(
  s: Session, o: { caseId: string; body: string; mentions?: string[]; decision?: boolean },
): { commentId: string; mentioned: string[] } {
  const c = loadCaseForWrite(s, o.caseId); // scope first; refusal says only whether it exists
  const body = cleanBody(o.body);
  const corr = randomUUID();
  const role = actingRole(s);
  if (o.decision && !canRecordDecision(s)) {
    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: 'case.decision_refused', entityType: 'case', entityId: c.id,
      reason: `a ${role} cannot record a decision`, correlationId: corr, result: 'failure',
    });
    throw new Refused(`${/^[aeiou]/.test(role) ? 'An' : 'A'} ${role} cannot record a decision on a case. Post it as a comment instead.`, 'role');
  }
  const mentioned = checkMentions(s, c.id, o.mentions ?? [], corr);

  return tx(() => {
    const id = nextId('case_comment', 'CMT-', 6);
    const now = nowIso();
    run(
      `insert into case_comments (id, case_id, author_user_id, author_role, body, is_decision, case_event_id, created_at, edited_at, version)
       values (?,?,?,?,?,?,null,?,null,1)`,
      id, c.id, s.user_id, role, body, o.decision ? 1 : 0, now,
    );
    for (const m of mentioned) run('insert into case_comment_mentions (comment_id, user_id, notified_at) values (?,?,null)', id, m);

    if (o.decision) {
      const text = body.replace(/^decision\s*[:\-–—]\s*/i, ''); // people often start with "Decision:" themselves
      addCaseEvent({
        caseId: c.id, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'decision_recorded',
        summary: `Decision: ${text.length > 200 ? `${text.slice(0, 197)}…` : text}`, related: id,
      });
      const ev = one<{ id: string }>(
        `select id from case_events where case_id = ? and related_entity = ? and kind = 'decision_recorded' order by ts desc limit 1`, c.id, id,
      );
      run('update case_comments set case_event_id = ? where id = ?', ev?.id ?? null, id);
    }
    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: o.decision ? 'case.decision_recorded' : 'comment.posted',
      entityType: 'case', entityId: c.id, correlationId: corr,
      after: { comment_id: id, body, mentions: mentioned, is_decision: !!o.decision },
    });

    follow(c.id, s.user_id, 'commented');
    for (const m of mentioned) follow(c.id, m, 'mentioned');
    tellPeople(s, c.id, c.title, id, body, mentioned, !!o.decision, false);
    return { commentId: id, mentioned };
  });
}

// ------------------------------------------------------------------ edit
export function editComment(
  s: Session, o: { commentId: string; body: string; mentions?: string[]; expectedVersion: number },
): { version: number; newlyMentioned: string[] } {
  const cm = one<{ id: string; case_id: string; author_user_id: string; body: string; is_decision: number; version: number }>(
    'select id, case_id, author_user_id, body, is_decision, version from case_comments where id = ?', o.commentId,
  );
  if (!cm) throw new Refused('No such comment.', 'not_found');
  const c = loadCaseForWrite(s, cm.case_id);
  const corr = randomUUID();
  if (cm.author_user_id !== s.user_id) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'comment.edit_refused', entityType: 'case', entityId: c.id,
      after: { comment_id: cm.id }, reason: 'only the author can edit a comment', correlationId: corr, result: 'failure',
    });
    throw new Refused('Only the person who wrote a comment can edit it.', 'not_author');
  }
  if (cm.is_decision === 1) {
    throw new Refused('A recorded decision cannot be edited — it is part of the case history. Post a new comment to correct or add to it.', 'decision_locked');
  }
  if (cm.version !== o.expectedVersion) {
    throw new Refused('This comment changed since you opened it (perhaps in another tab). Reload the page and edit again.', 'stale');
  }
  const body = cleanBody(o.body);
  const wanted = checkMentions(s, c.id, o.mentions ?? [], corr);

  return tx(() => {
    const had = new Set(
      (one<{ ids: string | null }>('select group_concat(user_id) ids from case_comment_mentions where comment_id = ?', cm.id)?.ids ?? '')
        .split(',').filter(Boolean),
    );
    const added = wanted.filter((id) => !had.has(id));
    const removed = [...had].filter((id) => !wanted.includes(id));
    for (const id of removed) run('delete from case_comment_mentions where comment_id = ? and user_id = ?', cm.id, id);
    for (const id of added) run('insert into case_comment_mentions (comment_id, user_id, notified_at) values (?,?,null)', cm.id, id);
    const version = cm.version + 1;
    // The version in the WHERE clause makes the check-and-write atomic.
    const res = db().prepare('update case_comments set body = ?, edited_at = ?, version = ? where id = ? and version = ?')
      .run(body, nowIso(), version, cm.id, cm.version);
    if (Number(res.changes) !== 1) throw new Refused('This comment changed while you were editing it. Reload the page and edit again.', 'stale');
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'comment.edited', entityType: 'case', entityId: c.id,
      correlationId: corr, before: { comment_id: cm.id, body: cm.body, version: cm.version },
      after: { comment_id: cm.id, body, version, mentions_added: added, mentions_removed: removed },
    });
    for (const m of added) follow(c.id, m, 'mentioned');
    tellPeople(s, c.id, c.title, cm.id, body, added, false, true);
    return { version, newlyMentioned: added };
  });
}

// ------------------------------------------------------------------ follow / unfollow
export function setFollowing(s: Session, caseId: string, following: boolean): void {
  const c = loadCaseForWrite(s, caseId);
  tx(() => {
    const before = one<{ following: number }>('select following from case_watchers where case_id = ? and user_id = ?', c.id, s.user_id);
    run(
      `insert into case_watchers (case_id, user_id, following, reason, updated_at) values (?,?,?,?,?)
       on conflict(case_id, user_id) do update set following = excluded.following, reason = excluded.reason, updated_at = excluded.updated_at`,
      c.id, s.user_id, following ? 1 : 0, following ? 'chose_to_follow' : 'chose_to_unfollow', nowIso(),
    );
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: following ? 'case.followed' : 'case.unfollowed',
      entityType: 'case', entityId: c.id, before: before ? { following: before.following === 1 } : null, after: { following },
    });
  });
}
