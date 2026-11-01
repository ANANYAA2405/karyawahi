import 'server-only';
import { createHash } from 'node:crypto';
import { all, one, j, bool, type Param } from './db';
import { and, auditPred, aiPred, reportsPred, importBatchPred, rejectedRowPred, hasRole, type Pred } from './scope';
import type { Session } from './session';

/** Notifications, reports, the audit chain, the AI log, the simulated outbox, imports and jobs. */

// ---------------------------------------------------------------- notifications
export interface NotificationRow {
  id: string; user_id: string; ts: string; kind: string; title: string; body: string;
  entity_type: string; entity_id: string; link: string; read_at: string | null;
}

export function listNotifications(s: Session, opts: { unreadOnly?: boolean; limit?: number } = {}): NotificationRow[] {
  const unread = opts.unreadOnly ? ' and read_at is null' : '';
  return all<NotificationRow>(
    `select * from notifications where user_id = ?${unread} order by ts desc limit ?`,
    s.user_id, opts.limit ?? 50,
  );
}

export const countUnread = (s: Session): number =>
  Number(one<{ c: number }>('select count(*) c from notifications where user_id = ? and read_at is null', s.user_id)?.c ?? 0);

// ---------------------------------------------------------------- reports
export interface ReportRow {
  id: string; report_type: string; title: string; scope_type: string; scope_id: string;
  period_start: string; period_end: string; generated_at: string; generated_by: string;
  case_ids: string; content: string; narrative_model: string | null; formats: string;
  demo_disclaimer: number;
}

export interface Report extends Omit<ReportRow, 'case_ids' | 'content' | 'formats' | 'demo_disclaimer'> {
  case_ids: string[]; content: Record<string, unknown>; formats: string[]; demo_disclaimer: boolean;
}

const toReport = (r: ReportRow): Report => ({
  ...r,
  case_ids: j(r.case_ids, [] as string[]),
  content: j(r.content, {} as Record<string, unknown>),
  formats: j(r.formats, [] as string[]),
  demo_disclaimer: bool(r.demo_disclaimer),
});

export function listReports(s: Session, opts: { type?: string; scopeId?: string; limit?: number } = {}): Report[] {
  const parts: Pred[] = [reportsPred(s, 'r')];
  if (opts.type) parts.push({ sql: 'r.report_type = ?', params: [opts.type] });
  if (opts.scopeId) parts.push({ sql: 'r.scope_id = ?', params: [opts.scopeId] });
  const p = and(...parts);
  return all<ReportRow>(
    `select r.* from reports r where ${p.sql} order by r.generated_at desc limit ?`, ...p.params, opts.limit ?? 60,
  ).map(toReport);
}

export function getReport(s: Session, id: string): Report | null {
  const p = reportsPred(s, 'r');
  const r = one<ReportRow>(`select r.* from reports r where r.id = ? and (${p.sql})`, id, ...p.params);
  return r ? toReport(r) : null;
}

export function reportTypeCounts(s: Session): Record<string, number> {
  const p = reportsPred(s, 'r');
  const rows = all<{ report_type: string; c: number }>(
    `select r.report_type, count(*) c from reports r where ${p.sql} group by r.report_type order by c desc`, ...p.params,
  );
  return Object.fromEntries(rows.map((x) => [x.report_type, Number(x.c)]));
}

// ---------------------------------------------------------------- audit chain
export interface AuditRow {
  id: string; ts: string; actor_user_id: string | null; actor_label: string; actor_role: string;
  action: string; entity_type: string; entity_id: string; before: string | null; after: string | null;
  reason: string | null; correlation_id: string; source: string; result: string;
  prev_hash: string; hash: string; hash_version: string;
}

export function listAudit(
  s: Session,
  opts: { entityType?: string; entityId?: string; action?: string; actor?: string; result?: string; limit?: number; offset?: number } = {},
): AuditRow[] {
  const parts: Pred[] = [auditPred(s, 'a')];
  if (parts[0].sql === '1=0') return [];
  if (opts.entityType) parts.push({ sql: 'a.entity_type = ?', params: [opts.entityType] });
  if (opts.entityId) parts.push({ sql: 'a.entity_id = ?', params: [opts.entityId] });
  if (opts.action) parts.push({ sql: 'a.action like ?', params: [`%${opts.action}%`] });
  if (opts.actor) parts.push({ sql: '(a.actor_user_id = ? or a.actor_label = ?)', params: [opts.actor, opts.actor] });
  if (opts.result) parts.push({ sql: 'a.result = ?', params: [opts.result] });
  const p = and(...parts);
  return all<AuditRow>(
    `select a.* from audit_events a where ${p.sql} order by a.seq desc limit ? offset ?`,
    ...p.params, opts.limit ?? 100, opts.offset ?? 0,
  );
}

