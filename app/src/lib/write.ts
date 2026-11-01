import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { all, one, run, tx, nextId, nextIdFor, nextSeq, j, restorePristine } from './db';
import { Refused, actingRole, may, moveRefusal, require_, requireDecideLever, requiredRoleFor } from './guard';
import { involvement, INVOLVEMENT_MESSAGE } from './duty';
import { casesPred, hasRole } from './scope';
import type { Session } from './session';
import { nowIso, today, addDays } from './clock';
import { canTransition, reasonRequired, closureEligibility, isPlanDecision } from '@domain/lifecycle';
import { evaluateOutcome, OUTCOME_NOTE } from '@domain/outcome';
import { settingsAt, settingsById } from '@domain/catalog';
import type { CaseStatus, OutcomeSchoolRow } from '@domain/types';
import {
  composeRefusal, orderSchools, previewPlan, preRegistrationFor, taskDrafts, assignRefusal, reassignRefusal, breaksIndependence,
  ownerOptions, type PlanCase, type ReassignTask,
} from './plans';
import { matchForCase } from './studio';
import { TEMPLATE, messageFor, outboxChannel, langOf, type MessageContext, type Template } from './reminders';
import { checkPhoto, photoAlreadyUsed, storePhoto } from './evidence-files';
import { classifyFix, parseFix, schoolPosition, type GpsResult, type GpsStatus } from './proof-gps';

/**
 * Every write in the app. This is the TypeScript twin of the SECURITY DEFINER functions in
 * sql/schema.sql — transition_case(), verify_evidence(), reminder_sweep(), demo_reset() — and
 * it re-checks the same things in the same order:
 *
 *   signed in → record exists → in scope → rule is legal → reason given → role is empowered
 *   → the specific guards (closure needs proof, nobody verifies their own evidence)
 *
 * Refusals are recorded. An illegal transition writes a failure row to the audit chain before
 * throwing, exactly as the Postgres function does, so an attempt to do something forbidden is
 * itself part of the record.
 *
 * Nothing here trusts an argument. Ids are looked up, never interpolated.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ audit chain
/**
 * Append to the tamper-evident chain, using the same scheme as the seed ('ts-json-v1'):
 * sha256 over the JSON of the row's fields in a fixed key order, including the previous hash.
 * Because the scheme matches, the auditor page can recompute every hash in the table — seeded
 * and live alike — rather than only checking that the links line up.
 */
