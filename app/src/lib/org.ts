import 'server-only';
import { all, one, run, tx, nextSeq, nextIdFor } from './db';
import type { Session } from './session';
import { nowIso, today } from './clock';
import { appendAudit, notify } from './write';
import type { RoleCode } from '@domain/types';
import { Refused } from './guard';
import { unitInScope } from './scope';

/**
 * Organisational hierarchy: who reports to whom, who is the designated authority for a piece of
 * geography, acting arrangements (delegations), and account status. Every change here writes to
 * the audit chain. Authority checks live in authz.ts; this module only reads and writes facts.
 */

export type ScopeType = 'state' | 'district' | 'block' | 'cluster' | 'school';
export const LEVELS: ScopeType[] = ['state', 'district', 'block', 'cluster', 'school'];

/** Seniority used for "may this user manage/approve that role". Auditor and demo admin sit outside the line. */
export const ROLE_RANK: Record<RoleCode, number> = {
  state_admin: 5, deo: 4, beo: 3, brc: 2, crc: 2, headmaster: 1, auditor: 0, demo_admin: 0,
};
/** The scope level each role is assigned at. */
export const ROLE_LEVEL: Record<RoleCode, ScopeType> = {
  state_admin: 'state', auditor: 'state', demo_admin: 'state', deo: 'district', beo: 'block', brc: 'block', crc: 'cluster', headmaster: 'school',
};
/** The role that is the designated authority for a unit at each level. */
export const AUTHORITY_ROLE: Record<ScopeType, RoleCode> = {
  state: 'state_admin', district: 'deo', block: 'beo', cluster: 'crc', school: 'headmaster',
};

export interface UnitPath { state: string | null; district: string | null; block: string | null; cluster: string | null; school: string | null }

/** Resolve a unit to its full administrative path. Returns null for unknown ids. */
export function pathOf(type: ScopeType, id: string): UnitPath | null {
  if (type === 'state') return one<{ id: string }>('select id from states where id = ?', id) ? { state: id, district: null, block: null, cluster: null, school: null } : null;
  if (type === 'district') { const r = one<{ state_id: string }>('select state_id from districts where id = ?', id); return r ? { state: r.state_id, district: id, block: null, cluster: null, school: null } : null; }
  if (type === 'block') { const r = one<{ district_id: string }>('select district_id from blocks where id = ?', id); if (!r) return null; return { ...pathOf('district', r.district_id)!, block: id }; }
  if (type === 'cluster') { const r = one<{ block_id: string }>('select block_id from clusters where id = ?', id); if (!r) return null; return { ...pathOf('block', r.block_id)!, cluster: id }; }
  const r = one<{ cluster_id: string }>('select cluster_id from schools where id = ?', id);
  if (!r) return null;
  return { ...pathOf('cluster', r.cluster_id)!, school: id };
}

/** Does unit A contain (or equal) unit B? */
export function contains(aType: ScopeType, aId: string, bType: ScopeType, bId: string): boolean {
  if (LEVELS.indexOf(bType) < LEVELS.indexOf(aType)) return false;
  const p = pathOf(bType, bId);
  return !!p && p[aType] === aId;
}

/** Is the unit inside any of the session's role scopes (own or delegated)? */
export function scopeContains(s: Session, type: ScopeType, id: string): boolean {
  return s.roles.some((r) => contains(r.scope_type as ScopeType, r.scope_id, type, id));
}

export function managerOf(userId: string): string | null {
  return one<{ manager_user_id: string | null }>('select manager_user_id from reporting_lines where user_id = ?', userId)?.manager_user_id ?? null;
}

/** The chain of designated authorities above a user, nearest first. */
export function chainAbove(userId: string, max = 6): string[] {
  const out: string[] = [];
  let cur: string | null = userId;
  while (cur && out.length < max) {
    const m = managerOf(cur);
    if (!m || out.includes(m)) break;
    out.push(m); cur = m;
  }
  return out;
}

/** The active user who is the designated authority for a unit (e.g. the BEO of a block). */
export function authorityFor(type: ScopeType, id: string): string | null {
  const role = AUTHORITY_ROLE[type];
  return one<{ user_id: string }>(
    `select ur.user_id from user_roles ur join users u on u.id = ur.user_id
      where ur.role = ? and ur.scope_id = ? and u.status = 'active' order by ur.user_id limit 1`, role, id,
  )?.user_id ?? null;
}

