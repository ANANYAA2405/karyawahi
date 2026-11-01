import { apiGet } from '@/lib/api/http';
import { getCaseApi } from '@/lib/api/read';

/** One case: finding summary, stage, owner role, plan, task counts, latest outcome check. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(getCaseApi);
