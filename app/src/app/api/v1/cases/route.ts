import { apiGet } from '@/lib/api/http';
import { listCasesApi } from '@/lib/api/read';

/** Cases in the key's area, oldest change first, with cursor pagination. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(listCasesApi);
