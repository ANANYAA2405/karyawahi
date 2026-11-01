import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, revokeSession } from '@/lib/session';
import { isCrossSite } from '@/lib/http';

/** Ends the session on the server too, so a copied cookie stops working once you sign out. */
export async function POST(req: Request) {
  if (isCrossSite(req)) return new NextResponse('Cross-site sign-out refused.', { status: 403 });
  const jar = await cookies();
  revokeSession(jar.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
