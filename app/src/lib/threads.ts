import 'server-only';
import { all, one } from './db';
import { casesPred, hasRole } from './scope';
import { loadSession, type Session } from './session';
import { may } from './guard';
import type { RoleCode } from '@domain/types';

/**
 * Reads for case discussion threads. Scoped like every other read: a thread is visible exactly
 * when its case is (casesPred — the case's geography, or a task on it), so nobody can read a
 * discussion about a case they could not open.
 *
 * "Who can see this case" for another person is answered the same way: load that person's
 * session and run the same predicate. The mention picker and the write layer both use it, so
 * the picker never offers someone the server would then refuse.
 */

export const canSeeCase = (s: Session, caseId: string): boolean => {
  const p = casesPred(s, 'c');
  return one<{ id: string }>(`select c.id from cases c where c.id = ? and (${p.sql})`, caseId, ...p.params) !== null;
};

/** Can this user (by id) open this case? False for unknown or inactive users. */
export function userCanSeeCase(userId: string, caseId: string): boolean {
  const s = loadSession(userId);
  return s !== null && canSeeCase(s, caseId);
}

/** Who may record a comment as a decision: the officers who decide on cases. */
export const canRecordDecision = (s: Session): boolean =>
  hasRole(s, 'beo', 'deo', 'state_admin') && may(s, 'plan.reject_or_revise');

export interface ThreadComment {
  id: string;
  author_user_id: string;
  author_name: string;
  author_role: RoleCode;
  body: string;
  is_decision: boolean;
  created_at: string;
  edited_at: string | null;
  version: number;
  mentions: { user_id: string; name: string }[];
  mine: boolean;
}

export function caseThread(s: Session, caseId: string): ThreadComment[] {
  if (!canSeeCase(s, caseId)) return [];
  const rows = all<{
    id: string; author_user_id: string; author_name: string | null; author_role: RoleCode; body: string;
    is_decision: number; created_at: string; edited_at: string | null; version: number;
  }>(
    `select cc.id, cc.author_user_id, u.full_name author_name, cc.author_role, cc.body, cc.is_decision,
            cc.created_at, cc.edited_at, cc.version
       from case_comments cc left join users u on u.id = cc.author_user_id
      where cc.case_id = ? order by cc.created_at, cc.id`,
    caseId,
  );
  const mentions = all<{ comment_id: string; user_id: string; name: string | null }>(
    `select m.comment_id, m.user_id, u.full_name name
       from case_comment_mentions m join case_comments cc on cc.id = m.comment_id
       left join users u on u.id = m.user_id
      where cc.case_id = ? order by u.full_name`,
    caseId,
  );
  return rows.map((r) => ({
    ...r,
    author_name: r.author_name ?? r.author_user_id,
    is_decision: r.is_decision === 1,
    mentions: mentions.filter((m) => m.comment_id === r.id).map((m) => ({ user_id: m.user_id, name: m.name ?? m.user_id })),
    mine: r.author_user_id === s.user_id,
  }));
}

export interface MentionCandidate { id: string; name: string; role: RoleCode; scope: string }

/**
 * People who can be @mentioned on a case: everyone who can open it, except the viewer.
 * The SQL gathers the plausible set (roles whose area contains the case, task owners, acting
 * arrangements); each is then confirmed with the same scope check the server applies on post.
 */
export function mentionCandidates(s: Session, caseId: string): MentionCandidate[] {
  if (!canSeeCase(s, caseId)) return [];
  const c = one<{ state_id: string; district_id: string; block_id: string; cluster_id: string; school_ids: string }>(
    'select state_id, district_id, block_id, cluster_id, school_ids from cases where id = ?', caseId,
  );
  if (!c) return [];
  const rows = all<{ id: string; name: string; role: RoleCode; scope_type: string; scope_id: string }>(
    `select u.id, u.full_name name, ur.role, ur.scope_type, ur.scope_id
       from users u join user_roles ur on ur.user_id = u.id
      where u.status = 'active' and u.id <> ? and (
            (ur.scope_type = 'state' and ur.scope_id = ?)
         or (ur.scope_type = 'district' and ur.scope_id = ?)
         or (ur.scope_type = 'block' and ur.scope_id = ?)
         or (ur.scope_type = 'cluster' and ur.scope_id = ?)
         or (ur.scope_type = 'school' and ur.scope_id in (select value from json_each(?)))
         or u.id in (select owner_user_id from tasks where case_id = ?)
         or u.id in (select to_user_id from delegations where revoked_at is null and scope_id in (?, ?, ?, ?)))
      order by u.full_name`,
    s.user_id, c.state_id, c.district_id, c.block_id, c.cluster_id, c.school_ids, caseId,
    c.state_id, c.district_id, c.block_id, c.cluster_id,
  );
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (!userCanSeeCase(r.id, caseId)) continue;
    out.push({ id: r.id, name: r.name, role: r.role, scope: r.scope_id });
  }
  return out;
}

/**
 * The people a new comment notifies: the case owner (unless they unfollowed) and everyone who
 * follows it — each re-checked against scope, so someone who has since moved away from the
 * area stops hearing about it.
 */
export function followersOf(caseId: string): string[] {
  const owner = one<{ owner_user_id: string }>('select owner_user_id from cases where id = ?', caseId)?.owner_user_id;
  const rows = all<{ user_id: string; following: number }>('select user_id, following from case_watchers where case_id = ?', caseId);
  const explicit = new Map(rows.map((r) => [r.user_id, r.following === 1]));
  const ids = new Set(rows.filter((r) => r.following === 1).map((r) => r.user_id));
  if (owner && explicit.get(owner) !== false) ids.add(owner);
  return [...ids].filter((id) => userCanSeeCase(id, caseId));
}

export interface WatchState { following: boolean; why: 'owner' | 'following' | 'unfollowed' | 'not_following'; followers: number }

export function watchState(s: Session, caseId: string): WatchState {
  if (!canSeeCase(s, caseId)) return { following: false, why: 'not_following', followers: 0 };
  const row = one<{ following: number }>('select following from case_watchers where case_id = ? and user_id = ?', caseId, s.user_id);
  const owner = one<{ owner_user_id: string }>('select owner_user_id from cases where id = ?', caseId)?.owner_user_id;
  const followers = followersOf(caseId).length;
  if (row) return { following: row.following === 1, why: row.following === 1 ? 'following' : 'unfollowed', followers };
  if (owner === s.user_id) return { following: true, why: 'owner', followers };
  return { following: false, why: 'not_following', followers };
}