export interface UserCard { id: string; full_name: string; email: string; status: string; role: RoleCode; scope_type: ScopeType; scope_id: string }
export function userCard(id: string): UserCard | null {
  return one<UserCard>(
    `select u.id, u.full_name, u.email, u.status, ur.role, ur.scope_type, ur.scope_id
       from users u join user_roles ur on ur.user_id = u.id where u.id = ? order by ur.granted_at limit 1`, id,
  );
}

// ---------------------------------------------------------------- delegations
export interface Delegation {
  id: string; from_user_id: string; to_user_id: string; role: RoleCode; scope_type: ScopeType; scope_id: string;
  starts_on: string; ends_on: string; reason: string; created_by: string; created_at: string; revoked_at: string | null;
}

/** Active acting arrangements for a user, on the demo clock's date. */
export function activeDelegationsFor(userId: string, onDate = today()): Delegation[] {
  return all<Delegation>(
    `select * from delegations where to_user_id = ? and revoked_at is null and starts_on <= ? and ends_on >= ?`,
    userId, onDate, onDate,
  );
}

export function listDelegations(scopeFilter: (d: Delegation) => boolean): Delegation[] {
  return all<Delegation>('select * from delegations order by created_at desc').filter(scopeFilter);
}

export function createDelegation(actor: Session, d: Omit<Delegation, 'id' | 'created_by' | 'created_at' | 'revoked_at'>): string {
  return tx(() => {
    const id = nextIdFor('delegation', 'delegations', 'DLG-', 4);
    run(`insert into delegations values (?,?,?,?,?,?,?,?,?,?,?,null,null)`,
      id, d.from_user_id, d.to_user_id, d.role, d.scope_type, d.scope_id, d.starts_on, d.ends_on, d.reason, actor.user_id, nowIso());
    appendAudit({ actorUserId: actor.user_id, actorLabel: actor.full_name, actorRole: actor.role, action: 'delegation.create', entityType: 'delegation', entityId: id, after: d, reason: d.reason });
    notify({ userId: d.to_user_id, kind: 'delegation', title: `Acting charge: ${d.role.toUpperCase()} ${d.scope_id}`, body: `${d.starts_on} to ${d.ends_on}. ${d.reason}`, entityType: 'delegation', entityId: id, link: '/admin/hierarchy' });
    return id;
  });
}

export function revokeDelegation(actor: Session, id: string, reason: string): void {
  tx(() => {
    run('update delegations set revoked_at = ?, revoked_by = ? where id = ? and revoked_at is null', nowIso(), actor.user_id, id);
    appendAudit({ actorUserId: actor.user_id, actorLabel: actor.full_name, actorRole: actor.role, action: 'delegation.revoke', entityType: 'delegation', entityId: id, reason });
  });
}

/** Accounts this user may see on the accounts page: people whose role sits inside their area,
 *  never the officers above them. The demo admin sees everyone. */
export function usersInArea(s: Session, q = ''): { id: string; full_name: string; email: string; status: string; role: RoleCode; scope_type: string; scope_id: string }[] {
  const everyone = s.roles.some((r) => r.role === 'demo_admin');
  const area = everyone ? { sql: '1=1', params: [] } : unitInScope(s, 'ur.scope_type', 'ur.scope_id');
  const text = q.trim().slice(0, 60);
  return all<{ id: string; full_name: string; email: string; status: string; role: RoleCode; scope_type: string; scope_id: string }>(
    `select u.id, u.full_name, u.email, u.status, ur.role, ur.scope_type, ur.scope_id
       from users u join user_roles ur on ur.user_id = u.id
      where (${area.sql}) ${text ? 'and (u.full_name like ? or u.email like ? or u.id like ?)' : ''}
      order by case u.status when 'suspended' then 0 else 1 end,
               case ur.role when 'deo' then 1 when 'beo' then 2 when 'brc' then 3 when 'crc' then 4 else 5 end, u.full_name
      limit 80`,
    ...area.params, ...(text ? [`%${text}%`, `%${text}%`, `%${text}%`] : []),
  ).filter((u) => u.id !== s.user_id);
}

