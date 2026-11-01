import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSession, loadSession, sessionCookieOptions } from '@/lib/session';
import { one } from '@/lib/db';
import { homeFor } from '@/lib/nav';
import { isCrossSite, isHttps } from '@/lib/http';

/**
 * Demo sign-in. Takes either a user id (the demo persona picker) or an email address (the
 * sign-in form) and checks it resolves to an active user with at least one role. There is no
 * password: every account is fictional and the data carries no personal information. Authority
 * still comes from the user's role rows, never from this cookie, so a signed-in BEO cannot see
 * another block's cases no matter what the cookie says. The cookie holds a session token, not
 * the user id (see session.ts), and a form posted from another site is refused, so no page
 * elsewhere can sign a visitor in to an account of its choosing.
 *
 * Against Supabase this handler is replaced by signInWithPassword; nothing downstream changes.
 */
export async function POST(req: Request) {
  if (isCrossSite(req)) return new NextResponse('Cross-site sign-in refused.', { status: 403 });
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  let userId = String(form.get('user_id') ?? '').trim();
  const from = String(form.get('from') ?? '') === 'demo' ? '/demo' : '/login';

  if (!userId && email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
      return back(req, from, 'invalid-email', email);
    }
    userId = one<{ id: string }>('select id from users where lower(email) = ? limit 1', email)?.id ?? '';
    if (!userId) return back(req, from, 'unknown-email', email);
  }

  const session = userId ? loadSession(userId) : null;
  if (!session) return back(req, from, 'unknown-account', email);

  const res = NextResponse.redirect(new URL(homeFor(session), req.url), 303);
  const token = createSession(session.user_id, req.headers.get('user-agent'));
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isHttps(req.headers, req.url)));
  return res;
}

function back(req: Request, path: string, error: string, email: string) {
  const url = new URL(path, req.url);
  url.searchParams.set('error', error);
  if (email) url.searchParams.set('email', email);
  return NextResponse.redirect(url, 303);
}