export function countAudit(s: Session, opts: { entityType?: string; result?: string } = {}): number {
  const parts: Pred[] = [auditPred(s, 'a')];
  if (parts[0].sql === '1=0') return 0;
  if (opts.entityType) parts.push({ sql: 'a.entity_type = ?', params: [opts.entityType] });
  if (opts.result) parts.push({ sql: 'a.result = ?', params: [opts.result] });
  const p = and(...parts);
  return Number(one<{ c: number }>(`select count(*) c from audit_events a where ${p.sql}`, ...p.params)?.c ?? 0);
}

/** Audit rows for one entity, oldest first — the "who touched this" panel. */
export function auditFor(s: Session, entityType: string, entityId: string, limit = 200): AuditRow[] {
  const p = auditPred(s, 'a');
  if (p.sql === '1=0') return [];
  return all<AuditRow>(
    `select a.* from audit_events a where a.entity_type = ? and a.entity_id = ? and (${p.sql})
      order by a.seq limit ?`,
    entityType, entityId, ...p.params, limit,
  );
}

export function auditActionCounts(s: Session, limit = 25): { action: string; c: number }[] {
  const p = auditPred(s, 'a');
  if (p.sql === '1=0') return [];
  return all<{ action: string; c: number }>(
    `select a.action, count(*) c from audit_events a where ${p.sql} group by a.action order by c desc limit ?`,
    ...p.params, limit,
  );
}

/**
 * Verify the audit chain.
 *
 * Two separate things are checked, because they catch different tampering:
 *
 *   linkage — each row's prev_hash equals the previous row's hash. This catches an inserted or
 *   deleted row, since the chain no longer joins up.
 *
 *   content — each row's own hash is recomputed from its fields. This catches an *edited* row,
 *   which linkage alone would miss if the editor also fixed up the neighbouring prev_hash.
 *
 * Content can only be rechecked for rows hashed with the 'ts-json-v1' scheme, which is what
 * the seed generator and this app both use: sha256 over the row's JSON in a fixed key order,
 * with the previous hash appended. Rows written by Postgres carry 'sql-v1', which hashes a
 * pipe-joined string instead; those are counted as unverifiable here rather than as failures,
 * so a mixed table reports honestly instead of crying tamper.
 */
export function verifyAuditChain(s: Session): {
  checked: number;
  linked: boolean;
  firstBreakAt: string | null;
  genesisOk: boolean;
  rehashed: number;
  contentOk: boolean;
  firstContentBreakAt: string | null;
  unverifiable: number;
} {
  const empty = {
    checked: 0, linked: false, firstBreakAt: null, genesisOk: false,
    rehashed: 0, contentOk: false, firstContentBreakAt: null, unverifiable: 0,
  };
  if (!hasRole(s, 'auditor', 'state_admin', 'demo_admin')) return empty;

  type ChainRow = {
    seq: number; id: string; ts: string; actor_user_id: string | null; actor_label: string; actor_role: string;
    action: string; entity_type: string; entity_id: string; before: string | null; after: string | null;
    reason: string | null; correlation_id: string; source: string; result: string;
    prev_hash: string; hash: string; hash_version: string;
  };
  // The whole chain, in its own order (seq), a page at a time so memory stays flat as it grows.
  const page = (after: number) => all<ChainRow>(
    `select seq, id, ts, actor_user_id, actor_label, actor_role, action, entity_type, entity_id,
            before, after, reason, correlation_id, source, result, prev_hash, hash, hash_version
       from audit_events where seq > ? order by seq limit 5000`,
    after,
  );

  const GENESIS = '0'.repeat(64);
  let prev = GENESIS;
  let firstBreak: string | null = null;
  let firstContentBreak: string | null = null;
  let rehashed = 0;
  let unverifiable = 0;
  let checked = 0;
  let genesisOk = true;

  for (let rows = page(0); rows.length > 0; rows = page(rows[rows.length - 1].seq)) for (const r of rows) {
    if (checked++ === 0) genesisOk = r.prev_hash === GENESIS;
    if (r.prev_hash !== prev && firstBreak === null) firstBreak = r.id;

    if (r.hash_version === 'ts-json-v1') {
      // The field order below is the hashed order and must not be rearranged.
      const body = JSON.stringify({
        id: r.id,
        ts: r.ts,
        actor_user_id: r.actor_user_id,
        actor_label: r.actor_label,
        actor_role: r.actor_role,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        before: r.before === null ? null : JSON.parse(r.before),
        after: r.after === null ? null : JSON.parse(r.after),
        reason: r.reason,
        correlation_id: r.correlation_id,
        source: r.source,
        result: r.result,
        prev_hash: r.prev_hash,
      });
      const expected = createHash('sha256').update(body).digest('hex');
      if (expected !== r.hash && firstContentBreak === null) firstContentBreak = r.id;
      rehashed++;
    } else {
      unverifiable++;
    }
    prev = r.hash;
  }

  return {
    checked,
    linked: firstBreak === null,
    firstBreakAt: firstBreak,
    genesisOk,
    rehashed,
    contentOk: firstContentBreak === null,
    firstContentBreakAt: firstContentBreak,
    unverifiable,
  };
}

