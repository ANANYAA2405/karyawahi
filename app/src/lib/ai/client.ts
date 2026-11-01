import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { aiStatus } from './config';
import { one, run, nextIdFor } from '../db';
import { nowIso } from '../clock';
import type { Session } from '../session';
import { actingRole } from '../guard';

/** Provider client and the AI activity log. Keys never leave this module's process. */

type Holder = { client: Anthropic | null; key: string | null };
const holder: Holder = ((globalThis as unknown as { __kv_ai?: Holder }).__kv_ai ??= { client: null, key: null });

export function aiClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (!holder.client || holder.key !== key) {
    holder.client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
    holder.key = key;
  }
  return holder.client;
}

/** Server-side refusal fallback, on by default for the default model (see config). */
export function fallbackParams(): { betas: string[]; fallbacks?: 'default' } {
  const st = aiStatus();
  return st.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : { betas: [] };
}

// ---------------------------------------------------------------- activity log
/**
 * One row per AI interaction in ai_interactions — the same table the seed's simulated drafts
 * live in. Stores metadata (tools, cited ids, token counts, status) and a short excerpt of the
 * question, not whole conversations.
 */
export function logAi(s: Session, o: {
  kind: string; model: string; question: string; tools: string[]; referencedIds: string[];
  status: 'ok' | 'error' | 'refused' | 'unconfigured' | 'aborted' | 'rate_limited';
  usage?: { input: number; output: number; cacheRead?: number } | null; requestId?: string | null; error?: string | null; stopReason?: string | null;
}): string {
  const id = nextIdFor('ai', 'ai_interactions', 'AII-', 6);
  const output = [
    o.tools.length ? `tools: ${[...new Set(o.tools)].join(', ')}` : 'no tools',
    o.usage ? `tokens in ${o.usage.input}${o.usage.cacheRead ? ` (cached ${o.usage.cacheRead})` : ''} / out ${o.usage.output}` : '',
    o.stopReason ? `stop: ${o.stopReason}` : '',
    o.requestId ? `request ${o.requestId}` : '',
    o.error ? `error: ${o.error.slice(0, 160)}` : '',
  ].filter(Boolean).join(' · ');
  run(
    `insert into ai_interactions (id, model, template_version, ts, user_id, role, kind, referenced_ids, input_summary, output_summary, status, auditor_verdict, reviewer_decision)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, o.model, 'live-tools-v1', nowIso(), s.user_id, actingRole(s), o.kind,
    JSON.stringify([...new Set(o.referencedIds)].slice(0, 60)), o.question.slice(0, 160), output, o.status, null, null,
  );
  return id;
}

// ---------------------------------------------------------------- rate limit
type Bucket = Map<string, number[]>;
const buckets: Bucket = ((globalThis as unknown as { __kv_rl?: Bucket }).__kv_rl ??= new Map());

/** A simple per-user sliding window: `limit` requests per `windowMs`. */
export function rateLimited(userId: string, kind: string, limit = 20, windowMs = 5 * 60_000): boolean {
  const k = `${kind}:${userId}`;
  const now = Date.now();
  const hits = (buckets.get(k) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { buckets.set(k, hits); return true; }
  hits.push(now);
  buckets.set(k, hits);
  return false;
}