// ---------------------------------------------------------------- reporting lines & scope
/**
 * Sets who a user reports to. The new manager must be active, more senior than the user, and
 * either the actor or someone inside the actor's own area: a block officer arranges lines
 * within their block, and cannot route a headmaster's complaints to anyone in the state.
 * Authority over the user themselves is checked by the caller (manage_hierarchy).
 */
export function setManager(actor: Session, userId: string, managerId: string | null, reason: string): void {
  if (managerId === userId) throw new Refused('A user cannot report to themselves.', 'input');
  const u = userCard(userId);
  const m = managerId ? userCard(managerId) : null;
  if (managerId && (!m || m.status !== 'active')) throw new Refused('The designated authority must be an active user.', 'input');
  if (u && m && ROLE_RANK[m.role] <= ROLE_RANK[u.role]) throw new Refused('The designated authority must hold a more senior role.', 'input');
  if (m && m.id !== actor.user_id && !scopeContains(actor, m.scope_type as ScopeType, m.scope_id)) {
    throw new Refused('Choose yourself or someone inside your own area as the designated authority.', 'scope');
  }
  const before = managerOf(userId);
  tx(() => {
    run(`insert into reporting_lines (user_id, manager_user_id, relation, source, updated_at, updated_by) values (?,?,?,?,?,?)
         on conflict(user_id) do update set manager_user_id = excluded.manager_user_id, source = 'manual', updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      userId, managerId, 'designated_authority', 'manual', nowIso(), actor.user_id);
    appendAudit({ actorUserId: actor.user_id, actorLabel: actor.full_name, actorRole: actor.role, action: 'hierarchy.set_manager', entityType: 'user', entityId: userId, before: { manager: before }, after: { manager: managerId }, reason });
  });
}

export function reassignScope(actor: Session, userId: string, role: RoleCode, scopeType: ScopeType, scopeId: string, reason: string): void {
  const before = userCard(userId);
  tx(() => {
    run('delete from user_roles where user_id = ?', userId);
    run(`insert into user_roles (id, user_id, role, scope_type, scope_id, granted_at, granted_by) values (?,?,?,?,?,?,?)`,
      `UR-${userId}-${Date.now().toString(36)}`, userId, role, scopeType, scopeId, nowIso(), actor.user_id);
    appendAudit({ actorUserId: actor.user_id, actorLabel: actor.full_name, actorRole: actor.role, action: 'user.reassign_scope', entityType: 'user', entityId: userId, before: before ? { role: before.role, scope: `${before.scope_type}:${before.scope_id}` } : null, after: { role, scope: `${scopeType}:${scopeId}` }, reason });
  });
}

export function setAccountStatus(actor: Session, userId: string, to: 'active' | 'suspended' | 'deactivated', reason: string): void {
  const before = one<{ status: string }>('select status from users where id = ?', userId)?.status ?? null;
  tx(() => {
    run('update users set status = ? where id = ?', to, userId);
    run(`insert into account_status_history values (?,?,?,?,?,?,?)`, statusHistoryId(), userId, before, to, actor.user_id, reason, nowIso());
    appendAudit({ actorUserId: actor.user_id, actorLabel: actor.full_name, actorRole: actor.role, action: `user.${to === 'active' ? 'reactivate' : to === 'suspended' ? 'suspend' : 'deactivate'}`, entityType: 'user', entityId: userId, before: { status: before }, after: { status: to }, reason });
  });
}

/** One sequence for every writer of account_status_history. */
export function statusHistoryId(): string {
  const n = nextSeq('account_status');
  const taken = (id: string) => !!one('select 1 x from account_status_history where id = ?', id);
  let id = `ASH-${String(n).padStart(5, '0')}`;
  for (let k = n + 1; taken(id); k++) id = `ASH-${String(k).padStart(5, '0')}`;
  return id;
}

export function statusHistory(userId: string) {
  return all<{ id: string; from_status: string | null; to_status: string; actor_user_id: string | null; reason: string | null; ts: string }>(
    'select * from account_status_history where user_id = ? order by ts desc', userId,
  );
}