export function appendAudit(o: {
  actorUserId: string | null;
  actorLabel?: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string;
  source?: 'web' | 'mobile' | 'whatsapp_sim' | 'ivr_sim' | 'system' | 'import';
  result?: 'success' | 'failure';
}): string {
  // The chain's order is its own sequence, not the timestamp: the demo clock can move backwards,
  // and a row written after that must still follow the row written before it.
  const last = one<{ hash: string; seq: number }>(
    'select hash, seq from audit_events order by seq desc limit 1',
  );
  const prev = last?.hash ?? '0'.repeat(64);

  const id = nextId('audit', 'AUD-', 7);
  const row = {
    id,
    ts: nowIso(),
    actor_user_id: o.actorUserId,
    actor_label: o.actorLabel ?? o.actorUserId ?? 'system',
    actor_role: o.actorRole,
    action: o.action,
    entity_type: o.entityType,
    entity_id: o.entityId,
    before: (o.before as Record<string, unknown>) ?? null,
    after: (o.after as Record<string, unknown>) ?? null,
    reason: o.reason ?? null,
    correlation_id: o.correlationId ?? `COR-${sha(`${o.entityId}:${o.action}:${nowIso()}`).slice(0, 12)}`,
    source: o.source ?? (o.actorRole === 'system' ? 'system' : 'web'),
    result: o.result ?? 'success',
  };
  const hash = sha(JSON.stringify({ ...row, prev_hash: prev }));

  run(
    `insert into audit_events
      (id, ts, actor_user_id, actor_label, actor_role, action, entity_type, entity_id,
       before, after, reason, correlation_id, source, result, prev_hash, hash, hash_version, seq)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.ts, row.actor_user_id, row.actor_label, row.actor_role, row.action,
    row.entity_type, row.entity_id,
    row.before === null ? null : JSON.stringify(row.before),
    row.after === null ? null : JSON.stringify(row.after),
    row.reason, row.correlation_id, row.source, row.result, prev, hash, 'ts-json-v1',
    (last?.seq ?? 0) + 1,
  );
  return id;
}

export function addCaseEvent(o: {
  caseId: string; actorUserId: string | null; actorLabel: string; kind: string; summary: string;
  fromStatus?: CaseStatus | null; toStatus?: CaseStatus | null; related?: string | null;
}): void {
  const n = nextSeq('case_event');
  run(
    `insert into case_events (id, case_id, ts, actor_user_id, actor_label, kind, summary, from_status, to_status, related_entity)
     values (?,?,?,?,?,?,?,?,?,?)`,
    `CEV-${String(n).padStart(6, '0')}`, o.caseId, nowIso(), o.actorUserId, o.actorLabel,
    o.kind, o.summary, o.fromStatus ?? null, o.toStatus ?? null, o.related ?? null,
  );
}

export function notify(o: {
  userId: string; kind: string; title: string; body: string;
  entityType: string; entityId: string; link: string;
}): void {
  const n = nextSeq('notification');
  run(
    `insert into notifications (id, user_id, ts, kind, title, body, entity_type, entity_id, link, read_at)
     values (?,?,?,?,?,?,?,?,?,null)`,
    `NTF-${String(n).padStart(6, '0')}`, o.userId, nowIso(), o.kind, o.title, o.body,
    o.entityType, o.entityId, o.link,
  );
}

export function recordJob(type: string, status: string, summary: unknown, error: string | null = null): void {
  const n = nextSeq('job');
  run(
    `insert into system_jobs (id, job_type, started_at, finished_at, status, summary, error)
     values (?,?,?,?,?,?,?)`,
    `JOB-${String(n).padStart(5, '0')}`, type, nowIso(), nowIso(), status, JSON.stringify(summary), error,
  );
}

// ------------------------------------------------------------------ helpers
interface CaseCore {
  id: string; status: CaseStatus; lever: 'block' | 'district' | 'pab'; current_plan_id: string | null;
  state_id: string; district_id: string; block_id: string; cluster_id: string; school_ids: string;
  title: string; owner_user_id: string; reopen_count: number;
  grade: number; competency_id: string; finding_id: string | null; version: number;
}

export function loadCaseForWrite(s: Session, caseId: string): CaseCore {
  // Scope first, then the row — a refusal must not reveal anything about a case out of scope
  // beyond the fact that it exists, which is what the Postgres function also leaks.
  const p = casesPred(s, 'c');
  const row = one<CaseCore>(
    `select c.* from cases c where c.id = ? and (${p.sql})`, caseId, ...p.params,
  );
  if (row) return row;
  const exists = (one<{ c: number }>('select count(*) c from cases where id = ?', caseId)?.c ?? 0) > 0;
  throw new Refused(
    exists ? `Case ${caseId} is outside your scope.` : `Case ${caseId} does not exist.`,
    exists ? 'scope' : 'not_found',
  );
}

/** Who submitted the plan now waiting on a decision, or null when nobody recorded it. */
function pendingSubmitter(caseId: string, planId: string | null): string | null {
  return one<{ submitted_by: string }>(
    `select submitted_by from approvals where case_id = ? and decision = 'pending' and (? is null or plan_id = ?)
      order by submitted_at desc limit 1`, caseId, planId, planId,
  )?.submitted_by ?? null;
}

/** Refuses a move the user has no authority for, leaving the attempt in the audit chain. Call it
 *  outside any transaction, or the audit row is rolled back with the refusal. */
function checkMoveAuthority(s: Session, c: CaseCore, to: CaseStatus, submittedBy: string | null, corr: string): void {
  const refusal = moveRefusal(s, c, to, submittedBy);
  if (!refusal) return;
  appendAudit({
    actorUserId: s.user_id, actorRole: actingRole(s),
    action: refusal.code === 'own_submission' ? 'plan.approve_refused' : 'case.status_change_refused',
    entityType: 'case', entityId: c.id, before: { status: c.status }, after: { status: to },
    reason: refusal.message, correlationId: corr, result: 'failure',
  });
  throw new Refused(refusal.message, refusal.code);
}

/** A submission opens one pending approval for the current plan, recording who submitted it,
 *  so the approver can be checked against the submitter. */
function openApproval(s: Session, c: CaseCore, planId: string): void {
  const open = one<{ id: string }>(
    `select id from approvals where case_id = ? and plan_id = ? and decision = 'pending'`, c.id, planId,
  );
  if (open) return;
  ensurePreRegistration(c, planId);
  const plan = one<{ intervention_id: string; school_ids: string; version: number; drafted_by: string; pre_registration: string | null }>(
    'select intervention_id, school_ids, version, drafted_by, pre_registration from case_plans where id = ?', planId,
  );
  run(
    `insert into approvals (id, case_id, plan_id, required_role, lever, submitted_by, submitted_at, decision,
       decided_by, decided_at, reason, original_plan, edited_plan, ai_drafted)
     values (?,?,?,?,?,?,?,'pending',null,null,null,?,null,?)`,
    // The lever in force now is the one the decision gate (moveRefusal) will apply to this plan.
    nextIdFor('approval', 'approvals', 'APR-', 5), c.id, planId, requiredRoleFor(c.lever), c.lever, s.user_id, nowIso(),
    JSON.stringify({
      intervention_id: plan?.intervention_id, school_ids: j(plan?.school_ids, []), version: plan?.version,
      pre_registration: j(plan?.pre_registration, null),
    }),
    plan?.drafted_by === 'ai_draft' ? 1 : 0,
  );
  run(`update case_plans set status = 'submitted' where id = ?`, planId);
}

/**
 * Give a plan the terms its outcome check will be held to, if it has none yet. Plans composed in
 * the app carry them from the start; older drafts get them when submitted, and at the latest
 * when approved. Once written they are never recomputed: a changed plan is a new plan row.
 */
function ensurePreRegistration(c: CaseCore, planId: string): void {
  const plan = one<{ school_ids: string; pre_registration: string | null }>(
    'select school_ids, pre_registration from case_plans where id = ?', planId,
  );
  if (!plan || plan.pre_registration) return;
  const pre = preRegistrationFor(c, j<string[]>(plan.school_ids, []));
  if (pre) run('update case_plans set pre_registration = ? where id = ? and pre_registration is null', JSON.stringify(pre), planId);
}

// ------------------------------------------------------------------ transition_case
export interface TransitionResult { caseId: string; from: CaseStatus; to: CaseStatus }

export function transitionCase(
  s: Session, caseId: string, to: CaseStatus, reason?: string | null,
): TransitionResult {
  // Validation happens before any transaction is opened. A refused attempt is itself part of
  // the record, so its audit row must not be rolled back along with the change it refused.
  const c = loadCaseForWrite(s, caseId);
  const from = c.status;
  const role = actingRole(s);
  const corr = randomUUID();

  // 1. is the move legal at all?
  if (!canTransition(from, to)) {
    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: 'case.status_change_refused',
      entityType: 'case', entityId: caseId,
      before: { status: from }, after: { status: to },
      reason: 'illegal transition', correlationId: corr, result: 'failure',
    });
    throw new Refused(`A case cannot go from "${from}" to "${to}".`, 'illegal_transition');
  }

  // 2. does it need a written reason?
  if (reasonRequired(from, to) && !reason?.trim()) {
    throw new Refused(`Moving a case from "${from}" to "${to}" needs a written reason.`, 'reason_required');
  }

  // 3. is this role empowered to make this particular move, over this case's area, and (for an
  //    approval) is it someone other than the person who submitted the plan?
  checkMoveAuthority(s, c, to, isPlanDecision(from, to) ? pendingSubmitter(caseId, c.current_plan_id) : null, corr);
  if (to === 'awaiting_approval' && !c.current_plan_id) {
    throw new Refused('There is no plan on this case to submit for approval.', 'no_plan');
  }
  if (to === 'assigned') {
    const n = one<{ c: number }>('select count(*) c from tasks where plan_id = ?', c.current_plan_id)?.c ?? 0;
    if (n === 0) {
      throw new Refused('Work is assigned by turning the approved plan into tasks, and this plan has none yet. Use "Review and assign the tasks".', 'no_tasks');
    }
  }
  if (isPlanDecision(from, to)) {
    require_(s, to === 'approved' && c.lever === 'block' ? 'plan.approve_block'
      : to === 'approved' ? 'plan.approve_district_or_pab' : 'plan.reject_or_revise');
  }
  if (to === 'dismissed') require_(s, 'case.edit_diagnosis', 'to dismiss a finding');
  if (to === 'reopened') {
    if (!hasRole(s, 'beo', 'deo', 'state_admin')) {
      throw new Refused(`A ${role} cannot reopen a case.`, 'role');
    }
    require_(s, 'case.reopen');
  }

  // 4. the proof gates — delivery verified, independently checked, and a measured gain
  if (to === 'outcome_pending') {
    const unverified = one<{ c: number }>(
      'select count(*) c from tasks where plan_id = ? and verified_at is null', c.current_plan_id,
    )?.c ?? 0;
    if (unverified > 0) {
      appendAudit({
        actorUserId: s.user_id, actorRole: role, action: 'case.status_change_refused',
        entityType: 'case', entityId: caseId, before: { status: from }, after: { status: to },
        reason: `${unverified} task(s) without verified proof`, correlationId: corr, result: 'failure',
      });
      throw new Refused(
        `${unverified} task${unverified === 1 ? '' : 's'} on this plan still have no verified proof.`,
        'unverified_tasks',
      );
    }
    const crossSource = one<{ c: number }>(
      'select count(*) c from tasks where plan_id = ? and cross_source = 1 and verified_at is not null',
      c.current_plan_id,
    )?.c ?? 0;
    if (crossSource === 0) {
      throw new Refused(
        'An independent (cross-source) verification is required before the outcome check.',
        'no_cross_source',
      );
    }
  }

  if (to === 'closed') {
    if (!hasRole(s, 'beo', 'deo')) throw new Refused('Only a BEO or DEO can close a case.', 'role');
    require_(s, 'case.close');
    const eligible = one<{ c: number }>(
      'select count(*) c from outcome_evaluations where case_id = ? and plan_id = ? and closure_eligible = 1',
      caseId, c.current_plan_id,
    )?.c ?? 0;
    if (eligible === 0) {
      const latest = one<{ category: string; closure_blockers: string }>(
        'select category, closure_blockers from outcome_evaluations where case_id = ? order by evaluated_at desc limit 1',
        caseId,
      );
      const blockers = latest ? j<string[]>(latest.closure_blockers, []) : [];
      appendAudit({
        actorUserId: s.user_id, actorRole: role, action: 'case.close_refused',
        entityType: 'case', entityId: caseId,
        reason: blockers.join('; ') || 'no eligible outcome evaluation',
        correlationId: corr, result: 'failure',
      });
      throw new Refused(
        blockers.length > 0
          ? `Closure is blocked: ${blockers.join('; ')}.`
          : 'Closure is blocked: there is no eligible outcome evaluation for the current plan.',
        'closure_blocked',
      );
    }
  }

  // 5. do it
  return tx(() => {
    if (to === 'awaiting_approval') openApproval(s, c, c.current_plan_id!);
    const closedAt = to === 'closed' ? nowIso() : null;
    // The summary columns other screens read (the closure mix, the map's improved layer, the ATR)
    // move with the status: closing records the outcome it closed on, reopening clears it.
    const closedOn = to === 'closed'
      ? one<{ category: string }>(
        `select category from outcome_evaluations where case_id = ? and plan_id = ? and closure_eligible = 1
          order by evaluated_at desc limit 1`, caseId, c.current_plan_id,
      )?.category ?? null
      : null;
    // Only from the status the checks above were made against: if the case moved in between,
    // nothing changes and the user is told, instead of a stale move landing on a newer state.
    const changed = run(
      `update cases set status = ?, updated_at = ?, version = version + 1,
         closed_at = case when ? = 'closed' then ? else closed_at end,
         reopen_count = reopen_count + case when ? = 'reopened' then 1 else 0 end,
         closure_type = case ? when 'closed' then ? when 'reopened' then null else closure_type end,
         verification_status = case when ? = 'closed' then 'verified' else verification_status end
       where id = ? and status = ?`,
      to, nowIso(), to, closedAt, to, to, closedOn, to, caseId, from,
    );
    if (changed === 0) {
      throw new Refused('This case changed while you were looking at it. Reload to see where it is now.', 'stale');
    }
    addCaseEvent({
      caseId, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'status_changed',
      summary: reason?.trim() || `${from} → ${to}`, fromStatus: from, toStatus: to,
    });
    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: 'case.status_changed',
      entityType: 'case', entityId: caseId,
      before: { status: from }, after: { status: to }, reason: reason ?? null, correlationId: corr,
    });

    // 6. tell the people who need to know
    if (to === 'approved' || to === 'revision_requested' || to === 'closed' || to === 'reopened') {
      const kind = to === 'approved' ? 'assignment'
        : to === 'revision_requested' ? 'evidence_rejected'
        : to === 'closed' ? 'case_closed' : 'case_reopened';
      const title = {
        approved: 'Plan approved', revision_requested: 'Plan sent back for changes',
        closed: 'Case closed on a verified outcome', reopened: 'Case reopened',
      }[to as 'approved' | 'revision_requested' | 'closed' | 'reopened'];
      if (c.owner_user_id !== s.user_id) {
        notify({
          userId: c.owner_user_id, kind, title, body: c.title,
          entityType: 'case', entityId: caseId, link: `/cases/${caseId}`,
        });
      }
    }

    return { caseId, from, to };
  });
}

// ------------------------------------------------------------------ plan decisions
/**
 * Record an approval decision and move the case. One call so the approval row and the case
 * status can never disagree; if the transition is refused, the decision is rolled back too.
 */
export function decidePlan(
  s: Session,
  o: { caseId: string; planId: string; decision: 'approved' | 'approved_with_edits' | 'rejected' | 'revision_requested' | 'approved_for_pab'; reason?: string | null },
): TransitionResult {
  // Every check runs before the transaction opens, so a refused attempt stays in the audit chain
  // instead of being rolled back with the decision it refused.
  const c = loadCaseForWrite(s, o.caseId);
  requireDecideLever(s, c.lever);
  if (c.status !== 'awaiting_approval') {
    throw new Refused(`This case is "${c.status}", not waiting for a decision.`, 'wrong_status');
  }
  const plan = one<{ id: string; case_id: string }>('select id, case_id from case_plans where id = ?', o.planId);
  if (!plan || plan.case_id !== o.caseId) throw new Refused('That plan does not belong to this case.', 'mismatch');

  if ((o.decision === 'rejected' || o.decision === 'revision_requested') && !o.reason?.trim()) {
    throw new Refused('Sending a plan back needs a written reason.', 'reason_required');
  }

  const to: CaseStatus =
    o.decision === 'rejected' ? 'under_investigation'
    : o.decision === 'revision_requested' ? 'revision_requested'
    : o.decision === 'approved_for_pab' ? 'referred_pab'
    : 'approved';
  checkMoveAuthority(s, c, to, pendingSubmitter(o.caseId, o.planId), randomUUID());

  return tx(() => {
    const pending = one<{ id: string }>(
      `select id from approvals where case_id = ? and plan_id = ? and decision = 'pending' limit 1`,
      o.caseId, o.planId,
    );
    if (pending) {
      run(
        `update approvals set decision = ?, decided_by = ?, decided_at = ?, reason = ? where id = ?`,
        o.decision, s.user_id, nowIso(), o.reason ?? null, pending.id,
      );
    }
    const planStatus =
      o.decision === 'rejected' ? 'rejected'
      : o.decision === 'revision_requested' ? 'revision_requested'
      : o.decision === 'approved_for_pab' ? 'referred_pab'
      : 'approved';
    run('update case_plans set status = ? where id = ?', planStatus, o.planId);
    if (planStatus === 'approved') {
      // Approval locks the outcome check's terms and makes the plan's schools the case's schools,
      // which is what scoping and the outcome check read from here on.
      ensurePreRegistration(c, o.planId);
      run(`update cases set school_ids = (select school_ids from case_plans where id = ?) where id = ?`, o.planId, o.caseId);
    }

    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: `plan.${o.decision}`,
      entityType: 'case_plan', entityId: o.planId,
      before: { status: 'submitted' }, after: { status: planStatus },
      reason: o.reason ?? null,
    });
    addCaseEvent({
      caseId: o.caseId, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'plan_decision',
      summary: o.reason?.trim() || `Plan ${o.decision.replace(/_/g, ' ')}`, related: o.planId,
    });

    return transitionCase(s, o.caseId, to, o.reason);
  });
}

// ------------------------------------------------------------------ the plan composer
const asPlanCase = (c: CaseCore): PlanCase => c;

/**
 * Save a new plan for a case: an intervention, the schools it covers and why. The preview the
 * officer saw is recomputed here from the same functions, so the stored comparison schools and
 * threshold are exactly the ones shown. Every save is a new plan row (a new version, or a new
 * cycle after a reopening); an earlier draft that was never submitted is marked superseded.
 */
export function draftPlan(
  s: Session,
  o: { caseId: string; interventionId: string; schoolIds: string[]; rationale: string; caseVersion: number },
): { planId: string } {
  const c = loadCaseForWrite(s, o.caseId);
  const refusal = composeRefusal(s, asPlanCase(c));
  if (refusal) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'plan.draft_refused',
      entityType: 'case', entityId: c.id, reason: refusal.message, result: 'failure',
    });
    throw new Refused(refusal.message, refusal.code);
  }
  if (c.version !== o.caseVersion) {
    throw new Refused('This case changed while you were composing. Reload to see the latest, then save again.', 'stale');
  }
  const rationale = o.rationale.trim();
  if (rationale.length < 10) throw new Refused('Say in a sentence why this plan fits this case.', 'reason_required');

  const matches = matchForCase(s, c.id)?.matches ?? [];
  const m = matches.find((x) => x.intervention.id === o.interventionId);
  if (!m) throw new Refused(`There is no intervention "${o.interventionId}" in the library.`, 'not_found');
  if (!m.eligible) throw new Refused(`${m.intervention.name} does not fit this case: ${m.excludedBecause}.`, 'ineligible');

  const { ordered, unknown } = orderSchools(asPlanCase(c), o.schoolIds);
  if (unknown.length) throw new Refused(`${unknown.join(', ')} is not one of this case's schools.`, 'school_out_of_case');
  if (ordered.length === 0) throw new Refused('Choose at least one school for the plan.', 'no_schools');

  const preview = previewPlan(asPlanCase(c), matches, o.interventionId, ordered)!;
  const pre = preview.preRegistration;
  if (!pre) {
    throw new Refused('No later assessment round is scheduled, so there is nothing to check this plan against.', 'no_followup_round');
  }
  if (pre.comparison_school_ids.length === 0) {
    throw new Refused('No comparison schools could be found for these schools, so the outcome could not be checked fairly.', 'no_comparison');
  }

  return tx(() => {
    const cur = c.current_plan_id
      ? one<{ cycle: number; status: string }>('select cycle, status from case_plans where id = ?', c.current_plan_id)
      : null;
    const cycle = !cur ? 1 : c.status === 'reopened' ? cur.cycle + 1 : cur.cycle;
    const version = Number(one<{ v: number }>(
      'select coalesce(max(version), 0) v from case_plans where case_id = ? and cycle = ?', c.id, cycle,
    )?.v ?? 0) + 1;
    const planId = nextIdFor('plan', 'case_plans', 'PLN-', 5);
    run(
      `insert into case_plans (id, case_id, cycle, version, intervention_id, alternatives, school_ids, rationale,
         drafted_by, ai_model, pre_registration, estimated_cost_inr, cost_is_illustrative, status, created_at, created_by)
       values (?,?,?,?,?,?,?,?,'officer',null,?,?,?,'draft',?,?)`,
      planId, c.id, cycle, version, o.interventionId, JSON.stringify(preview.alternatives), JSON.stringify(ordered),
      rationale, JSON.stringify(pre), preview.estimatedCost, m.intervention.cost_basis.illustrative === false ? 0 : 1, nowIso(), s.user_id,
    );
    if (cur?.status === 'draft') run(`update case_plans set status = 'superseded' where id = ?`, c.current_plan_id);
    // The intervention's lever decides who approves the plan, so the case takes it on.
    const changed = run(
      `update cases set current_plan_id = ?, lever = ?, updated_at = ?, version = version + 1 where id = ? and version = ?`,
      planId, m.intervention.lever, nowIso(), c.id, o.caseVersion,
    );
    if (changed === 0) throw new Refused('This case changed while you were composing. Reload to see the latest, then save again.', 'stale');

    addCaseEvent({
      caseId: c.id, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'plan_drafted',
      summary: `Plan drafted: ${m.intervention.name} in ${ordered.length} school${ordered.length === 1 ? '' : 's'}`, related: planId,
    });
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'plan.drafted',
      entityType: 'case_plan', entityId: planId,
      before: c.current_plan_id ? { plan_id: c.current_plan_id, lever: c.lever } : null,
      after: {
        case_id: c.id, intervention_id: o.interventionId, school_ids: ordered, cycle, version, lever: m.intervention.lever,
        comparison_school_ids: pre.comparison_school_ids,
        success_threshold_pp: pre.success_threshold_pp,
      },
      reason: rationale,
    });
    return { planId };
  });
}

