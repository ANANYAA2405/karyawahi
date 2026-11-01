import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, one, run, tx } from '../db';
import { Refused, actingRole, may } from '../guard';
import { unitInScope } from '../scope';
import { appendAudit } from '../write';
import type { Session } from '../session';

/**
 * API keys for state dashboard systems (Vidya Samiksha Kendras).
 *
 * A key is `kv_demo_<id>_<secret>`. The id (12 hex characters) is public — it names the key in
 * the admin page and the call log, and it is how a request finds its row. The secret is 32
 * random bytes. Only the SHA-256 of the whole key is stored, and a presented key is accepted
 * when its hash matches the stored one under a constant-time comparison, so a copy of the
 * database cannot be replayed as a key and response time does not reveal how much of a guess
 * was right. The `kv_demo_` prefix says what the data is: this is a demo, nothing behind it is
 * real, and a key must never be mistaken for a production credential.
 *
 * A key reads one unit — the state, a district or a block — and everything inside it, as a
 * read-only auditor of that unit would (apiSession below). It cannot write anything.
 *
 * Times here are wall-clock, like sign-in sessions: moving the demo clock must not bring a
 * revoked key back, nor stretch or shrink the rate-limit window.
 */

export type ApiScopeType = 'state' | 'district' | 'block';
export const API_SCOPE_TYPES: readonly ApiScopeType[] = ['state', 'district', 'block'];

export interface ApiKey {
  id: string;
  name: string;
  scope_type: ApiScopeType;
  scope_id: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface ApiKeyListRow extends ApiKey {
  scope_name: string;
  created_by_name: string;
  calls_24h: number;
}

const TOKEN = /^kv_demo_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();
/** Compared against when no row matches, so an unknown id costs the same work as a wrong secret. */
const DUMMY = sha256('kv_demo_no_such_key');

export const RATE_LIMIT = 60;
export const RATE_WINDOW_S = 60;
/** Call-log rows older than this are pruned. */
const LOG_RETENTION_DAYS = 30;

const wallNow = (): string => new Date().toISOString();

const UNIT_TABLE: Record<ApiScopeType, string> = { state: 'states', district: 'districts', block: 'blocks' };

export function unitName(type: ApiScopeType, id: string): string | null {
  return one<{ name: string }>(`select name from ${UNIT_TABLE[type]} where id = ?`, id)?.name ?? null;
}

// ------------------------------------------------------------------ management (admin page)

function requireManage(s: Session, what: string, entityId: string): void {
  if (may(s, 'api.manage_keys')) return;
  appendAudit({
    actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s),
    action: `api_key.${what}`, entityType: 'api_key', entityId,
    reason: 'role cannot manage API keys', result: 'failure',
  });
  throw new Refused('Only the state programme team and the demo administrator can manage API keys.', 'role');
}

/** Every key, newest first, with the unit's name and how busy it has been. No hashes. */
export function listApiKeys(s: Session): ApiKeyListRow[] {
  if (!may(s, 'api.manage_keys')) return [];
  const since = new Date(Date.now() - 86_400_000).toISOString();
  return all<ApiKeyListRow>(
    `select k.id, k.name, k.scope_type, k.scope_id, k.created_by, k.created_at, k.last_used_at, k.revoked_at, k.revoked_by,
            coalesce(st.name, d.name, b.name, k.scope_id) scope_name,
            coalesce(u.full_name, k.created_by) created_by_name,
            (select count(*) from api_calls ac where ac.key_id = k.id and ac.ts > ?) calls_24h
       from api_keys k
       left join states st on k.scope_type = 'state' and st.id = k.scope_id
       left join districts d on k.scope_type = 'district' and d.id = k.scope_id
       left join blocks b on k.scope_type = 'block' and b.id = k.scope_id
       left join users u on u.id = k.created_by
      order by k.revoked_at is not null, k.created_at desc`,
    since,
  ).map((r) => ({ ...r, calls_24h: Number(r.calls_24h) }));
}

/**
 * Makes a key and returns it. This is the only time the full key exists outside the client
 * that receives it: the table keeps its hash.
 */
