import { publicJson } from '@/lib/api/http';
import { openApiDocument } from '@/lib/api/openapi';

/** The OpenAPI 3.1 description of /api/v1. Public: it describes the API, it holds no data. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request) {
  return publicJson(openApiDocument(new URL(req.url).origin));
}