/**
 * Turn the approved plan into tasks and move the case to "Work assigned". The officer may change
 * each task's owner and due date, but not drop or add tasks: the list is the plan, and the
 * independent spot-check in it is what lets the case close on proof later.
 */
export function assignTasks(
  s: Session,
  o: { caseId: string; caseVersion: number; rows: { rowKey: string; ownerUserId: string; dueDate: string }[] },
): { taskIds: string[] } {
  const c = loadCaseForWrite(s, o.caseId);
  const corr = randomUUID();
  const refusal = assignRefusal(s, asPlanCase(c));
  if (refusal) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'plan.assign_refused',
      entityType: 'case', entityId: c.id, reason: refusal.message, correlationId: corr, result: 'failure',
    });
    throw new Refused(refusal.message, refusal.code);
  }
  if (c.version !== o.caseVersion) {
    throw new Refused('This case changed while you were reviewing the tasks. Reload and check them again.', 'stale');
  }
  const planId = c.current_plan_id!;
  const plan = one<{ status: string; cycle: number }>('select status, cycle from case_plans where id = ?', planId);
  if (plan?.status !== 'approved') throw new Refused('Only an approved plan can be turned into tasks.', 'wrong_status');
  if ((one<{ c: number }>('select count(*) c from tasks where plan_id = ?', planId)?.c ?? 0) > 0) {
    throw new Refused('The tasks for this plan have already been assigned.', 'already_assigned');
  }

  // The submitted rows must be the plan's rows, each exactly once, with an owner the plan allows.
  const drafts = taskDrafts(asPlanCase(c), planId);
  const byKey = new Map(o.rows.map((r) => [r.rowKey, r]));
  if (byKey.size !== o.rows.length) throw new Refused('A task appears twice in the list.', 'bad_input');
  const missing = drafts.filter((d) => !byKey.has(d.rowKey));
  if (missing.length) throw new Refused(`The list is missing ${missing.length} of the plan's tasks; every task in the plan must be assigned.`, 'bad_input');
  const extra = o.rows.filter((r) => !drafts.some((d) => d.rowKey === r.rowKey));
  if (extra.length) throw new Refused('The list has a task this plan does not contain.', 'bad_input');

  const horizon = addDays(today(), 180);
  const chosen = drafts.map((d) => {
    const r = byKey.get(d.rowKey)!;
    const where = d.schoolName ? ` at ${d.schoolName}` : '';
    if (!d.options.some((x) => x.id === r.ownerUserId)) {
      throw new Refused(`"${d.title_en}"${where} must go to a ${d.template.owner_role.toUpperCase()} who covers it; the person chosen does not.`, 'owner');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) || r.dueDate < today() || r.dueDate > horizon) {
      throw new Refused(`"${d.title_en}"${where} needs a due date between today and ${horizon}.`, 'bad_input');
    }
    return { d, ownerUserId: r.ownerUserId, dueDate: r.dueDate };
  });
  // The independent check only counts if it is independent: whoever does it must not also be
  // delivering the work it checks.
  const deliverers = new Set(chosen.filter((x) => !x.d.template.cross_source).map((x) => x.ownerUserId));
  const selfCheck = chosen.find((x) => x.d.template.cross_source && deliverers.has(x.ownerUserId));
  if (selfCheck) {
    throw new Refused(`"${selfCheck.d.title_en}" is the independent check, so it must go to someone who is not also delivering the work.`, 'not_independent');
  }

  return tx(() => {
    const now = nowIso();
    const taskIds: string[] = [];
    for (const x of chosen) {
      const id = nextIdFor('task', 'tasks', 'TSK-', 5);
      taskIds.push(id);
      run(
        `insert into tasks (id, case_id, plan_id, cycle, template_key, title_en, title_hi, school_id, owner_user_id, owner_role,
           proof_type, proof_count, cross_source, status, assigned_at, due_date, original_due_date, acknowledged_at, started_at,
           submitted_at, verified_at, reminder_sent_at, escalated_at, is_overdue, reassigned_from, reassign_reason,
           deadline_change_reason, version)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,'assigned',?,?,?,null,null,null,null,null,null,0,null,null,null,0)`,
        id, c.id, planId, plan.cycle, x.d.template.key, x.d.title_en, x.d.title_hi, x.d.schoolId, x.ownerUserId,
        x.d.template.owner_role, x.d.template.proof_type, x.d.template.proof_count, x.d.template.cross_source ? 1 : 0,
        now, x.dueDate, x.dueDate,
      );
      const defaultOwner = x.d.ownerUserId;
      appendAudit({
        actorUserId: s.user_id, actorRole: actingRole(s), action: 'task.assigned',
        entityType: 'task', entityId: id, correlationId: corr,
        after: {
          case_id: c.id, plan_id: planId, template_key: x.d.template.key, school_id: x.d.schoolId,
          owner_user_id: x.ownerUserId, due_date: x.dueDate,
          ...(defaultOwner && defaultOwner !== x.ownerUserId ? { suggested_owner_user_id: defaultOwner } : {}),
        },
      });
      notify({
        userId: x.ownerUserId, kind: 'assignment', title: 'New task assigned to you',
        body: `${x.d.title_en}${x.d.schoolName ? ` · ${x.d.schoolName}` : ''} · due ${x.dueDate}`,
        entityType: 'task', entityId: id, link: `/tasks/${id}`,
      });
    }
    const people = new Set(chosen.map((x) => x.ownerUserId)).size;
    addCaseEvent({
      caseId: c.id, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'tasks_assigned',
      summary: `${taskIds.length} tasks assigned to ${people} ${people === 1 ? 'person' : 'people'}`, related: planId,
    });
    const moved = run(`update cases set version = version + 1 where id = ? and version = ?`, c.id, o.caseVersion);
    if (moved === 0) throw new Refused('This case changed while you were reviewing the tasks. Reload and check them again.', 'stale');
    transitionCase(s, c.id, 'assigned');
    return { taskIds };
  });
}

