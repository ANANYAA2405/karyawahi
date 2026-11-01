import { getSession } from '@/lib/session';
import { cachedDraft, draft, isCopilotTask, mayUseCopilot } from '@/lib/ai/copilot';
import { rateLimited } from '@/lib/ai/client';
import { aiStatus } from '@/lib/ai/config';
import { isCrossSite } from '@/lib/http';

/**
 * Claude co-pilot drafts. GET returns the last draft for a record (never calls the model);
 * POST writes one, reusing the cached draft unless the record changed or `refresh` is set.
 *
 *   ?task=explain_finding|suggest_plan|summarise_discussion|explain_outcome|report_narrative&id=CASE-0184&lang=en
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ID = /^(CASE-\d{4}|RPT-\d{5})$/;

async function handle(req: Request, write: boolean) {
  // A draft costs a model call; another site must not be able to spend it for a signed-in visitor.
  if (write && isCrossSite(req)) return Response.json({ status: 'error', message: 'Refused.' }, { status: 403 });
  const s = await getSession();
  if (!s) return Response.json({ status: 'error', message: 'Sign in first.' }, { status: 401 });
  if (!mayUseCopilot(s)) return Response.json({ status: 'error', message: 'Claude is not available to your role.' }, { status: 403 });

  const url = new URL(req.url);
  const task = url.searchParams.get('task');
  const id = (url.searchParams.get('id') ?? '').toUpperCase();
  const lang = url.searchParams.get('lang') === 'hi' ? 'hi' : 'en';
  const refresh = url.searchParams.get('refresh') === '1';
  if (!isCopilotTask(task) || !ID.test(id) || (task === 'report_narrative') !== id.startsWith('RPT-')) {
    return Response.json({ status: 'error', message: 'Unknown draft request.' }, { status: 400 });
  }
  if (!aiStatus().configured) {
    return Response.json({ status: 'unconfigured', message: 'Claude is not connected: no API key is configured on the server.' });
  }

  const cached = cachedDraft(s, task, id, lang);
  if (!write) return Response.json(cached ?? { status: 'ok' });
  if (!refresh && cached && !cached.stale && cached.status === 'ok') return Response.json(cached);
  if (rateLimited(s.user_id, 'copilot', 12, 5 * 60_000)) {
    if (cached) return Response.json({ ...cached, message: 'Draft limit reached for a few minutes; showing the last draft.' });
    return Response.json({ status: 'error', message: 'Too many drafts in a short time. Try again in a few minutes.' }, { status: 429 });
  }
  return Response.json(await draft(s, task, id, lang));
}

export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
