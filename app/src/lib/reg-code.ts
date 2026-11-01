import 'server-only';
import { cookies, headers } from 'next/headers';
import { isHttps } from './http';

/**
 * The demo's stand-in for "we emailed you a code".
 *
 * No email is sent in the demo, so the code is shown on screen, but only to the browser that
 * submitted the request. It travels in a short-lived, http-only cookie scoped to /register, not
 * in the address: a URL is kept in browser history, server and proxy logs and Referer headers,
 * and a link carrying the code lets whoever holds it verify the email for someone else.
 *
 * The cookie holds the request id and the code together, so it shows the code only on the
 * status page of the request it was issued for. Knowing a request id is not enough to see its
 * code: forging the cookie means already knowing the code.
 */
export const REG_CODE_COOKIE = 'kv_reg_code';
const MAX_AGE_S = 30 * 60;

export async function rememberDemoCode(requestId: string, code: string): Promise<void> {
  const secure = isHttps(await headers());
  (await cookies()).set(REG_CODE_COOKIE, `${requestId}.${code}`, {
    httpOnly: true, secure, sameSite: 'lax', path: '/register', maxAge: MAX_AGE_S,
  });
}

/** The code issued to this browser for this request, or null. */
export async function demoCodeFor(requestId: string): Promise<string | null> {
  const raw = (await cookies()).get(REG_CODE_COOKIE)?.value ?? '';
  const dot = raw.lastIndexOf('.');
  if (dot < 0 || raw.slice(0, dot) !== requestId) return null;
  const code = raw.slice(dot + 1);
  return /^\d{6}$/.test(code) ? code : null;
}

export async function forgetDemoCode(): Promise<void> {
  (await cookies()).delete({ name: REG_CODE_COOKIE, path: '/register' });
}

/**
 * Which request this browser is following, and the email it was made with.
 *
 * The status page needs the reference and the email together (there is no account yet), but the
 * email does not belong in the address for the same reasons the code does: history, logs and
 * Referer headers. It rides in an http-only cookie scoped to /register instead, set when the
 * request is made or looked up, so the address carries only the reference.
 */
export const REG_REQ_COOKIE = 'kv_reg_req';
const REQ_MAX_AGE_S = 7 * 24 * 60 * 60;

export async function rememberRequest(requestId: string, email: string): Promise<void> {
  const secure = isHttps(await headers());
  const value = Buffer.from(JSON.stringify({ id: requestId, email }), 'utf8').toString('base64url');
  (await cookies()).set(REG_REQ_COOKIE, value, {
    httpOnly: true, secure, sameSite: 'lax', path: '/register', maxAge: REQ_MAX_AGE_S,
  });
}

/** The email this browser used for this request, or null. */
export async function requestEmailFor(requestId: string): Promise<string | null> {
  const raw = (await cookies()).get(REG_REQ_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { id?: unknown; email?: unknown };
    return v.id === requestId && typeof v.email === 'string' ? v.email : null;
  } catch {
    return null;
  }
}