/**
 * Give a task to someone else: a coordinator on leave, a headmaster transferred out. The new
 * owner must cover the task's school the same way the first one did, the independent check stays
 * independent, and the reason is kept on the task, the case timeline and the audit chain. Work
 * already acknowledged or started goes back to "assigned", because the new owner has not yet
 * seen it; proof already submitted stays where it is.
 */
export function reassignTask(
  s: Session,
  o: { taskId: string; newOwnerUserId: string; reason: string; taskVersion: number },
): void {
  const t = one<ReassignTask>(
    `select id, case_id, plan_id, school_id, owner_user_id, owner_role, cross_source, status, version from tasks where id = ?`,
    o.taskId,
  );
  if (!t) throw new Refused('No such task.', 'not_found');
  const c = loadCaseForWrite(s, t.case_id);
  const refusal = reassignRefusal(s, asPlanCase(c), t);
  if (refusal) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'task.reassign_refused',
      entityType: 'task', entityId: t.id, reason: refusal.message, result: 'failure',
    });
    throw new Refused(refusal.message, refusal.code);
  }
  const reason = o.reason.trim();
  if (reason.length < 5) throw new Refused('Say why the task is moving to someone else.', 'reason_required');
  if (o.newOwnerUserId === t.owner_user_id) throw new Refused('That person already holds this task.', 'same_owner');
  const candidate = ownerOptions(asPlanCase(c), t.owner_role, t.school_id).find((x) => x.id === o.newOwnerUserId);
  if (!candidate) {
    throw new Refused(`This task must go to a ${t.owner_role.toUpperCase()} who covers it; the person chosen does not.`, 'owner');
  }
  if (breaksIndependence(t.plan_id, t.id, !!t.cross_source, o.newOwnerUserId)) {
    throw new Refused(
      t.cross_source
        ? 'This is the independent check, so it cannot go to someone delivering work on the same plan.'
        : 'That person holds the independent check on this plan, so they cannot also deliver the work it checks.',
      'not_independent',
    );
  }
  if (t.version !== o.taskVersion) {
    throw new Refused('This task changed while you were looking at it. Reload and check it again.', 'stale');
  }

  tx(() => {
    const changed = run(
      `update tasks set owner_user_id = ?, reassigned_from = ?, reassign_reason = ?,
         status = case when status in ('acknowledged','in_progress') then 'assigned' else status end,
         acknowledged_at = case when status in ('acknowledged','in_progress') then null else acknowledged_at end,
         version = version + 1
       where id = ? and version = ?`,
      o.newOwnerUserId, t.owner_user_id, reason, t.id, o.taskVersion,
    );
    if (changed === 0) throw new Refused('This task changed while you were looking at it. Reload and check it again.', 'stale');
    const title = one<{ title_en: string }>('select title_en from tasks where id = ?', t.id)!.title_en;
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'task.reassigned',
      entityType: 'task', entityId: t.id,
      before: { owner_user_id: t.owner_user_id, status: t.status },
      after: { owner_user_id: o.newOwnerUserId }, reason,
    });
    addCaseEvent({
      caseId: c.id, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'task_reassigned',
      summary: `Task reassigned: ${reason}`, related: t.id,
    });
    notify({
      userId: o.newOwnerUserId, kind: 'assignment', title: 'Task reassigned to you',
      body: `${title} · ${reason}`, entityType: 'task', entityId: t.id, link: `/tasks/${t.id}`,
    });
    notify({
      userId: t.owner_user_id, kind: 'assignment', title: 'A task has moved to someone else',
      body: `${title} · ${reason}`, entityType: 'task', entityId: t.id, link: `/tasks/${t.id}`,
    });
  });
}