export function createApiKey(
  s: Session, input: { name: string; scopeType: string; scopeId: string },
): { id: string; token: string } {
  requireManage(s, 'create', input.scopeId || 'new');
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 80) throw new Refused('Give the key a name of 3 to 80 characters, such as the dashboard that will use it.', 'input');
  const scopeType = input.scopeType as ApiScopeType;
  if (!API_SCOPE_TYPES.includes(scopeType)) throw new Refused('A key reads the state, one district or one block.', 'input');
  const scopeId = input.scopeId.trim();
  if (!unitName(scopeType, scopeId)) throw new Refused('Choose an area from the list.', 'input');
  // The creator can only hand out an area inside their own (a state role covers everything).
  const inside = unitInScope(s, 't.scope_type', 't.scope_id');
  const covered = one<{ x: number }>(
    `select 1 x from (select ? as scope_type, ? as scope_id) t where ${inside.sql}`,
    scopeType, scopeId, ...inside.params,
  );
  if (!covered) throw new Refused('That area is outside your own.', 'area');

  const id = randomBytes(6).toString('hex');
  const token = `kv_demo_${id}_${randomBytes(32).toString('base64url')}`;
  tx(() => {
    run(
      `insert into api_keys (id, name, scope_type, scope_id, secret_hash, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
      id, name, scopeType, scopeId, sha256(token).toString('hex'), s.user_id, wallNow(),
    );
    appendAudit({
      actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s),
      action: 'api_key.create', entityType: 'api_key', entityId: id,
      after: { name, scope_type: scopeType, scope_id: scopeId },
    });
  });
  return { id, token };
}

/** Revokes a key. It stops working on its next request; the row stays for the record. */
export function revokeApiKey(s: Session, id: string): void {
  requireManage(s, 'revoke', id || 'unknown');
  const k = one<ApiKey>('select * from api_keys where id = ?', id);
  if (!k) throw new Refused('Unknown key.', 'input');
  if (k.revoked_at) throw new Refused('That key was already revoked.', 'input');
  tx(() => {
    run('update api_keys set revoked_at = ?, revoked_by = ? where id = ? and revoked_at is null', wallNow(), s.user_id, id);
    appendAudit({
      actorUserId: s.user_id, actorLabel: s.full_name, actorRole: actingRole(s),
      action: 'api_key.revoke', entityType: 'api_key', entityId: id,
      before: { name: k.name, scope_type: k.scope_type, scope_id: k.scope_id },
    });
  });
}

// ------------------------------------------------------------------ authentication (API routes)

/** The bearer token from an Authorization header, or null. Cookies are never consulted. */
export function bearerToken(header: string | null): string | null {
  if (!header || header.length > 200) return null;
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return m ? m[1] : null;
}

/** The live key a token belongs to, or null when it is malformed, unknown, wrong or revoked. */
export function keyForToken(token: string | null): ApiKey | null {
  const m = token ? TOKEN.exec(token) : null;
  const row = m ? one<ApiKey & { secret_hash: string }>('select * from api_keys where id = ?', m[1]) : null;
  const presented = sha256(token ?? '');
  const stored = row && /^[0-9a-f]{64}$/.test(row.secret_hash) ? Buffer.from(row.secret_hash, 'hex') : DUMMY;
  const same = timingSafeEqual(presented, stored);
  if (!row || !same || row.revoked_at) return null;
  const { secret_hash: _drop, ...key } = row;
  void _drop;
  return key;
}

/**
 * The read-only identity a key reads with. It holds one role, auditor — the role that may read
 * and never write — scoped to the key's unit, so every read goes through exactly the predicates
 * in scope.ts that an auditor of that unit gets. Its user id belongs to no user and owns no
 * task, so the "my own task" arms of those predicates never match: what it sees is the area.
 */
export function apiSession(k: ApiKey): Session {
  return {
    user_id: `api-key:${k.id}`,
    full_name: k.name,
    email: '',
    preferred_language: 'en',
    roles: [{ role: 'auditor', scope_type: k.scope_type, scope_id: k.scope_id }],
    role: 'auditor',
    scope_type: k.scope_type,
    scope_id: k.scope_id,
  };
}

/**
 * Whether this key may make another request now. Counted from the call log over a sliding
 * minute; requests already refused with 429 do not count, so a client that backs off recovers.
 * Failed authentications are logged without a key id, so nobody can use up a key's allowance
 * by sending its id with a wrong secret.
 */
export function rateCheck(keyId: string, nowMs = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const since = new Date(nowMs - RATE_WINDOW_S * 1000).toISOString();
  const rows = all<{ ts: string }>(
    `select ts from api_calls where key_id = ? and ts > ? and status <> 429 order by ts asc limit ?`,
    keyId, since, RATE_LIMIT,
  );
  if (rows.length < RATE_LIMIT) return { ok: true, remaining: RATE_LIMIT - rows.length - 1 };
  const freeAt = Date.parse(rows[0].ts) + RATE_WINDOW_S * 1000;
  return { ok: false, retryAfter: Math.max(1, Math.ceil((freeAt - nowMs) / 1000)) };
}

type PruneState = { at: number };
const prune: PruneState = ((globalThis as unknown as { __kv_api_prune?: PruneState }).__kv_api_prune ??= { at: 0 });

/** One row per request: key, method, path (no query string), status, time, duration. */
export function logCall(keyId: string | null, method: string, path: string, status: number, ms: number): void {
  const ts = wallNow();
  run(
    'insert into api_calls (key_id, method, path, status, ts, ms) values (?, ?, ?, ?, ?, ?)',
    keyId, method.slice(0, 8), path.slice(0, 200), status, ts, Math.max(0, Math.round(ms)),
  );
  if (keyId && status !== 401) run('update api_keys set last_used_at = ? where id = ?', ts, keyId);
  if (Date.now() - prune.at > 60_000) {
    prune.at = Date.now();
    run('delete from api_calls where ts < ?', new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000).toISOString());
  }
}

/** The latest calls, for the admin page. */
export function recentCalls(s: Session, limit = 25): { key_id: string | null; method: string; path: string; status: number; ts: string; ms: number }[] {
  if (!may(s, 'api.manage_keys')) return [];
  return all('select key_id, method, path, status, ts, ms from api_calls order by id desc limit ?', limit);
}
