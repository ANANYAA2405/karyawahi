import 'server-only';
import { one } from './db';
import { loadSession, type Session } from './session';

/**
 * Who may sign in to this passwordless demo.
 *
 * There is no password, so typing an address is the whole sign-in. That is only acceptable for
 * an address nobody can own: every seeded account uses demo.karyavahi.test, under the .test
 * top-level domain that is reserved for testing (RFC 2606 / RFC 6761) and never delegated, so no
 * real person's mailbox is behind it. The rule:
 *
 *   an active account, with at least one role, whose email is on demo.karyavahi.test.
 *
 * Not "is_demo_account = 1": that flag marks the seven featured personas on /demo, and the
 * walkthroughs and the route crawl rightly sign in other fictional officers and headmasters.
 * What must never happen is a passwordless sign-in to an address that could be a real person's,
 * for example one typed into the registration form. Registration therefore accepts only demo
 * addresses too (onboarding.ts), so an approved request can always sign in.
 *
 * A refused address gets the same answer as an unknown one, so the form cannot be used to find
 * out which real addresses have accounts. Against Supabase this is replaced by real sign-in.
 */
export const DEMO_EMAIL_DOMAIN = 'demo.karyavahi.test';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isDemoAddress = (email: string | null | undefined): boolean =>
  !!email && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

export type SignInError = 'invalid-email' | 'unknown-email' | 'unknown-account';

/** The session to start for this sign-in attempt, or why not. Takes an email (the sign-in form)
 *  or a user id (the persona picker); the same rule applies to both. */
export function resolveSignIn(input: { email?: string; userId?: string }): { session: Session } | { error: SignInError } {
  const email = (input.email ?? '').trim().toLowerCase();
  let userId = (input.userId ?? '').trim();

  if (!userId) {
    if (!email) return { error: 'unknown-account' };
    if (!EMAIL_RE.test(email) || email.length > 200) return { error: 'invalid-email' };
    if (!isDemoAddress(email)) return { error: 'unknown-email' };
    userId = one<{ id: string }>('select id from users where lower(email) = ? limit 1', email)?.id ?? '';
    if (!userId) return { error: 'unknown-email' };
  }

  const u = one<{ email: string | null }>('select email from users where id = ?', userId);
  if (!u || !isDemoAddress(u.email)) return { error: 'unknown-account' };
  const session = loadSession(userId);
  return session ? { session } : { error: 'unknown-account' };
}