// ------------------------------------------------------------------ verify_evidence
export function verifyEvidence(
  s: Session,
  o: { evidenceId: string; accept: boolean; reason?: string | null; method?: 'desk_review' | 'spot_check_visit' | 'cross_source_assessment' },
): { evidenceId: string; status: 'verified' | 'rejected' } {
  const e = one<{
    id: string; case_id: string; task_id: string; submitted_by: string; status: string; evidence_type: string;
  }>('select id, case_id, task_id, submitted_by, status, evidence_type from evidence where id = ?', o.evidenceId);
  if (!e) throw new Refused(`Evidence ${o.evidenceId} does not exist.`, 'not_found');

  loadCaseForWrite(s, e.case_id); // scope check

  if (!hasRole(s, 'beo', 'brc', 'crc', 'deo')) {
    throw new Refused(`A ${actingRole(s)} cannot verify evidence.`, 'role');
  }
  require_(s, 'evidence.verify');

  // Separation of duties: the rule that makes the proof mean anything. Not only the submitter:
  // whoever owns the task, held it before, or handed in proof for it is too close to check it.
  const involved = involvement(s.user_id, e);
  if (involved) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'evidence.verify_refused',
      entityType: 'evidence', entityId: o.evidenceId,
      reason: involved === 'submitted' ? 'submitter cannot verify their own evidence' : `verifier took part in the task (${involved.replace('_', ' ')})`,
      result: 'failure',
    });
    throw new Refused(INVOLVEMENT_MESSAGE[involved], 'separation_of_duties');
  }
  if (e.status !== 'pending') {
    throw new Refused(`This proof has already been ${e.status}.`, 'already_decided');
  }
  if (!o.accept && !o.reason?.trim()) {
    throw new Refused('Sending proof back needs a reason.', 'reason_required');
  }

  const method = o.method ?? 'desk_review';
  return tx(() => {
    run(
      `update evidence set status = ?, verified_by = ?, verified_at = ?, verification_method = ?, rejection_reason = ?
       where id = ?`,
      o.accept ? 'verified' : 'rejected', s.user_id, nowIso(), method,
      o.accept ? null : (o.reason ?? null), o.evidenceId,
    );

    // The task follows its proof: enough verified pieces and the task is verified; a rejection
    // sends the task back to the owner.
    const task = one<{ id: string; proof_count: number; owner_user_id: string; title_en: string; status: string }>(
      'select id, proof_count, owner_user_id, title_en, status from tasks where id = ?', e.task_id,
    );
    if (task) {
      if (o.accept) {
        const verified = one<{ c: number }>(
          `select count(*) c from evidence where task_id = ? and status = 'verified'`, task.id,
        )?.c ?? 0;
        if (verified >= task.proof_count) {
          run(`update tasks set status = 'verified', verified_at = ? where id = ?`, nowIso(), task.id);
        }
      } else {
        run(`update tasks set status = 'sent_back', submitted_at = null where id = ?`, task.id);
        notify({
          userId: task.owner_user_id, kind: 'evidence_rejected',
          title: 'Proof sent back', body: `${task.title_en} — ${o.reason ?? ''}`.trim(),
          entityType: 'task', entityId: task.id, link: `/tasks/${task.id}`,
        });
      }
    }

    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s),
      action: o.accept ? 'evidence.verified' : 'evidence.rejected',
      entityType: 'evidence', entityId: o.evidenceId,
      after: { method }, reason: o.reason ?? null,
    });
    addCaseEvent({
      caseId: e.case_id, actorUserId: s.user_id, actorLabel: s.user_id,
      kind: o.accept ? 'evidence_verified' : 'evidence_rejected',
      summary: o.accept ? `Proof accepted (${method.replace(/_/g, ' ')})` : `Proof sent back: ${o.reason}`,
      related: o.evidenceId,
    });

    return { evidenceId: o.evidenceId, status: o.accept ? 'verified' as const : 'rejected' as const };
  });
}

// ------------------------------------------------------------------ task owner actions
export function acknowledgeTask(s: Session, taskId: string): void {
  tx(() => {
    const t = one<{ id: string; owner_user_id: string; status: string; case_id: string }>(
      'select id, owner_user_id, status, case_id from tasks where id = ?', taskId,
    );
    if (!t) throw new Refused('No such task.', 'not_found');
    if (t.owner_user_id !== s.user_id) throw new Refused('This task is not assigned to you.', 'not_owner');
    if (t.status !== 'assigned') throw new Refused(`This task is already "${t.status}".`, 'wrong_status');
    run(`update tasks set status = 'acknowledged', acknowledged_at = ? where id = ?`, nowIso(), taskId);
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'task.acknowledged',
      entityType: 'task', entityId: taskId, after: { status: 'acknowledged' },
    });
  });
}

export function startTask(s: Session, taskId: string): void {
  tx(() => {
    const t = one<{ id: string; owner_user_id: string; status: string }>(
      'select id, owner_user_id, status from tasks where id = ?', taskId,
    );
    if (!t) throw new Refused('No such task.', 'not_found');
    if (t.owner_user_id !== s.user_id) throw new Refused('This task is not assigned to you.', 'not_owner');
    if (!['assigned', 'acknowledged', 'sent_back'].includes(t.status)) {
      throw new Refused(`This task is "${t.status}" and cannot be started again.`, 'wrong_status');
    }
    run(`update tasks set status = 'in_progress', started_at = coalesce(started_at, ?) where id = ?`, nowIso(), taskId);
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'task.started',
      entityType: 'task', entityId: taskId, after: { status: 'in_progress' },
    });
  });
}

/**
 * Submit a piece of proof against a task.
 *
 * With a photo, the photo's bytes are checked and hashed here; without one, the row carries a
 * hash over the declaration. Where it was handed in is worked out here too: the phone sends its
 * GPS fix (or nothing) and `classifyFix` sets gps_status from the distance to the school. Nothing
 * the form says about the status is read.
 *
 * `clientId` makes a retry safe. A phone that saved the proof offline sends it with the id it
 * made up then; if this submitter already has a row with that id, that row is returned
 * (`duplicate: true`) and nothing new is written, however many times the phone retries.
 */
export function submitEvidence(
  s: Session,
  o: {
    taskId: string; note: string; schoolId?: string | null;
    /** The phone's fix, from navigator.geolocation at the moment of handing in. Untrusted. */
    location?: { lat: unknown; lng: unknown; accuracy: unknown } | null;
    /** Why the phone had no fix ('denied', 'timeout', 'unsupported'), for the record only. */
    locationError?: string | null;
    /** The idempotency key the phone generated when the proof was first saved. */
    clientId?: string | null;
    /** When the phone saved it (its own clock), for proof queued without signal. Recorded, not trusted. */
    savedOfflineAt?: string | null;
    /** A photo of the proof. Its type, size and hash are worked out here, never taken from the form. */
    photo?: { bytes: Uint8Array; name: string } | null;
  },
): { evidenceId: string; duplicate: boolean; gps: GpsResult } {
  const clientId = o.clientId ? String(o.clientId).trim() : null;
  if (clientId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
    throw new Refused('The proof id sent by the phone is not valid.', 'bad_client_id');
  }
  // A retry of proof already on record: answer with that row before anything else is checked,
  // because the first attempt may have moved the task on or used the photo.
  const existing = (): { evidenceId: string; duplicate: boolean; gps: GpsResult } | null => {
    if (!clientId) return null;
    const r = one<{ id: string; task_id: string; gps_status: string; gps_distance_m: number | null; gps_lat: number | null; gps_lng: number | null; gps_accuracy_m: number | null }>(
      'select id, task_id, gps_status, gps_distance_m, gps_lat, gps_lng, gps_accuracy_m from evidence where submitted_by = ? and client_id = ?', s.user_id, clientId,
    );
    if (!r) return null;
    if (r.task_id !== o.taskId) throw new Refused('This proof id was already used for another task.', 'client_id_reused');
    const fix = r.gps_lat !== null && r.gps_lng !== null ? { lat: r.gps_lat, lng: r.gps_lng, accuracy: r.gps_accuracy_m ?? Infinity } : null;
    return {
      evidenceId: r.id, duplicate: true,
      gps: { status: (r.gps_status as GpsStatus) ?? 'unavailable', reason: null, distance_m: r.gps_distance_m, fix },
    };
  };
  const already = existing();
  if (already) return already;

  const photo = o.photo && o.photo.bytes.length > 0 ? checkPhoto(o.photo.bytes, o.photo.name) : null;
  const fix = o.location ? parseFix(o.location.lat, o.location.lng, o.location.accuracy) : null;
  return tx(() => {
    const again = existing(); // another request with the same id won the race
    if (again) return again;
    const t = one<{
      id: string; case_id: string; owner_user_id: string; owner_role: string; status: string;
      proof_type: string; proof_count: number; school_id: string | null; title_en: string;
    }>('select * from tasks where id = ?', o.taskId);
    if (!t) throw new Refused('No such task.', 'not_found');
    if (t.owner_user_id !== s.user_id) throw new Refused('This task is not assigned to you.', 'not_owner');
    require_(s, 'evidence.submit_own');
    if (['verified', 'cancelled'].includes(t.status)) {
      throw new Refused(`This task is "${t.status}"; no more proof is needed.`, 'wrong_status');
    }
    if (!o.note.trim()) throw new Refused('Describe what the proof shows.', 'empty');
    if (photo) {
      const used = photoAlreadyUsed(photo.sha256);
      if (used) {
        throw new Refused(`This exact photo was already submitted as proof for ${used.task_id}. Take a new photo of this work.`, 'duplicate_photo');
      }
    }
    // Judged against the task's own school; a task for all the plan's schools has none to judge by.
    const gps = classifyFix(schoolPosition(t.school_id), fix);

    const n = nextId('evidence', 'EVD-', 6);
    const summary = {
      note: o.note.trim(), declared_by: s.user_id, recorded_on: today(),
      ...(photo ? { photo: { sha256: photo.sha256, bytes: photo.bytes.length, mime: photo.mime } } : {}),
      ...(gps.reason ? { location_unavailable: o.locationError && gps.reason === 'no_fix' ? `${gps.reason}:${String(o.locationError).slice(0, 20)}` : gps.reason } : {}),
      ...(o.savedOfflineAt ? { saved_offline_at: String(o.savedOfflineAt).slice(0, 40) } : {}),
    };
    // With a photo, the evidence's hash is the photo's own; without one, a hash of the declaration.
    const digest = photo ? photo.sha256 : sha(JSON.stringify({ task: o.taskId, ...summary }));

    run(
      `insert into evidence
        (id, task_id, case_id, school_id, evidence_type, file_name, sha256, visit_id, summary,
         submitted_by, submitted_role, submitted_at, gps_status, channel, status,
         verified_by, verified_at, verification_method, rejection_reason, provenance,
         client_id, gps_lat, gps_lng, gps_accuracy_m, gps_distance_m)
       values (?,?,?,?,?,?,?,null,?,?,?,?,?,'app','pending',null,null,null,null,'user_uploaded',?,?,?,?,?)`,
      n, o.taskId, t.case_id, o.schoolId ?? t.school_id, t.proof_type,
      `${o.taskId}-${n}.${photo ? photo.ext : 'pdf'}`, digest, JSON.stringify(summary),
      s.user_id, actingRole(s), nowIso(), gps.status,
      clientId, fix?.lat ?? null, fix?.lng ?? null, fix && Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy) : null, gps.distance_m,
    );
    if (photo) {
      run(
        `insert into evidence_files (evidence_id, sha256, mime, bytes, original_name, created_at) values (?,?,?,?,?,?)`,
        n, photo.sha256, photo.mime, photo.bytes.length, photo.name, nowIso(),
      );
      storePhoto(photo);
    }

    // Rejected proof was sent back, so it does not count towards the pieces the task needs.
    const count = one<{ c: number }>(
      `select count(*) c from evidence where task_id = ? and status <> 'rejected'`, o.taskId,
    )?.c ?? 1;
    if (count >= t.proof_count) {
      run(`update tasks set status = 'submitted', submitted_at = ? where id = ?`, nowIso(), o.taskId);
    } else {
      run(`update tasks set status = 'in_progress', started_at = coalesce(started_at, ?) where id = ?`, nowIso(), o.taskId);
    }

    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'evidence.submitted',
      entityType: 'evidence', entityId: n,
      after: { task_id: o.taskId, sha256: digest, pieces: count, of: t.proof_count, photo: !!photo, gps: gps.status, gps_distance_m: gps.distance_m, client_id: clientId },
    });
    addCaseEvent({
      caseId: t.case_id, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'evidence_submitted',
      summary: `Proof submitted for "${t.title_en}" (${count} of ${t.proof_count})`, related: n,
    });

    // Whoever can verify in this block should see it. Notify the case's accountable officer.
    const owner = one<{ owner_user_id: string }>('select owner_user_id from cases where id = ?', t.case_id);
    if (owner && owner.owner_user_id !== s.user_id) {
      notify({
        userId: owner.owner_user_id, kind: 'evidence_submitted',
        title: 'Proof to check', body: t.title_en,
        entityType: 'evidence', entityId: n, link: `/cases/${t.case_id}#proof`,
      });
    }

    return { evidenceId: n, duplicate: false, gps };
  });
}

