import 'server-only';
import type { DatabaseSync } from 'node:sqlite';
import { all, db, one, type Param } from './db';
import { LEARNING_GEN_KEY } from './ext/schema';

/**
 * Learning sums, kept between requests.
 *
 * The heaviest reads in the app add up the ~150,000 assessment rows: the hotspot engine, the
 * map, the learning trend. They depend only on assessment_results and schools, which change when
 * a round is imported, not on every page view. So the answer to each such query is kept and
 * reused until the data changes.
 *
 * "Until the data changes" is exact, not a timer: a trigger on both tables (ext/schema.ts,
 * perf-v1) bumps a counter in ext_meta on every insert, update or delete, and a kept answer is
 * used only while that counter, and the database connection, are the ones it was computed
 * under. A demo reset opens a new connection, so it starts from nothing.
 *
 * Safe across users because the key is the SQL text plus every parameter: scope predicates
 * (scope.ts) carry the reader's area as parameters, so two people share an entry only when they
 * would get exactly the same rows anyway.
 *
 * Use it only for queries that read assessment_results, schools and fixed reference tables
 * (competencies, rounds). Rows come back frozen: they are shared, so nobody may change them.
 */

interface Store { conn: DatabaseSync | null; gen: string | null; map: Map<string, readonly unknown[]>; hits: number; misses: number }
const store: Store = ((globalThis as unknown as { __kv_learn?: Store }).__kv_learn ??= { conn: null, gen: null, map: new Map(), hits: 0, misses: 0 });

/** Enough for every scope and filter combination a demo session reaches; oldest dropped first. */
const MAX_ENTRIES = 400;

export function learningRows<T>(sql: string, ...params: Param[]): readonly T[] {
  const conn = db();
  const gen = one<{ value: string }>('select value from ext_meta where key = ?', LEARNING_GEN_KEY)?.value ?? null;
  if (store.conn !== conn || store.gen !== gen || gen === null) {
    store.conn = conn; store.gen = gen; store.map.clear();
  }
  const key = JSON.stringify([sql, params.map((p) => (typeof p === 'bigint' ? `${p}n` : p))]);
  const hit = store.map.get(key);
  if (hit) {
    store.hits++;
    store.map.delete(key); store.map.set(key, hit); // most recently used goes to the back
    return hit as readonly T[];
  }
  store.misses++;
  const rows = Object.freeze(all<T>(sql, ...params).map((r) => Object.freeze(r)));
  // With no counter (the trigger missing) nothing could tell us the data changed: do not keep it.
  if (gen !== null) {
    store.map.set(key, rows);
    if (store.map.size > MAX_ENTRIES) store.map.delete(store.map.keys().next().value!);
  }
  return rows;
}

/** For tests: how often a kept answer was reused, and how many are kept. */
export const learningCacheStats = () => ({ hits: store.hits, misses: store.misses, size: store.map.size });
