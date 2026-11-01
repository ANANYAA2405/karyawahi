import { apiGet } from '@/lib/api/http';
import { hotspotsApi } from '@/lib/api/read';

/** Learning hotspot units one level below the key's area. Read-only; see lib/api/http.ts for the key, rate-limit and logging rules. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiGet(hotspotsApi);