// ------------------------------------------------------------------ outcome recompute
/**
 * Re-run the pre-registered outcome check from the raw assessment rows.
 *
 * Nothing is taken from the stored evaluation: the treated and comparison schools come from
 * the plan's pre-registration (locked at approval), and the two rounds' numbers are read back
 * out of assessment_results. This is the same code path as src/domain/outcome.ts, so the app
 * cannot produce a number the seed validator would disagree with.
 */
export interface RecomputeResult {
  evaluationId: string;
  category: string;
  did: number | null;
  closureEligible: boolean;
  blockers: string[];
  baselineRoundId: string;
  followupRoundId: string;
  /** True when this re-derivation reproduced the number that was already on record. */
  agreesWithStored: boolean;
  /** True when this was the first check against a newly arrived round (a new evaluation). */
  newRound: boolean;
}

/**
 * Re-derive a pre-registered outcome check from the raw assessment rows.
 *
 * Nothing is taken from the stored statistics — the two round numbers are read back out of
 * assessment_results and run through src/domain/outcome.ts, the same function the seed
 * validator uses. What *is* taken from the record is the terms of the test, because changing
 * those after the fact is how an evaluation gets talked into saying something it shouldn't:
 *
 *   re-running an existing evaluation reuses that evaluation's own plan, rounds, treated and
 *   comparison schools, success threshold and participation floor. An auditor asking "is this
 *   number right?" gets an answer about that number and not a differently-specified one.
 *
 *   a first evaluation for a plan takes its terms from the plan's pre-registration, locked at
 *   approval, and its rounds from the pre-registration unless a later follow-up round is named
 *   (which is how the November round gets evaluated once it has been uploaded).
 *
 * Why the terms can differ from the pre-registration at all: a follow-up round can arrive too
 * thin to judge, in which case the check is re-run against the next round, and the
 * participation floor in force at evaluation time is the one applied. Several evaluations in
 * the seed went that way. Re-deriving against the pre-registration instead would silently
 * disagree with the published figure.
 */
