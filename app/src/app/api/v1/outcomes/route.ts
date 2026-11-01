import { apiGet } from '@/lib/api/http';
import { listOutcomesApi } from '@/lib/api/read';

/** Outcome checks (difference-in-differences) in the key's area. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(listOutcomesApi);
