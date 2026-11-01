import { getSession } from '@/lib/session';
import { Refused } from '@/lib/guard';
import { isCrossSite } from '@/lib/http';
import { saveFeedback } from '@/lib/feedback';

/**
 * Saves one piece of feedback: a thumbs up or down on a Claude draft or chat answer, or the
 * "Feedback / सुझाव दें" form. JSON in, JSON out.
 *
 * The user comes from the session cookie, never from the body. Another site cannot make a
 * signed-in visitor's browser send it (isCrossSite, and a JSON body needs a CORS preflight that
 * this route never answers). Validation, the per-person rate limit and the audit row live in
 * lib/feedback.ts.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (isCrossSite(req)) return Response.json({ error: 'Refused.' }, { status: 403 });
  const s = await getSession();
  if (!s) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Send JSON.' }, { status: 415 });
  }
  const text = await req.text();
  if (text.length > 8_000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : null);
  try {
    const { id } = saveFeedback(s, {
      kind: str('kind') ?? '',
      rating: typeof body.rating === 'number' || typeof body.rating === 'string' ? body.rating : NaN,
      pagePath: str('pagePath') ?? '',
      target: str('target'),
      aiInteractionId: str('aiInteractionId'),
      tags: body.tags,
      trying: str('trying'),
      comment: str('comment'),
      language: str('language') ?? s.preferred_language,
    });
    return Response.json({ ok: true, id });
  } catch (e) {
    if (e instanceof Refused) {
      return Response.json({ error: e.message, code: e.code }, { status: e.code === 'rate' ? 429 : 400 });
    }
    console.error('[feedback]', e);
    return Response.json({ error: 'The feedback could not be saved.' }, { status: 500 });
  }
}