export function recomputeOutcome(
  s: Session,
  caseId: string,
  opts: { evaluationId?: string; followupRoundId?: string } = {},
): RecomputeResult {
  return tx(() => {
    const c = loadCaseForWrite(s, caseId);
    require_(s, 'outcome.recompute');

    interface StoredEval {
      id: string; plan_id: string; baseline_round_id: string; followup_round_id: string;
      treated: string; comparison: string; success_threshold_pp: number;
      participation_check: string; did_pp: number | null; category: string; cycle: number;
    }
    const stored = opts.evaluationId
      ? one<StoredEval>('select * from outcome_evaluations where id = ? and case_id = ?', opts.evaluationId, caseId)
      : one<StoredEval>(
          `select * from outcome_evaluations where case_id = ? and plan_id = ?
            order by evaluated_at desc limit 1`,
          caseId, c.current_plan_id,
        );
    if (opts.evaluationId && !stored) throw new Refused('No such outcome evaluation on this case.', 'not_found');

    const planId = stored?.plan_id ?? c.current_plan_id;
    if (!planId) throw new Refused('This case has no plan to evaluate.', 'no_plan');

    const plan = one<{ id: string; cycle: number; pre_registration: string; school_ids: string }>(
      'select id, cycle, pre_registration, school_ids from case_plans where id = ?', planId,
    );
    if (!plan) throw new Refused('The plan is missing.', 'no_plan');
    const pre = j<{
      grade: number; competency_id: string; metric_id: string;
      baseline_round_id: string; followup_round_id: string; comparison_school_ids: string[];
      success_threshold_pp: number; participation_floor_ratio: number; settings_version_id: string;
    } | null>(plan.pre_registration, null);
    if (!pre) throw new Refused('This plan has no pre-registered outcome check.', 'no_prereg');

    // The terms of the test.
    const storedTreated = stored ? j<{ school_id: string }[]>(stored.treated, []) : [];
    const storedComparison = stored ? j<{ school_id: string }[]>(stored.comparison, []) : [];
    const storedPart = stored
      ? j<{ floor: number }>(stored.participation_check, { floor: pre.participation_floor_ratio })
      : null;

    const treatedIds = storedTreated.length > 0
      ? storedTreated.map((r) => r.school_id)
      : j<string[]>(plan.school_ids, []);
    const comparisonIds = storedComparison.length > 0
      ? storedComparison.map((r) => r.school_id)
      : pre.comparison_school_ids;
    const baselineRoundId = stored?.baseline_round_id ?? pre.baseline_round_id;
    const followupRoundId = opts.followupRoundId ?? stored?.followup_round_id ?? pre.followup_round_id;
    const threshold = stored?.success_threshold_pp ?? pre.success_threshold_pp;
    const floor = storedPart?.floor ?? pre.participation_floor_ratio;

    if (!one<{ id: string }>('select id from assessment_rounds where id = ?', followupRoundId)) {
      throw new Refused(`Round ${followupRoundId} does not exist.`, 'bad_input');
    }

    /** Read both rounds for a set of schools straight out of assessment_results. */
    const readRows = (ids: string[]): OutcomeSchoolRow[] => {
      if (ids.length === 0) return [];
      const q = ids.map(() => '?').join(',');
      const rows = all<{
        school_id: string; round_id: string; pct_proficient: number; n_assessed: number; participation_rate: number;
      }>(
        `select school_id, round_id, pct_proficient, n_assessed, participation_rate
           from assessment_results
          where school_id in (${q}) and grade = ? and competency_id = ? and round_id in (?, ?)`,
        ...ids, pre.grade, pre.competency_id, baselineRoundId, followupRoundId,
      );
      return ids.map((id) => {
        const b = rows.find((r) => r.school_id === id && r.round_id === baselineRoundId);
        const f = rows.find((r) => r.school_id === id && r.round_id === followupRoundId);
        return {
          school_id: id,
          baseline_pct: b ? b.pct_proficient : null,
          followup_pct: f ? f.pct_proficient : null,
          baseline_n: b ? b.n_assessed : 0,
          followup_n: f ? f.n_assessed : 0,
          baseline_participation: b ? b.participation_rate : null,
          followup_participation: f ? f.participation_rate : null,
        };
      });
    };

    const treatedRows = readRows(treatedIds);
    const comparisonRows = readRows(comparisonIds);
    // The settings the plan locked at approval, so a later change of rules cannot move a verdict.
    const settings = settingsById(pre.settings_version_id) ?? settingsAt(today());
    const result = evaluateOutcome(treatedRows, comparisonRows, {
      success_threshold_pp: threshold,
      participation_floor_ratio: floor,
      min_participation: settings.outcome.min_participation,
    });

    // Delivery and the independent check are facts about the ledger, not about the statistics.
    const unverified = one<{ c: number }>(
      'select count(*) c from tasks where plan_id = ? and verified_at is null', plan.id,
    )?.c ?? 0;
    const crossSource = (one<{ c: number }>(
      'select count(*) c from tasks where plan_id = ? and cross_source = 1 and verified_at is not null', plan.id,
    )?.c ?? 0) > 0;
    const deliveryVerified = unverified === 0;

    const { eligible, blockers } = closureEligibility({
      allTasksVerified: deliveryVerified,
      crossSourceVerified: crossSource,
      outcomeCategory: result.category,
      participationPassed: result.participation_check.passed,
    });

    const payload = [
      JSON.stringify(treatedRows), JSON.stringify(comparisonRows),
      result.treated_baseline_mean, result.treated_followup_mean,
      result.comparison_baseline_mean, result.comparison_followup_mean,
      result.treated_change_pp, result.comparison_change_pp,
      result.did_pp, result.ci_low_pp, result.ci_high_pp, result.ci_method,
      threshold, JSON.stringify(result.participation_check),
      result.category, deliveryVerified ? 1 : 0, crossSource ? 1 : 0, eligible ? 1 : 0,
      JSON.stringify(blockers), result.reasons.join(' ') || OUTCOME_NOTE, 1,
      pre.settings_version_id, nowIso(),
    ];

    // Re-running the same rounds updates that evaluation in place; evaluating a newly arrived
    // round is a new evaluation, so the earlier one stays on the record.
    const inPlace = stored && followupRoundId === stored.followup_round_id;
    let evaluationId: string;
    if (inPlace) {
      evaluationId = stored!.id;
      run(
        `update outcome_evaluations set
           treated = ?, comparison = ?, treated_baseline_mean = ?, treated_followup_mean = ?,
           comparison_baseline_mean = ?, comparison_followup_mean = ?, treated_change_pp = ?,
           comparison_change_pp = ?, did_pp = ?, ci_low_pp = ?, ci_high_pp = ?, ci_method = ?,
           success_threshold_pp = ?, participation_check = ?, category = ?, delivery_verified = ?,
           cross_source_verified = ?, closure_eligible = ?, closure_blockers = ?,
           interpretation_note = ?, is_illustrative = ?, settings_version_id = ?, evaluated_at = ?
         where id = ?`,
        ...payload, evaluationId,
      );
    } else {
      evaluationId = nextIdFor('outcome', 'outcome_evaluations', 'OUT-', 4);
      run(
        `insert into outcome_evaluations
          (id, case_id, plan_id, cycle, grade, competency_id, baseline_round_id, followup_round_id,
           treated, comparison, treated_baseline_mean, treated_followup_mean,
           comparison_baseline_mean, comparison_followup_mean, treated_change_pp, comparison_change_pp,
           did_pp, ci_low_pp, ci_high_pp, ci_method, success_threshold_pp, participation_check,
           category, delivery_verified, cross_source_verified, closure_eligible, closure_blockers,
           interpretation_note, is_illustrative, settings_version_id, evaluated_at, reviewed_by, reviewed_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,null,null)`,
        evaluationId, caseId, plan.id, plan.cycle, pre.grade, pre.competency_id,
        baselineRoundId, followupRoundId, ...payload,
      );
    }

    // Only a re-run of the same rounds can disagree with the record; a new round is a new verdict.
    const agreesWithStored = !inPlace
      || (result.did_pp === stored!.did_pp && result.category === stored!.category);

    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'outcome.recomputed',
      entityType: 'outcome_evaluation', entityId: evaluationId,
      before: stored ? { did_pp: stored.did_pp, category: stored.category } : null,
      after: {
        did_pp: result.did_pp, category: result.category, closure_eligible: eligible,
        baseline_round_id: baselineRoundId, followup_round_id: followupRoundId,
        agrees_with_stored: agreesWithStored,
      },
    });
    addCaseEvent({
      caseId, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'outcome_recomputed',
      summary: (inPlace ? 'Outcome check re-derived from raw rows: ' : `Outcome checked against the new round (${followupRoundId}): `) +
        result.category.replace(/_/g, ' ') +
        (result.did_pp === null ? '' : ` (${result.did_pp > 0 ? '+' : ''}${result.did_pp} pp)`),
      related: plan.id,
    });
    recordJob('outcome_run', 'succeeded', {
      case_id: caseId, evaluation_id: evaluationId, category: result.category,
      did_pp: result.did_pp, baseline_round_id: baselineRoundId, followup_round_id: followupRoundId,
      agrees_with_stored: agreesWithStored,
    });

    return {
      evaluationId, category: result.category, did: result.did_pp,
      closureEligible: eligible, blockers, baselineRoundId, followupRoundId, agreesWithStored,
      newRound: !inPlace,
    };
  });
}

/** An officer signing off that they have read an outcome evaluation. */
export function reviewOutcome(s: Session, outcomeId: string): void {
  tx(() => {
    const o = one<{ id: string; case_id: string }>('select id, case_id from outcome_evaluations where id = ?', outcomeId);
    if (!o) throw new Refused('No such outcome evaluation.', 'not_found');
    loadCaseForWrite(s, o.case_id);
    require_(s, 'outcome.recompute');
    run('update outcome_evaluations set reviewed_by = ?, reviewed_at = ? where id = ?', s.user_id, nowIso(), outcomeId);
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'outcome.reviewed',
      entityType: 'outcome_evaluation', entityId: outcomeId,
    });
  });
}

// ------------------------------------------------------------------ diagnosis conclusion
/** The officer's own note on a diagnosis, kept separate from the AI hypothesis. */
export function setHumanConclusion(s: Session, caseId: string, text: string): void {
  tx(() => {
    loadCaseForWrite(s, caseId);
    require_(s, 'case.edit_diagnosis');
    if (!text.trim()) throw new Refused('Write a conclusion first.', 'empty');
    const d = one<{ id: string; human_conclusion: string | null }>(
      'select id, human_conclusion from diagnoses where case_id = ?', caseId,
    );
    if (!d) throw new Refused('This case has no diagnosis.', 'not_found');
    run(
      'update diagnoses set human_conclusion = ?, human_conclusion_by = ? where id = ?',
      text.trim(), s.user_id, d.id,
    );
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'diagnosis.conclusion_set',
      entityType: 'diagnosis', entityId: d.id,
      before: { human_conclusion: d.human_conclusion }, after: { human_conclusion: text.trim() },
    });
    addCaseEvent({
      caseId, actorUserId: s.user_id, actorLabel: s.user_id, kind: 'diagnosis_updated',
      summary: 'Officer recorded their own conclusion', related: d.id,
    });
  });
}

// ------------------------------------------------------------------ reminder_sweep
export type SweepTrigger = 'manual' | 'startup' | 'hourly' | 'clock_moved' | 'demo_reset' | 'system';

export interface SweepResult {
  remindersSent: number; breachNudges: number; escalationsCreated: number;
  officersTold: number; outboxQueued: number; asOf: string;
}

interface Recipient { id: string; full_name: string; preferred_language: string | null; preferred_channel: string | null; status: string | null }

/**
 * Reaches one person about one task: always the in-app notification, and, for someone who does
 * not use the web app, a message on their own channel (WhatsApp, IVR or SMS) in their language.
 * That message goes to the simulated outbox, marked as not delivered. Returns the channel used.
 */
function reach(
  userId: string,
  task: { id: string; title_en: string; title_hi: string | null; due_date: string },
  inApp: { kind: string; title: string; body: string },
  template: Template,
  ctx: Omit<MessageContext, 'title' | 'due'>,
): { user: string; channel: string; language: string } {
  notify({ userId, kind: inApp.kind, title: inApp.title, body: inApp.body, entityType: 'task', entityId: task.id, link: `/tasks/${task.id}` });
  const u = one<Recipient>('select id, full_name, preferred_language, preferred_channel, status from users where id = ?', userId);
  const channel = outboxChannel(u?.preferred_channel);
  const language = langOf(u?.preferred_language);
  if (!u || !channel || (u.status && u.status !== 'active')) return { user: userId, channel: 'app', language };
  const title = language === 'hi' && task.title_hi ? task.title_hi : task.title_en;
  run(
    `insert into outbox_messages (id, user_id, channel, ts, template, language, body, entity_type, entity_id, delivery_status)
     values (?,?,?,?,?,?,?,?,?,'simulated_not_sent')`,
    nextIdFor('outbox', 'outbox_messages', 'OBX-', 6), userId, channel, nowIso(), template, language,
    messageFor(template, channel, language, { ...ctx, title, due: task.due_date }), 'task', task.id,
  );
  return { user: userId, channel, language };
}

