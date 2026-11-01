import 'server-only';
import { randomInt } from 'node:crypto';
import { all, one, run, tx, nextIdFor } from './db';
import { loadSession, type Session } from './session';
import { nowIso } from './clock';
import { appendAudit, notify } from './write';
import { Refused } from './guard';
import { authorize } from './authz';
import { pathOf, authorityFor, reassignScope, statusHistoryId, ROLE_LEVEL, ROLE_RANK, type ScopeType } from './org';
import type { RoleCode } from '@domain/types';

/**
 * Verified registration and account onboarding.
 *
 *   registration_pending → email_verification_pending → institutional_verification_pending
 *     → approval_pending → active | rejected   (info_requested loops back to approval_pending)
 *
 * Selecting a role grants nothing. An account exists only after a designated verifier — senior
 * to the requested role and responsible for the requested scope — approves it. In this demo the
 * email code is shown on screen and the affiliation check is a simulated registry lookup; both
 * are labelled as such. Neither would be proof of government employment on its own.
 */

export const REG_STATUS: Record<string, { label: string; tone: 'neutral' | 'pending' | 'active' | 'good' | 'warn' | 'critical' }> = {
  registration_pending: { label: 'Registration pending', tone: 'pending' },
  email_verification_pending: { label: 'Email verification pending', tone: 'pending' },
  institutional_verification_pending: { label: 'Affiliation verification pending', tone: 'pending' },
  approval_pending: { label: 'Approval pending', tone: 'warn' },
  info_requested: { label: 'More information requested', tone: 'warn' },
  active: { label: 'Approved — account active', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
};

export const REQUESTABLE: RoleCode[] = ['headmaster', 'crc', 'brc', 'beo', 'deo', 'auditor', 'state_admin'];

export interface RegistrationRequest {
  id: string; request_type: 'new' | 'change'; full_name: string; email: string; mobile: string | null; organisation: string | null;
  requested_role: RoleCode; scope_type: ScopeType; scope_id: string; reporting_user_id: string | null; affiliation_ref: string | null;
  status: string; email_code: string; verifier_user_id: string | null; duplicate_of: string | null; target_user_id: string | null;
  created_user_id: string | null; info_request: string | null; decision_reason: string | null; decided_by: string | null;
  created_at: string; updated_at: string; provenance: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AFFIL_RE = /^EMP-[A-Z]{2,8}-\d{3,6}$/;

function nextRegId(): string {
  return nextIdFor('registration', 'registration_requests', 'REG-', 4);
}

/** The designated verifier for a requested role and scope: the authority one level up. */
export function verifierFor(role: RoleCode, type: ScopeType, id: string): string | null {
  const p = pathOf(type, id);
  if (!p) return null;
  if (role === 'headmaster' || role === 'crc' || role === 'brc') return p.block ? authorityFor('block', p.block) : null;
  if (role === 'beo') return p.district ? authorityFor('district', p.district) : null;
  return p.state ? authorityFor('state', p.state) : null;
}

export interface NewRegistration { fullName: string; email: string; mobile?: string; organisation?: string; role: string; scopeType: string; scopeId: string; affiliationRef?: string }

export function createRegistration(input: NewRegistration): { id: string; code: string } {
  const fullName = input.fullName.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  const role = input.role as RoleCode;
  const scopeType = input.scopeType as ScopeType;
  if (fullName.length < 3) throw new Refused('Enter your full name.', 'input');
  if (!EMAIL_RE.test(email)) throw new Refused('Enter a valid official email address.', 'input');
  if (!REQUESTABLE.includes(role)) throw new Refused('That role cannot be requested.', 'input');
  if (ROLE_LEVEL[role] !== scopeType) throw new Refused(`A ${role.replace('_', ' ')} is assigned at ${ROLE_LEVEL[role]} level.`, 'input');
  if (!pathOf(scopeType, input.scopeId)) throw new Refused('Choose a valid place for the assignment.', 'input');
  if (input.mobile && !/^[0-9+\- ]{8,16}$/.test(input.mobile)) throw new Refused('Mobile number looks invalid.', 'input');

  const pending = one<{ id: string }>(`select id from registration_requests where lower(email) = ? and status not in ('active','rejected')`, email);
  if (pending) throw new Refused(`A request for this email is already in progress (${pending.id}). Check its status instead.`, 'duplicate');
  const existing = one<{ id: string }>('select id from users where lower(email) = ?', email);

  return tx(() => {
    const id = nextRegId();
    const code = String(randomInt(100000, 1000000));
    run(`insert into registration_requests values (${Array(23).fill('?').join(',')})`,
      id, 'new', fullName, email, input.mobile?.trim() || null, input.organisation?.trim().slice(0, 120) || null,
      role, scopeType, input.scopeId, null, input.affiliationRef?.trim().toUpperCase() || null,
      'email_verification_pending', code, null, existing ? `existing_user:${existing.id}` : null, null, null, null, null, null, nowIso(), nowIso(), 'app');
    appendAudit({ actorUserId: null, actorLabel: `applicant:${email}`, actorRole: 'applicant', action: 'registration.submit', entityType: 'registration', entityId: id, after: { role, scope: `${scopeType}:${input.scopeId}`, duplicate: !!existing } });
    return { id, code };
  });
}

export function publicRequest(id: string, email: string): RegistrationRequest | null {
  return one<RegistrationRequest>('select * from registration_requests where id = ? and lower(email) = ?', id.trim().toUpperCase(), email.trim().toLowerCase());
}

export function verifyEmail(id: string, email: string, code: string): void {
  const r = publicRequest(id, email);
  if (!r) throw new Refused('No request with that reference and email.', 'input');
  if (r.status !== 'email_verification_pending') throw new Refused('Email is already verified for this request.', 'state');
  if (r.email_code !== code.trim()) throw new Refused('That code does not match.', 'input');
  tx(() => {
    run(`update registration_requests set status = 'institutional_verification_pending', updated_at = ? where id = ?`, nowIso(), r.id);
    appendAudit({ actorUserId: null, actorLabel: `applicant:${r.email}`, actorRole: 'applicant', action: 'registration.email_verified', entityType: 'registration', entityId: r.id });
  });
}

/**
 * Simulated institutional verification: a format check of the affiliation reference against a
 * fictional registry pattern. A real deployment would query the state HR system. On success the
 * request is routed to its designated verifier for approval.
 */
export function checkAffiliation(id: string, email: string, ref?: string): { passed: boolean; message: string } {
  const r = publicRequest(id, email);
  if (!r) throw new Refused('No request with that reference and email.', 'input');
  if (!['institutional_verification_pending', 'info_requested'].includes(r.status)) throw new Refused('This request is not waiting for affiliation verification.', 'state');
  const value = (ref ?? r.affiliation_ref ?? '').trim().toUpperCase();
  if (!AFFIL_RE.test(value)) {
    run('update registration_requests set affiliation_ref = ?, updated_at = ? where id = ?', value || null, nowIso(), r.id);
    return { passed: false, message: 'The reference was not found in the (simulated) staff registry. Format: EMP-DEPT-1234.' };
  }
  const verifier = verifierFor(r.requested_role, r.scope_type, r.scope_id);
  tx(() => {
    run(`update registration_requests set affiliation_ref = ?, status = 'approval_pending', verifier_user_id = ?, updated_at = ? where id = ?`, value, verifier, nowIso(), r.id);
    appendAudit({ actorUserId: null, actorLabel: `applicant:${r.email}`, actorRole: 'applicant', action: 'registration.affiliation_checked', entityType: 'registration', entityId: r.id, after: { simulated: true, verifier } });
    if (verifier) notify({ userId: verifier, kind: 'registration', title: `Account request ${r.id}: ${r.full_name}`, body: `${r.requested_role.toUpperCase()} for ${r.scope_id}. Awaiting your approval.`, entityType: 'registration', entityId: r.id, link: `/admin/accounts?tab=queue` });
  });
  return { passed: true, message: 'Affiliation matched the simulated registry. Your request is now with the designated verifier.' };
}

export function respondToInfo(id: string, email: string, response: string): void {
  const r = publicRequest(id, email);
  if (!r || r.status !== 'info_requested') throw new Refused('This request is not waiting for information from you.', 'state');
  const text = response.trim().slice(0, 1000);
  if (text.length < 5) throw new Refused('Add a short response.', 'input');
  tx(() => {
    run(`update registration_requests set status = 'approval_pending', info_request = ?, updated_at = ? where id = ?`, `${r.info_request ?? ''}\n— Applicant: ${text}`.trim(), nowIso(), r.id);
    appendAudit({ actorUserId: null, actorLabel: `applicant:${r.email}`, actorRole: 'applicant', action: 'registration.info_provided', entityType: 'registration', entityId: r.id, reason: text });
  });
}

// ---------------------------------------------------------------- officer side
export function canDecide(s: Session, r: RegistrationRequest): { allowed: boolean; reason: string } {
  const d = authorize(s, 'approve_accounts', { kind: 'role_grant', role: r.requested_role, type: r.scope_type, id: r.scope_id });
  if (!d.allowed) return d;
  if (r.email.toLowerCase() === s.email.toLowerCase() || r.target_user_id === s.user_id) return { allowed: false, reason: 'You cannot approve your own request.' };
  return { allowed: true, reason: '' };
}

/** Requests this officer may act on, or that are routed to them. */
export function verificationQueue(s: Session): RegistrationRequest[] {
  return all<RegistrationRequest>(`select * from registration_requests order by case status when 'approval_pending' then 0 when 'info_requested' then 1 when 'institutional_verification_pending' then 2 else 3 end, created_at desc`)
    .filter((r) => r.verifier_user_id === s.user_id || canDecide(s, r).allowed);
}

export function decideRegistration(s: Session, id: string, action: 'approve' | 'reject' | 'request_info' | 'reassign', reason: string, reassignTo?: string): string | null {
  const r = one<RegistrationRequest>('select * from registration_requests where id = ?', id);
  if (!r) throw new Refused('Unknown request.', 'input');
  const can = canDecide(s, r);
  if (!can.allowed) throw new Refused(can.reason, 'authz');
  const text = reason.trim().slice(0, 1000);

  if (action === 'reassign') {
    if (!reassignTo) throw new Refused('Choose who should verify instead.', 'input');
    const target = one<{ id: string; email: string }>(`select id, email from users where id = ? and status = 'active'`, reassignTo);
    if (!target) throw new Refused('That verifier is not an active user.', 'input');
    const ts = loadSession(target.id);
    if (!ts || !canDecide(ts, r).allowed) throw new Refused('That person does not hold authority to approve this request.', 'authz');
    tx(() => {
      run('update registration_requests set verifier_user_id = ?, updated_at = ? where id = ?', target.id, nowIso(), id);
      appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'registration.reassign_verifier', entityType: 'registration', entityId: id, before: { verifier: r.verifier_user_id }, after: { verifier: target.id }, reason: text || null });
      notify({ userId: target.id, kind: 'registration', title: `Account request ${id} reassigned to you`, body: `${r.full_name} — ${r.requested_role.toUpperCase()} ${r.scope_id}`, entityType: 'registration', entityId: id, link: '/admin/accounts?tab=queue' });
    });
    return null;
  }
  if (!['approval_pending', 'info_requested'].includes(r.status)) throw new Refused(`This request is “${REG_STATUS[r.status]?.label ?? r.status}”; it cannot be decided now.`, 'state');
  if (action !== 'approve' && text.length < 5) throw new Refused('A written reason is required.', 'input');

  if (action === 'reject' || action === 'request_info') {
    tx(() => {
      run(`update registration_requests set status = ?, ${action === 'reject' ? 'decision_reason' : 'info_request'} = ?, decided_by = ?, updated_at = ? where id = ?`,
        action === 'reject' ? 'rejected' : 'info_requested', text, s.user_id, nowIso(), id);
      appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: `registration.${action}`, entityType: 'registration', entityId: id, reason: text });
      if (r.target_user_id) notify({ userId: r.target_user_id, kind: 'registration', title: `Your request ${id}: ${action === 'reject' ? 'rejected' : 'more information needed'}`, body: text, entityType: 'registration', entityId: id, link: '/account' });
    });
    return null;
  }

  // approve
  if (r.request_type === 'change') {
    if (!r.target_user_id) throw new Refused('Change request has no target user.', 'input');
    tx(() => {
      reassignScope(s, r.target_user_id!, r.requested_role, r.scope_type, r.scope_id, `Approved change request ${id}${text ? `: ${text}` : ''}`);
      run(`update registration_requests set status = 'active', decided_by = ?, decision_reason = ?, updated_at = ? where id = ?`, s.user_id, text || null, nowIso(), id);
      appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'registration.approve_change', entityType: 'registration', entityId: id });
    });
    return r.target_user_id;
  }
  if (r.duplicate_of) throw new Refused('This email already belongs to an account. Reject the duplicate, or ask the person to request a change from their existing account.', 'duplicate');
  return tx(() => {
    const uid = nextIdFor('user', 'users', 'USR-', 5);
    const state = pathOf(r.scope_type, r.scope_id)?.state ?? 'STA-01';
    void state;
    run(`insert into users (id, full_name, email, preferred_language, preferred_channel, is_demo_account, status, created_at, provenance) values (?,?,?,?,?,?,?,?,?)`,
      uid, r.full_name, r.email, 'en', 'in_app', 0, 'active', nowIso(), 'app_registration');
    run(`insert into user_roles (id, user_id, role, scope_type, scope_id, granted_at, granted_by) values (?,?,?,?,?,?,?)`,
      `UR-${uid}`, uid, r.requested_role, r.scope_type, r.scope_id, nowIso(), s.user_id);
    const mgr = r.reporting_user_id ?? verifierFor(r.requested_role, r.scope_type, r.scope_id) ?? s.user_id;
    run(`insert into reporting_lines (user_id, manager_user_id, relation, source, updated_at, updated_by) values (?,?,?,?,?,?) on conflict(user_id) do update set manager_user_id = excluded.manager_user_id`,
      uid, mgr, 'designated_authority', 'registration', nowIso(), s.user_id);
    run(`insert into account_status_history values (?,?,?,?,?,?,?)`, statusHistoryId(), uid, null, 'active', s.user_id, `Approved registration ${id}`, nowIso());
    run(`update registration_requests set status = 'active', created_user_id = ?, decided_by = ?, decision_reason = ?, updated_at = ? where id = ?`, uid, s.user_id, text || null, nowIso(), id);
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'registration.approve', entityType: 'registration', entityId: id, after: { user_id: uid, role: r.requested_role, scope: `${r.scope_type}:${r.scope_id}` }, reason: text || null });
    return uid;
  });
}

