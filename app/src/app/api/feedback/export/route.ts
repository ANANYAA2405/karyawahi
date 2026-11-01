import { getSession } from '@/lib/session';
import { Refused } from '@/lib/guard';
import { isCrossSite } from '@/lib/http';
import { feedbackCsv } from '@/lib/feedback';

/**
 * Everyone's feedback as a CSV file, for the user-testing analysis (docs/user-testing). The
 * state programme team and the demo administrator only; every export, and every refused
 * attempt, is written to the audit chain. Takes the same filters as /admin/feedback.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (isCrossSite(req)) return new Response('Refused.', { status: 403 });
  const s = await getSession();
  if (!s) return new Response('Sign in first.', { status: 401 });
  const sp = new URL(req.url).searchParams;
  const f = {
    kind: sp.get('kind') ?? undefined, tone: sp.get('tone') ?? undefined, tag: sp.get('tag') ?? undefined,
    role: sp.get('role') ?? undefined, page: sp.get('page') ?? undefined,
  };
  try {
    const csv = feedbackCsv(s, f);
    return new Response(`﻿${csv}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="karyavahi-feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof Refused) return new Response(e.message, { status: 403 });
    throw e;
  }
}
