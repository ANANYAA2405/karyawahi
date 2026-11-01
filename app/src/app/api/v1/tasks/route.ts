import { apiGet } from '@/lib/api/http';
import { listTasksApi } from '@/lib/api/read';

/** Field tasks in the key's area, by due date, with cursor pagination. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(listTasksApi);