/** A signed-in user asks for a role or scope change. Routed like a registration, minus the email step. */
export function requestChange(s: Session, role: string, scopeType: string, scopeId: string, reason: string): string {
  const rr = role as RoleCode;
  if (!REQUESTABLE.includes(rr)) throw new Refused('That role cannot be requested.', 'input');
  if (ROLE_LEVEL[rr] !== scopeType) throw new Refused(`A ${rr} is assigned at ${ROLE_LEVEL[rr]} level.`, 'input');
  if (!pathOf(scopeType as ScopeType, scopeId)) throw new Refused('Choose a valid place.', 'input');
  if (reason.trim().length < 8) throw new Refused('Explain the reason for the change.', 'input');
  if (one('select 1 x from registration_requests where target_user_id = ? and status not in (\'active\',\'rejected\')', s.user_id)) throw new Refused('You already have a change request in progress.', 'duplicate');
  const verifier = verifierFor(rr, scopeType as ScopeType, scopeId);
  return tx(() => {
    const id = nextRegId();
    run(`insert into registration_requests values (${Array(23).fill('?').join(',')})`,
      id, 'change', s.full_name, s.email, null, null, rr, scopeType, scopeId, null, null, 'approval_pending', '-', verifier, null, s.user_id, null, reason.trim().slice(0, 1000), null, null, nowIso(), nowIso(), 'app');
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'registration.request_change', entityType: 'registration', entityId: id, after: { role: rr, scope: `${scopeType}:${scopeId}` }, reason });
    if (verifier) notify({ userId: verifier, kind: 'registration', title: `Change request ${id}: ${s.full_name}`, body: `Wants ${rr.toUpperCase()} at ${scopeId}.`, entityType: 'registration', entityId: id, link: '/admin/accounts?tab=queue' });
    return id;
  });
}

export const rankLabel = (r: RoleCode) => ROLE_RANK[r];
