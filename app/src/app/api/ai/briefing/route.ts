import { getSession } from '@/lib/session';
import { cachedBriefing, generateBriefing, mayReadBriefing, BRIEFING_REFUSAL } from '@/lib/ai/briefing';
import { rateLimited } from '@/lib/ai/client';
import { aiStatus } from '@/lib/ai/config';

/**
 * Dashboard briefing. GET returns the cached briefing if the underlying summary has not
 * changed, and generates one only when there is none or it is stale. POST forces a refresh.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(force: boolean) {
  const s = await getSession();
  if (!s) return Response.json({ status: 'error', message: 'Sign in first.' }, { status: 401 });
  // ai.executive_briefing, not ai.assistant: a block officer may chat with the assistant but does
  // not get the executive briefing (see mayReadBriefing).
  if (!mayReadBriefing(s)) return Response.json({ status: 'error', message: BRIEFING_REFUSAL }, { status: 403 });
  if (!aiStatus().configured) {
    return Response.json({ status: 'unconfigured', message: 'No model API key is configured on the server, so no briefing can be generated. Every figure on this page is still computed from the records.' });
  }
  const cached = cachedBriefing(s);
  if (!force && cached && !cached.stale && cached.status === 'ok') return Response.json(cached);
  if (rateLimited(s.user_id, 'briefing', 6, 10 * 60_000)) {
    if (cached) return Response.json({ ...cached, message: 'Refresh limit reached; showing the last briefing.' });
    return Response.json({ status: 'error', message: 'Too many briefing requests. Try again in a few minutes.' }, { status: 429 });
  }
  return Response.json(await generateBriefing(s));
}

export const GET = () => handle(false);
export const POST = () => handle(true);
