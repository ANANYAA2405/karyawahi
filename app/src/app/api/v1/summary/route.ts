import { apiGet } from '@/lib/api/http';
import { summaryApi } from '@/lib/api/read';

/** Headline figures for the key's area. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(summaryApi);
