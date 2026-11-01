import 'server-only';
import { grantFor, ROLE_LABELS, type Action, type Grant } from '@domain/permissions';
import { isPlanApproval, isPlanDecision, rolesForTransition } from '@domain/lifecycle';
import { ROLE_PRECEDENCE, type RoleAssignment, type Session } from './session';
import type { CaseStatus, Lever, RoleCode } from '@domain/types';

/**
 * Permission checks. The matrix in src/domain/permissions.ts is the single source of truth and
 * is shared with the seed validator, so a role that cannot do something in the data cannot do
 * it in the UI either.
 *
 * A grant is coarse. Scope and ownership are always checked separately against the record —
 * holding 'evidence.verify' does not let a BEO verify evidence in another block, and it never
 * lets anyone verify evidence they submitted themselves.
 */

export class Refused extends Error {
  readonly code: string;
  constructor(message: string, code = 'refused') {
    super(message);
    this.name = 'Refused';
    this.code = code;
  }
}

/** The strongest grant any of the user's roles has for this action. */
export function grant(s: Session, action: Action): Grant {
  const ranked: Grant[] = ['yes', 'spot', 'propose', 'raise', 'own', 'no'];
  let best: Grant = 'no';
  for (const r of s.roles) {
    const g = grantFor(r.role, action);
    if (ranked.indexOf(g) < ranked.indexOf(best)) best = g;
  }
  return best;
}

export const may = (s: Session, action: Action): boolean => grant(s, action) !== 'no';

/** Throws unless the user has some grant for the action. */
export function require_(s: Session, action: Action, what = ''): void {
  if (!may(s, action)) {
    throw new Refused(
      `Your role (${s.roles.map((r) => r.role).join(', ')}) cannot ${action.replace('.', ' ')}${what ? ` ${what}` : ''}.`,
      'role',
    );
  }
}

/** The role this user would act with, same precedence as transition_case(). */
export function actingRole(s: Session): RoleCode {
  return [...s.roles].sort(
    (a, b) => ROLE_PRECEDENCE.indexOf(a.role) - ROLE_PRECEDENCE.indexOf(b.role),
  )[0].role;
}

/**
 * Who may decide a plan, by lever. Mirrors the check inside transition_case():
 *   block lever    → BEO or DEO
 *   district / PAB → DEO or state programme team
 */
export function canDecideLever(s: Session, lever: 'block' | 'district' | 'pab'): boolean {
  const roles = s.roles.map((r) => r.role);
  if (lever === 'block') return roles.includes('beo') || roles.includes('deo');
  return roles.includes('deo') || roles.includes('state_admin');
}

function leverMessage(s: Session, lever: Lever): string {
  return `A ${lever === 'block' ? 'block' : lever === 'district' ? 'district' : 'PAB'}-lever plan is decided by ` +
    `${lever === 'block' ? 'the BEO or DEO' : 'the DEO or the state programme team'}, not by ${actingRole(s)}.`;
}

export function requireDecideLever(s: Session, lever: 'block' | 'district' | 'pab'): void {
  if (!canDecideLever(s, lever)) throw new Refused(leverMessage(s, lever), 'lever');
}

/** Where a case sits. school_ids is the stored JSON array or the parsed list. */
export interface CaseArea {
  state_id: string; district_id: string; block_id: string; cluster_id: string;
  school_ids: string | readonly string[];
}

/** Whether this one role assignment's scope contains the case. */
export function roleCovers(r: Pick<RoleAssignment, 'scope_type' | 'scope_id'>, c: CaseArea): boolean {
  switch (r.scope_type) {
    case 'state': return r.scope_id === c.state_id;
    case 'district': return r.scope_id === c.district_id;
    case 'block': return r.scope_id === c.block_id;
    case 'cluster': return r.scope_id === c.cluster_id;
    case 'school': {
      let ids: readonly string[] = [];
      if (typeof c.school_ids === 'string') { try { ids = JSON.parse(c.school_ids); } catch { /* none */ } }
      else ids = c.school_ids;
      return ids.includes(r.scope_id);
    }
  }
}

export type MoveRefusalCode = 'lever' | 'role' | 'area' | 'own_submission';

/** Who may decide a plan under each lever, most junior first. The first is the role an approval
 *  names as required (approvals.required_role); the decision gate below accepts any of them. */
export const LEVER_DECIDERS: Readonly<Record<Lever, readonly RoleCode[]>> = {
  block: ['beo', 'deo'],
  district: ['deo', 'state_admin'],
  pab: ['deo', 'state_admin'],
};

/** The role an approval of a plan under this lever waits on. */
export const requiredRoleFor = (lever: Lever): RoleCode => LEVER_DECIDERS[lever]?.[0] ?? 'deo';

const roleNames = (roles: readonly RoleCode[]) =>
  roles.map((r) => (r === 'beo' ? 'BEO' : r === 'deo' ? 'DEO' : ROLE_LABELS[r].en.toLowerCase())).join(' or ');

/**
 * Whether this user may make this move on this case, and if not, why. The same answer serves
 * the write layer, which refuses, and the case page, which explains the greyed-out button.
 *
 * Authority has to come from one role assignment that both holds the move and covers the
 * case: a district officer with an acting cluster charge elsewhere cannot borrow the
 * district grant for that cluster. `submittedBy` is who submitted the pending plan, if any.
 */
export function moveRefusal(
  s: Session, c: CaseArea & { status: CaseStatus; lever: Lever }, to: CaseStatus, submittedBy: string | null,
): { code: MoveRefusalCode; message: string } | null {
  const from = c.status;
  let allowed = rolesForTransition(from, to);
  if (isPlanDecision(from, to)) {
    if (!canDecideLever(s, c.lever)) return { code: 'lever', message: leverMessage(s, c.lever) };
    const leverRoles = LEVER_DECIDERS[c.lever] ?? LEVER_DECIDERS.district;
    allowed = allowed.filter((r) => leverRoles.includes(r));
  }
  const held = s.roles.filter((r) => allowed.includes(r.role));
  if (held.length === 0) {
    return {
      code: 'role',
      message: allowed.length > 0
        ? `Moving a case from "${from}" to "${to}" is for the ${roleNames(allowed)}, not the ${roleNames([actingRole(s)])}.`
        : `Nobody may move a case from "${from}" to "${to}".`,
    };
  }
  if (!held.some((r) => roleCovers(r, c))) {
    return {
      code: 'area',
      message: `Your ${roleNames([...new Set(held.map((r) => r.role))])} role does not cover this case's area, so it gives no authority over it.`,
    };
  }
  if (isPlanApproval(from, to) && submittedBy !== null && submittedBy === s.user_id) {
    return {
      code: 'own_submission',
      message: `You submitted this plan, so another officer who decides ${c.lever === 'block' ? 'block' : c.lever === 'district' ? 'district' : 'PAB'}-lever plans must approve it. You can still send it back.`,
    };
  }
  return null;
}