// ---------------------------------------------------------------- AI log
export interface AiRow {
  id: string; model: string; template_version: string; ts: string; user_id: string | null;
  role: string; kind: string; referenced_ids: string; input_summary: string; output_summary: string;
  status: string; auditor_verdict: string; reviewer_decision: string | null;
}

export function listAi(s: Session, opts: { kind?: string; status?: string; limit?: number } = {}): AiRow[] {
  const parts: Pred[] = [aiPred(s, 'ai')];
  if (opts.kind) parts.push({ sql: 'ai.kind = ?', params: [opts.kind] });
  if (opts.status) parts.push({ sql: 'ai.status = ?', params: [opts.status] });
  const p = and(...parts);
  return all<AiRow>(
    `select ai.* from ai_interactions ai where ${p.sql} order by ai.ts desc limit ?`, ...p.params, opts.limit ?? 100,
  );
}

export function aiStats(s: Session): { kind: string; status: string; c: number }[] {
  const p = aiPred(s, 'ai');
  return all<{ kind: string; status: string; c: number }>(
    `select ai.kind, ai.status, count(*) c from ai_interactions ai where ${p.sql}
      group by ai.kind, ai.status order by c desc`, ...p.params,
  );
}

// ---------------------------------------------------------------- outbox (simulated channels)
export interface OutboxRow {
  id: string; user_id: string; channel: string; ts: string; template: string; language: string;
  body: string; entity_type: string; entity_id: string; delivery_status: string;
}

export function listOutbox(s: Session, opts: { limit?: number; channel?: string } = {}): OutboxRow[] {
  const parts: Pred[] = [
    hasRole(s, 'demo_admin') ? { sql: '1=1', params: [] } : { sql: 'o.user_id = ?', params: [s.user_id] as Param[] },
  ];
  if (opts.channel) parts.push({ sql: 'o.channel = ?', params: [opts.channel] });
  const p = and(...parts);
  return all<OutboxRow>(
    `select o.* from outbox_messages o where ${p.sql} order by o.ts desc limit ?`, ...p.params, opts.limit ?? 100,
  );
}

// ---------------------------------------------------------------- imports
export interface ImportBatchRow {
  id: string; dataset_id: string; file_name: string; scope_type: string; scope_id: string;
  round_id: string | null; uploaded_by: string; uploaded_at: string; status: string;
  total_rows: number; accepted_rows: number; rejected_rows: number; warnings: number;
  error_summary: string | null; committed_at: string | null; provenance: string;
}

export function listImports(s: Session, opts: { limit?: number; datasetId?: string } = {}): ImportBatchRow[] {
  const parts: Pred[] = [importBatchPred(s, 'b')];
  if (parts[0].sql === '1=0') return [];
  if (opts.datasetId) parts.push({ sql: 'b.dataset_id = ?', params: [opts.datasetId] });
  const p = and(...parts);
  return all<ImportBatchRow>(
    `select b.* from import_batches b where ${p.sql} order by b.uploaded_at desc limit ?`, ...p.params, opts.limit ?? 60,
  );
}

export function getImport(s: Session, id: string): ImportBatchRow | null {
  const p = importBatchPred(s, 'b');
  if (p.sql === '1=0') return null;
  return one<ImportBatchRow>(`select b.* from import_batches b where b.id = ? and (${p.sql})`, id, ...p.params);
}

export interface RejectedRow { id: string; import_batch_id: string; row_number: number; raw: string; error_code: string; message: string }

export function importRejections(s: Session, batchId: string): (Omit<RejectedRow, 'raw'> & { raw: Record<string, string> })[] {
  if (!getImport(s, batchId)) return [];
  const p = rejectedRowPred(s, 'r');
  return all<RejectedRow>(
    `select r.* from import_rejected_rows r where r.import_batch_id = ? and (${p.sql}) order by r.row_number`, batchId, ...p.params,
  ).map((r) => ({ ...r, raw: j(r.raw, {} as Record<string, string>) }));
}

export function rejectionCodeCounts(s: Session): { error_code: string; c: number }[] {
  const p = rejectedRowPred(s, 'r');
  if (p.sql === '1=0') return [];
  return all<{ error_code: string; c: number }>(
    `select r.error_code, count(*) c from import_rejected_rows r where ${p.sql} group by r.error_code order by c desc`, ...p.params,
  );
}

// ---------------------------------------------------------------- system jobs
export interface JobRow {
  id: string; job_type: string; started_at: string; finished_at: string; status: string;
  summary: string; error: string | null;
}

export function listJobs(s: Session, opts: { limit?: number; type?: string } = {}): (Omit<JobRow, 'summary'> & { summary: Record<string, unknown> })[] {
  if (!hasRole(s, 'state_admin', 'demo_admin')) return [];
  const parts: Pred[] = [];
  if (opts.type) parts.push({ sql: 'job_type = ?', params: [opts.type] });
  const p = and(...parts);
  return all<JobRow>(
    `select * from system_jobs where ${p.sql} order by started_at desc limit ?`, ...p.params, opts.limit ?? 80,
  ).map((r) => ({ ...r, summary: j(r.summary, {} as Record<string, unknown>) }));
}
