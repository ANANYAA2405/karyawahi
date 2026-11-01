import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { all, one, run } from './db';
import type { Language, RoleCode, ScopeType } from '@domain/types';

/**
 * Demo sign-in. There are no passwords because every account and every record is fictional
 * (see the demo banner), but the cookie is not the identity: it carries a random token that
 * maps to a row in `sessions`, which expires and can be revoked. A cookie holding a user id,
 * or any guessed value, resolves to nobody.
 * In Supabase this is replaced by auth.uid() → users.auth_user_id; nothing else changes,
 * because authority is decided by the role rows below, never by the cookie.
 */

export const SESSION_COOKIE = 'kv_session';
export const LANG_COOKIE = 'kv_lang';

/** How long a sign-in lasts. Measured on the wall clock, not the demo clock: moving the demo
 *  date must not keep a session alive or end it early. */
export const SESSION_MAX_AGE_S = 60 * 60 * 12;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_MAX_AGE_S };
}

/** Opens a session for a user the caller has already checked, and returns the cookie token. */
export function createSession(userId: string, userAgent?: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run('delete from sessions where expires_at < ?', new Date(now).toISOString());
  run(
    'insert into sessions (id, user_id, created_at, expires_at, user_agent) values (?, ?, ?, ?, ?)',
    tokenHash(token), userId, new Date(now).toISOString(),
    new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(), userAgent?.slice(0, 200) || null,
  );
  return token;
}

/** The user a cookie token belongs to, or null when it is malformed, unknown, expired or revoked. */
export function userIdForToken(token: string | undefined | null): string | null {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  return one<{ user_id: string }>(
    'select user_id from sessions where id = ? and revoked_at is null and expires_at > ?',
    tokenHash(token), new Date().toISOString(),
  )?.user_id ?? null;
}

export function revokeSession(token: string | undefined | null): void {
  if (!token || !TOKEN_SHAPE.test(token)) return;
  run('update sessions set revoked_at = ? where id = ? and revoked_at is null', new Date().toISOString(), tokenHash(token));
}

export interface RoleAssignment {
  role: RoleCode;
  scope_type: ScopeType;
  scope_id: string;
  /** Set when this assignment comes from an active acting arrangement (delegations table). */
  delegated?: { id: string; from_user_id: string; ends_on: string };
}

export interface Session {
  user_id: string;
  full_name: string;
  email: string;
  preferred_language: Language;
  roles: RoleAssignment[];
  /** The strongest role, using the same precedence as transition_case() in sql/schema.sql. */
  role: RoleCode;
  scope_type: ScopeType;
  scope_id: string;
}

/** Same order as the `array_position(...)` call in transition_case(). */
export const ROLE_PRECEDENCE: RoleCode[] = [
  'state_admin', 'deo', 'beo', 'brc', 'crc', 'headmaster', 'auditor', 'demo_admin',
];

export function strongestRole(roles: RoleAssignment[]): RoleAssignment | null {
  roles = roles.filter((r) => !r.delegated);
  if (roles.length === 0) return null;
  return [...roles].sort(
    (a, b) => ROLE_PRECEDENCE.indexOf(a.role) - ROLE_PRECEDENCE.indexOf(b.role),
  )[0];
}

export function loadSession(userId: string): Session | null {
  const u = one<{
    id: string; full_name: string; email: string; preferred_language: Language; status: string;
  }>('select id, full_name, email, preferred_language, status from users where id = ?', userId);
  if (!u || u.status !== 'active') return null;

  const roles = all<RoleAssignment>(
    'select role, scope_type, scope_id from user_roles where user_id = ?', userId,
  );
  const strongest = strongestRole(roles);
  if (!strongest) return null;

  // Acting arrangements in force on the demo clock's date extend scope; they never become the
  // user's primary role, and they lapse on their end date without anyone touching them.
  const clockIso = one<{ value: string }>(`select value from app_state where key = 'demo_clock'`)?.value;
  const onDate = new Date(new Date(clockIso ?? '2026-10-24T06:30:00.000Z').getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const acting = all<{ id: string; from_user_id: string; role: RoleCode; scope_type: ScopeType; scope_id: string; ends_on: string }>(
    `select id, from_user_id, role, scope_type, scope_id, ends_on from delegations
      where to_user_id = ? and revoked_at is null and starts_on <= ? and ends_on >= ?`, userId, onDate, onDate,
  );
  for (const d of acting) roles.push({ role: d.role, scope_type: d.scope_type, scope_id: d.scope_id, delegated: { id: d.id, from_user_id: d.from_user_id, ends_on: d.ends_on } });

  return {
    user_id: u.id,
    full_name: u.full_name,
    email: u.email,
    preferred_language: u.preferred_language,
    roles,
    role: strongest.role,
    scope_type: strongest.scope_type,
    scope_id: strongest.scope_id,
  };
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = userIdForToken(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return loadSession(userId);
}

/** For pages that must have a signed-in user. Layouts redirect before this ever throws. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error('not signed in');
  return s;
}

export async function getLanguage(): Promise<Language> {
  const jar = await cookies();
  const fromCookie = jar.get(LANG_COOKIE)?.value;
  if (fromCookie === 'hi' || fromCookie === 'en') return fromCookie;
  const s = await getSession();
  return s?.preferred_language ?? 'en';
}