/**
 * Reminders and escalation, three steps per task, each sent once (see reminders.ts):
 *
 *   T−2     a task due within the next two days gets one reminder to its owner
 *   breach  the day after the due date passes without proof, the owner gets one overdue nudge
 *           and the block officer of the case's block is told
 *   +7      seven days after the due date, the district officer gets the escalation
 *
 * Idempotent by design: each step stamps its own column on the task (reminder_sent_at,
 * breach_nudged_at, escalated_at) and skips a task already stamped, so running it any number of
 * times on the same demo date sends nothing more. Every date is the demo clock's, never the wall
 * clock's. If the clock jumps forward past several steps, the sweep catches up in order — the
 * nudge before the escalation — but does not send a T−2 reminder for a task already past due.
 *
 * Without a session it is the scheduled job (scheduler.ts runs it on server start, hourly, and
 * when the demo clock moves). By hand, only the demo admin may run it, because it escalates
 * overdue work across the whole state.
 */
export function reminderSweep(s: Session | null, dateOverride?: string, opts: { trigger?: SweepTrigger } = {}): SweepResult {
  if (s && !(hasRole(s, 'demo_admin') && may(s, 'demo.reset'))) {
    appendAudit({
      actorUserId: s.user_id, actorRole: actingRole(s), action: 'demo.sweep_refused',
      entityType: 'system', entityId: 'reminder_sweep', reason: 'only the demo admin runs the sweep by hand',
      result: 'failure',
    });
    throw new Refused('Only the demo admin can run the reminder sweep by hand. In production it runs on a schedule.', 'role');
  }
  if (dateOverride !== undefined
      && (!/^\d{4}-\d{2}-\d{2}$/.test(dateOverride) || Number.isNaN(Date.parse(dateOverride)))) {
    throw new Refused(`"${dateOverride}" is not a date (YYYY-MM-DD).`, 'bad_input');
  }
  const trigger: SweepTrigger = s ? 'manual' : (opts.trigger ?? 'system');
  const label = `system:reminder_sweep:${trigger}`;
  return tx(() => {
    const day = dateOverride ?? today();
    const dueSoon = addDays(day, 2);
    let outboxQueued = 0;
    const count = (r: { channel: string }) => { if (r.channel !== 'app') outboxQueued++; return r; };

    type T = { id: string; case_id: string; owner_user_id: string; title_en: string; title_hi: string | null; due_date: string };
    const cols = 'id, case_id, owner_user_id, title_en, title_hi, due_date';

    // 1. T−2: due today, tomorrow or the day after, and not reminded yet.
    const toRemind = all<T>(
      `select ${cols} from tasks
        where reminder_sent_at is null and submitted_at is null and due_date >= ? and due_date <= ?
        order by due_date, id`, day, dueSoon,
    );
    for (const t of toRemind) {
      run('update tasks set reminder_sent_at = ? where id = ?', nowIso(), t.id);
      const left = Math.round((Date.parse(t.due_date.slice(0, 10)) - Date.parse(day)) / 86_400_000);
      const sent = count(reach(t.owner_user_id, t, {
        kind: 'deadline_upcoming', title: left === 2 ? 'Due in 2 days' : left === 1 ? 'Due tomorrow' : 'Due today', body: t.title_en,
      }, TEMPLATE.reminder, {}));
      appendAudit({
        actorUserId: null, actorRole: 'system', actorLabel: label, action: 'task.reminder_sent', entityType: 'task', entityId: t.id,
        after: { as_of: day, due_date: t.due_date, sent_to: [sent] }, source: 'system',
      });
    }

    // 2. Breach: the due date has passed without proof. One nudge to the owner, and the block
    //    officer is told. A task already escalated is past this step (the seed's escalations).
    const toNudge = all<T & { block_id: string; owner_name: string }>(
      `select t.id, t.case_id, t.owner_user_id, t.title_en, t.title_hi, t.due_date, c.block_id,
              coalesce(u.full_name, t.owner_user_id) owner_name
         from tasks t join cases c on c.id = t.case_id left join users u on u.id = t.owner_user_id
        where t.breach_nudged_at is null and t.escalated_at is null and t.submitted_at is null and t.due_date < ?
        order by t.due_date, t.id`, day,
    );
    let officersTold = 0;
    for (const t of toNudge) {
      run('update tasks set breach_nudged_at = ? where id = ?', nowIso(), t.id);
      const sentTo = [count(reach(t.owner_user_id, t, { kind: 'task_overdue', title: 'Task overdue', body: t.title_en }, TEMPLATE.breach, {}))];
      const beos = all<{ user_id: string }>(
        `select distinct user_id from user_roles where role = 'beo' and scope_type = 'block' and scope_id = ? and user_id <> ?`,
        t.block_id, t.owner_user_id,
      );
      for (const b of beos) {
        officersTold++;
        sentTo.push(count(reach(b.user_id, t, {
          kind: 'task_overdue', title: 'Overdue in your block', body: `${t.title_en} — ${t.owner_name}, due ${t.due_date.slice(0, 10)}`,
        }, TEMPLATE.breach_officer, { owner: t.owner_name })));
      }
      appendAudit({
        actorUserId: null, actorRole: 'system', actorLabel: label, action: 'task.breach_nudged', entityType: 'task', entityId: t.id,
        after: { as_of: day, due_date: t.due_date, sent_to: sentTo }, source: 'system',
      });
    }

    // 3. +7: seven days past due without proof goes to the district officer.
    const toEscalate = all<T & { district_id: string; owner_name: string; block_name: string | null }>(
      `select t.id, t.case_id, t.owner_user_id, t.title_en, t.title_hi, t.due_date, c.district_id,
              coalesce(u.full_name, t.owner_user_id) owner_name, b.name block_name
         from tasks t join cases c on c.id = t.case_id left join users u on u.id = t.owner_user_id
         left join blocks b on b.id = c.block_id
        where t.escalated_at is null and t.submitted_at is null and date(t.due_date, '+7 day') <= ?
        order by t.due_date, t.id`, day,
    );
    for (const t of toEscalate) {
      run('update tasks set escalated_at = ? where id = ?', nowIso(), t.id);
      const deos = all<{ user_id: string }>(
        `select distinct user_id from user_roles where role = 'deo' and scope_type = 'district' and scope_id = ?`, t.district_id,
      );
      const sentTo = deos.map((d) => count(reach(d.user_id, t, {
        kind: 'escalation', title: 'Escalation: task 7 days overdue', body: t.title_en,
      }, TEMPLATE.escalation, { owner: t.owner_name, block: t.block_name ?? undefined })));
      appendAudit({
        actorUserId: null, actorRole: 'system', actorLabel: label, action: 'task.escalated', entityType: 'task', entityId: t.id,
        after: { as_of: day, due_date: t.due_date, sent_to: sentTo }, source: 'system',
      });
    }

    run(`update tasks set is_overdue = case when due_date < ? and submitted_at is null then 1 else 0 end`, day);

    const result: SweepResult = {
      remindersSent: toRemind.length, breachNudges: toNudge.length, escalationsCreated: toEscalate.length,
      officersTold, outboxQueued, asOf: day,
    };
    // Key order matters: the job lists show the first few.
    recordJob('reminder_sweep', 'succeeded', {
      reminders_sent: result.remindersSent, breach_nudges: result.breachNudges, escalations_created: result.escalationsCreated,
      as_of: day, block_officers_told: officersTold, outbox_messages: outboxQueued, trigger, ran_at: new Date().toISOString(),
    });
    return result;
  });
}

// ------------------------------------------------------------------ notifications
export function markNotificationRead(s: Session, id: string): void {
  run('update notifications set read_at = ? where id = ? and user_id = ? and read_at is null', nowIso(), id, s.user_id);
}

export function markAllRead(s: Session): void {
  run('update notifications set read_at = ? where user_id = ? and read_at is null', nowIso(), s.user_id);
}

// ------------------------------------------------------------------ demo controls
export function demoReset(s: Session): void {
  if (!hasRole(s, 'demo_admin')) throw new Refused('Demo admin only.', 'role');
  require_(s, 'demo.reset');
  restorePristine();
  // The chain restarts from the pristine copy, so this row is the first live one after it.
  appendAudit({
    actorUserId: s.user_id, actorRole: 'demo_admin', action: 'demo.reset',
    entityType: 'system', entityId: 'seed', reason: 'Demo reset to the canonical seed',
  });
}

export function setDemoClock(s: Session, iso: string): void {
  // One clock drives every user's deadlines, SLAs and delegations, so only the demo operator moves it.
  if (!hasRole(s, 'demo_admin')) throw new Refused('Demo admin only.', 'role');
  const before = nowIso();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Refused(`"${iso}" is not a date.`, 'bad_input');
  run(
    `insert into app_state (key, value, updated_at) values ('demo_clock', ?, ?)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    d.toISOString(), new Date().toISOString(),
  );
  appendAudit({
    actorUserId: s.user_id, actorRole: actingRole(s), action: 'demo.clock_set',
    entityType: 'system', entityId: 'demo_clock',
    before: { demo_clock: before }, after: { demo_clock: d.toISOString() },
  });
}
