import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { all, one } from './db';
import { casesPred } from './scope';
import type { Session } from './session';

/**
 * Search the evidence library: the intervention cards and the cases already tried and checked.
 *
 * The proposal's "delivery-aware evidence library + retrieval" asks for two things: find the
 * intervention whose evidence and delivery conditions fit a problem, and cite what happened
 * last time here. The library is small (a few dozen cards and the cases with an outcome check),
 * so this is full-text search with BM25 ranking (SQLite FTS5) over an index built in memory,
 * not vector search; it is exact, explainable and needs no embedding service. The index is
 * rebuilt when the cards or the checked cases change.
 *
 * Cards are public to every officer. Past cases are filtered to the reader's own area with the
 * same predicate every case list uses, so search never shows a case its reader could not open.
 */

export interface LibraryHit {
  kind: 'intervention' | 'case';
  id: string;
  title: string;
  /** The matching passage, with the matched words wrapped in [ ]. */
  snippet: string;
  /** Interventions: the lever (block, district, PAB). Cases: the intervention used. */
  detail: string;
  /** Cases only: what the outcome check showed. */
  outcome?: { category: string; did_pp: number | null } | null;
}

interface Index { db: DatabaseSync; signature: string }
const holder = ((globalThis as unknown as { __kv_lib?: { index: Index | null } }).__kv_lib ??= { index: null });

const j = <T,>(v: string | null, d: T): T => { try { return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const text = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map(text).join(' ') : v && typeof v === 'object' ? Object.values(v).map(text).join(' ') : v == null ? '' : String(v);

function signature(): string {
  const a = one<{ n: number; v: string | null }>('select count(*) n, max(version) v from interventions');
  const b = one<{ n: number; t: string | null }>('select count(*) n, max(evaluated_at) t from outcome_evaluations');
  return `${a?.n}:${a?.v}:${b?.n}:${b?.t}`;
}

function build(sig: string): Index {
  const db = new DatabaseSync(':memory:');
  db.exec(`create virtual table lib using fts5(kind unindexed, id unindexed, title, body, detail unindexed, tokenize = 'porter unicode61 remove_diacritics 2')`);
  const ins = db.prepare('insert into lib (kind, id, title, body, detail) values (?, ?, ?, ?, ?)');

  for (const iv of all<{ id: string; name: string; category: string; domains: string; description: string; evidence: string; delivery_conditions: string; limitations: string; lever: string; cost_basis: string; success_metric: string }>(
    'select id, name, category, domains, description, evidence, delivery_conditions, limitations, lever, cost_basis, success_metric from interventions',
  )) {
    const body = [iv.category, text(j(iv.domains, iv.domains)), iv.description, text(j(iv.evidence, iv.evidence)),
      `Delivery conditions: ${text(j(iv.delivery_conditions, iv.delivery_conditions))}`, `Limitations: ${text(j(iv.limitations, iv.limitations))}`,
      text(j(iv.cost_basis, iv.cost_basis)), text(j(iv.success_metric, iv.success_metric))].join('\n');
    ins.run('intervention', iv.id, iv.name, body, iv.lever);
  }

  // Every case with an outcome check: what was tried, where, and what the check showed.
  for (const c of all<{ id: string; title: string; status: string; iv: string | null; iv_name: string | null; rationale: string | null; conclusion: string | null; category: string; did: number | null; note: string | null }>(
    `select c.id, c.title, c.status, p.intervention_id iv, i.name iv_name, p.rationale, d.human_conclusion conclusion,
            o.category, o.did_pp did, o.interpretation_note note
       from outcome_evaluations o
       join cases c on c.id = o.case_id
       join case_plans p on p.id = o.plan_id
       left join interventions i on i.id = p.intervention_id
       left join diagnoses d on d.id = c.diagnosis_id
      where o.evaluated_at = (select max(o2.evaluated_at) from outcome_evaluations o2 where o2.case_id = o.case_id)`,
  )) {
    const body = [`Tried ${c.iv_name ?? c.iv ?? 'an intervention'}.`, c.rationale ?? '', c.conclusion ?? '',
      `Outcome: ${c.category.replace(/_/g, ' ')}${c.did === null ? '' : ` (${c.did > 0 ? '+' : ''}${c.did} pp)`}.`, c.note ?? '', `Case status: ${c.status.replace(/_/g, ' ')}.`].join('\n');
    ins.run('case', c.id, c.title, body, JSON.stringify({ iv: c.iv, iv_name: c.iv_name, category: c.category, did: c.did }));
  }
  return { db, signature: sig };
}

function index(): DatabaseSync {
  const sig = signature();
  if (!holder.index || holder.index.signature !== sig) {
    try { holder.index?.db.close(); } catch { /* already closed */ }
    holder.index = build(sig);
  }
  return holder.index.db;
}

/** Words → an FTS5 query: any word may match (OR), prefixes allowed, nothing the parser could misread. */
function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}]+/gu)?.filter((w) => w.length > 1).slice(0, 12) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(' OR ') : null;
}

export function searchLibrary(s: Session, q: string, opts: { interventions?: number; cases?: number } = {}): { interventions: LibraryHit[]; cases: LibraryHit[] } {
  const match = ftsQuery(q);
  if (!match) return { interventions: [], cases: [] };
  const db = index();
  const rows = (kind: string, limit: number) => db.prepare(
    `select id, title, detail, snippet(lib, 3, '[', ']', '…', 18) snip
       from lib where lib match ? and kind = ? order by bm25(lib, 0, 0, 4.0, 1.0) limit ?`,
  ).all(match, kind, limit) as { id: string; title: string; detail: string; snip: string }[];

  const interventions = rows('intervention', opts.interventions ?? 5).map((r) => ({
    kind: 'intervention' as const, id: r.id, title: r.title, snippet: r.snip.replace(/\s+/g, ' '), detail: r.detail,
  }));

  // Over-fetch, then keep only cases this reader may open.
  const caseRows = rows('case', 60);
  const visible = new Set<string>();
  if (caseRows.length) {
    const p = casesPred(s, 'c');
    const q2 = caseRows.map(() => '?').join(',');
    for (const r of all<{ id: string }>(`select c.id from cases c where c.id in (${q2}) and (${p.sql})`, ...caseRows.map((r) => r.id), ...p.params)) visible.add(r.id);
  }
  const cases = caseRows.filter((r) => visible.has(r.id)).slice(0, opts.cases ?? 5).map((r) => {
    const d = j<{ iv: string | null; iv_name: string | null; category: string; did: number | null }>(r.detail, { iv: null, iv_name: null, category: '', did: null });
    return {
      kind: 'case' as const, id: r.id, title: r.title, snippet: r.snip.replace(/\s+/g, ' '),
      detail: d.iv ? `${d.iv}${d.iv_name ? ` · ${d.iv_name}` : ''}` : '', outcome: { category: d.category, did_pp: d.did },
    };
  });
  return { interventions, cases };
}
