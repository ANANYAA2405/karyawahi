import 'server-only';
import { DISCLAIMER } from '@domain/catalog';
import { nowIso } from '../clock';
import type { Session } from '../session';
import {
  apiSession, bearerToken, keyForToken, logCall, rateCheck, unitName, RATE_LIMIT, type ApiKey,
} from './keys';

/**
 * The one wrapper every /api/v1 route goes through, in this order:
 *
 *   Authorization: Bearer <key> → the key is live (else 401, the same for missing, malformed,
 *   unknown, wrong and revoked, with no hint which) → the key is within its rate limit (else
 *   429 with Retry-After) → the handler runs with the key's read-only session → the call is
 *   logged and the key's last-used time moves.
 *
 * Cookies are never read, so a browser signed in to the app cannot use these routes without a
 * key. No CORS headers are sent: a page on another site cannot read a response, and cannot even
 * send the Authorization header without a preflight that these routes do not answer. A VSK
 * dashboard calls this API from its own server, never from a browser, so CORS stays off.
 *
 * From the key check to the log write everything is synchronous, so in this single-process
 * server two requests cannot both slip under the rate limit between its count and its insert.
 */

export const API_VERSION = 'v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const notFound = (what = 'record') => new ApiError(404, 'not_found', `No such ${what}.`);

const demo = () => ({ demo_data: true as const, disclaimer: DISCLAIMER });

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Authorization',
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

export interface ApiContext {
  key: ApiKey;
  session: Session;
  url: URL;
  params: Record<string, string>;
}

type Handler = (ctx: ApiContext) => Record<string, unknown>;
type RouteCtx = { params: Promise<Record<string, string>> };

export function apiGet(handler: Handler) {
  return async function GET(req: Request, route: RouteCtx): Promise<Response> {
    const started = Date.now();
    const url = new URL(req.url);
    const params = (route?.params ? await route.params : {}) ?? {};
    const path = url.pathname;

    const key = keyForToken(bearerToken(req.headers.get('authorization')));
    if (!key) {
      logCall(null, req.method, path, 401, Date.now() - started);
      return json(401, { ...demo(), error: { code: 'unauthorized', message: 'A valid API key is required.' } },
        { 'www-authenticate': 'Bearer realm="karyavahi"' });
    }

    const rate = rateCheck(key.id, started);
    if (!rate.ok) {
      logCall(key.id, req.method, path, 429, Date.now() - started);
      return json(429, { ...demo(), error: { code: 'rate_limited', message: `At most ${RATE_LIMIT} requests a minute per key.` } }, {
        'retry-after': String(rate.retryAfter),
        'x-ratelimit-limit': String(RATE_LIMIT),
        'x-ratelimit-remaining': '0',
      });
    }

    let status = 200;
    let body: Record<string, unknown>;
    try {
      const data = handler({ key, session: apiSession(key), url, params });
      body = {
        ...demo(),
        api_version: API_VERSION,
        scope: { type: key.scope_type, id: key.scope_id, name: unitName(key.scope_type, key.scope_id) },
        generated_at: new Date().toISOString(),
        as_of: nowIso(),
        ...data,
      };
    } catch (e) {
      if (e instanceof ApiError) {
        status = e.status;
        body = { ...demo(), error: { code: e.code, message: e.message } };
      } else {
        status = 500;
        console.error('[api/v1]', path, e);
        body = { ...demo(), error: { code: 'server_error', message: 'Something went wrong on our side.' } };
      }
    }
    logCall(key.id, req.method, path, status, Date.now() - started);
    return json(status, body, {
      'x-ratelimit-limit': String(RATE_LIMIT),
      'x-ratelimit-remaining': String(rate.remaining),
    });
  };
}

/** For the public OpenAPI document: same headers and disclaimer, no key, not logged. */
export function publicJson(body: Record<string, unknown>): Response {
  return json(200, body, { 'cache-control': 'public, max-age=300' });
}

// ------------------------------------------------------------------ query parsing

export function listParam<T extends string>(url: URL, name: string, allowed: readonly T[]): T[] | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const bad = values.filter((v) => !allowed.includes(v as T));
  if (bad.length) throw badRequest(`${name} must be one or more of: ${allowed.join(', ')}.`);
  return values as T[];
}

export function idParam(url: URL, name: string, shape: RegExp): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  if (!shape.test(raw)) throw badRequest(`${name} is not a valid id.`);
  return raw;
}

export function boolParam(url: URL, name: string): boolean | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw badRequest(`${name} must be true or false.`);
}

export function limitParam(url: URL, def = 50, max = 200): number {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw === '') return def;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw badRequest(`limit must be a whole number from 1 to ${max}.`);
  return Number(raw);
}

/** An ISO date (2026-10-01) or date-time (2026-10-01T06:30:00Z), returned as a full ISO string. */
export function dateParam(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) {
    throw badRequest(`${name} must be an ISO 8601 date or date-time, such as 2026-10-01 or 2026-10-01T06:30:00Z.`);
  }
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} is not a real date.`);
  return d.toISOString();
}

/** Opaque keyset cursors: the sort value and id of the last row on the previous page. */
export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url');
}

export function decodeCursor(url: URL): { sort: string; id: string } | undefined {
  const raw = url.searchParams.get('cursor');
  if (raw === null || raw === '') return undefined;
  try {
    if (raw.length > 200) throw new Error('long');
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0].length <= 40 && v[1].length <= 40) {
      return { sort: v[0], id: v[1] };
    }
  } catch { /* fall through */ }
  throw badRequest('cursor is not one this API issued. Start again without it.');
}
