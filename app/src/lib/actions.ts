'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, createSession, requireSession, sessionCookieOptions } from './session';
import { isHttps, localPath } from './http';
import { Refused } from './guard';
import * as w from './write';
import { runScheduledSweep } from './scheduler';
import type { CaseStatus } from '@domain/types';

/**
 * Server actions. Thin wrappers: they read the session, hand the arguments to the guarded
 * write layer in write.ts, and turn a refusal into a message on the page the user is on.
 *
 * No authority decisions are made here. A form that posts a case id it should not have is
 * refused by write.ts, because that is where scope, role and the lifecycle are checked.
 */

type State = { error?: string; ok?: string };

/** Run a write and come back with either a confirmation or the reason it was refused. */
async function attempt(fn: () => void | Promise<void>, ok: string): Promise<State> {
  try {
    await fn();
    return { ok };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    // An unexpected failure is a bug, not a refusal; say so plainly rather than silently.
    return { error: `The change could not be saved: ${(e as Error).message}` };
  }
}

const str = (f: FormData, k: string): string => String(f.get(k) ?? '').trim();

// ------------------------------------------------------------------ case lifecycle
export async function transitionAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const to = str(form, 'to') as CaseStatus;
  const reason = str(form, 'reason');
  const res = await attempt(
    () => { w.transitionCase(s, caseId, to, reason || null); },
    `Case moved to "${to.replace(/_/g, ' ')}".`,
  );
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  // A refusal keeps the form on screen to show why. A success often removes the very panel
  // the button lived in — a decided case no longer offers a decision — so the confirmation
  // travels in the URL instead of dying with the component that would have displayed it.
  if (res.ok) redirect(`/cases/${caseId}?done=${encodeURIComponent(res.ok)}`);
  return res;
}

export async function decidePlanAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const planId = str(form, 'plan_id');
  const decision = str(form, 'decision') as 'approved' | 'rejected' | 'revision_requested' | 'approved_for_pab';
  const reason = str(form, 'reason');
  const res = await attempt(
    () => { w.decidePlan(s, { caseId, planId, decision, reason: reason || null }); },
    decision === 'approved' ? 'Plan approved. The work can now be assigned.'
      : decision === 'approved_for_pab' ? 'Referred to the PAB.'
      : decision === 'revision_requested' ? 'Sent back for changes.'
      : 'Plan rejected; the case returns to investigation.',
  );
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/approvals');
  if (res.ok) redirect(`/cases/${caseId}?done=${encodeURIComponent(res.ok)}`);
  return res;
}

// ------------------------------------------------------------------ plan composer
/** Save a composed plan, and submit it for approval when the officer pressed that button. A
 *  refused submission leaves the saved draft in place and says so. */
export async function composePlanAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const submit = str(form, 'intent') === 'submit';
  let saved = false;
  const res = await attempt(() => {
    w.draftPlan(s, {
      caseId,
      interventionId: str(form, 'intervention_id'),
      schoolIds: str(form, 'school_ids').split(',').filter(Boolean),
      rationale: str(form, 'rationale'),
      caseVersion: Number(str(form, 'case_version')),
    });
    saved = true;
    if (submit) w.transitionCase(s, caseId, 'awaiting_approval');
  }, submit ? 'Plan saved and submitted. Another officer now has to approve it.' : 'Plan saved as a draft. Submit it from the case when it is ready.');
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/approvals');
  if (res.ok) redirect(`/cases/${caseId}?done=${encodeURIComponent(res.ok)}#plan`);
  if (saved) {
    redirect(`/cases/${caseId}?done=${encodeURIComponent(`Plan saved as a draft, but not submitted: ${res.error}`)}#plan`);
  }
  return res;
}

/** Turn an approved plan into tasks, with the owners and due dates the officer settled on. */
export async function assignTasksAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const rows = form.getAll('row').map(String).map((rowKey) => ({
    rowKey,
    ownerUserId: str(form, `owner:${rowKey}`),
    dueDate: str(form, `due:${rowKey}`),
  }));
  let count = 0;
  const res = await attempt(() => {
    count = w.assignTasks(s, { caseId, caseVersion: Number(str(form, 'case_version')), rows }).taskIds.length;
  }, 'Tasks assigned.');
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/tasks');
  if (res.ok) redirect(`/cases/${caseId}?done=${encodeURIComponent(`${count} tasks assigned. Each owner has been notified.`)}#work`);
  return res;
}

/** Give a task to someone else, with the reason kept on the record. */
export async function reassignTaskAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const taskId = str(form, 'task_id');
  const res = await attempt(() => {
    w.reassignTask(s, {
      taskId, newOwnerUserId: str(form, 'owner'), reason: str(form, 'reason'),
      taskVersion: Number(str(form, 'task_version')),
    });
  }, 'Task reassigned. Both the new and the previous owner have been told.');
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  if (res.ok) redirect(`/tasks/${taskId}?done=${encodeURIComponent(res.ok)}`);
  return res;
}

export async function setConclusionAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const res = await attempt(
    () => { w.setHumanConclusion(s, caseId, str(form, 'text')); },
    'Your conclusion has been recorded alongside the AI hypothesis.',
  );
  revalidatePath(`/cases/${caseId}`);
  return res;
}

// ------------------------------------------------------------------ evidence
export async function verifyEvidenceAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const evidenceId = str(form, 'evidence_id');
  const accept = str(form, 'accept') === 'yes';
  const method = (str(form, 'method') || 'desk_review') as 'desk_review' | 'spot_check_visit' | 'cross_source_assessment';
  const res = await attempt(
    () => { w.verifyEvidence(s, { evidenceId, accept, reason: str(form, 'reason') || null, method }); },
    accept ? 'Proof accepted.' : 'Proof sent back to the person who submitted it.',
  );
  revalidatePath('/evidence');
  const caseId = str(form, 'case_id');
  if (caseId) revalidatePath(`/cases/${caseId}`);
  return res;
}

export async function submitEvidenceAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const taskId = str(form, 'task_id');
  const file = form.get('photo');
  const photo = file instanceof File && file.size > 0
    ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }
    : null;
  // Where it was handed in comes from the phone's GPS fix (lat, lng, accuracy); the server works
  // out the distance to the school and sets the status. A "gps" field in the form is not read.
  let where = '';
  const res = await attempt(
    () => {
      const r = w.submitEvidence(s, {
        taskId,
        note: str(form, 'note'),
        schoolId: str(form, 'school_id') || null,
        location: { lat: str(form, 'lat'), lng: str(form, 'lng'), accuracy: str(form, 'accuracy') },
        locationError: str(form, 'gps_error') || null,
        clientId: str(form, 'client_id') || null,
        photo,
      });
      where = r.gps.status === 'matched' ? ' GPS: at the school.'
        : r.gps.status === 'outside_radius' && r.gps.distance_m !== null ? ` GPS: ${r.gps.distance_m >= 1000 ? `${(r.gps.distance_m / 1000).toFixed(1)} km` : `${r.gps.distance_m} m`} from the school.`
        : ' GPS: not available.';
    },
    photo ? 'Proof and photo submitted. Someone other than you has to check it.' : 'Proof submitted. Someone other than you has to check it.',
  );
  if (res.ok) res.ok += where;
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/today');
  return res;
}

// ------------------------------------------------------------------ tasks
export async function acknowledgeTaskAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const taskId = str(form, 'task_id');
  const res = await attempt(() => { w.acknowledgeTask(s, taskId); }, 'Marked as seen.');
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/today');
  return res;
}

export async function startTaskAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const taskId = str(form, 'task_id');
  const res = await attempt(() => { w.startTask(s, taskId); }, 'Marked as started.');
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/today');
  return res;
}

// ------------------------------------------------------------------ outcomes
export async function recomputeOutcomeAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const evaluationId = str(form, 'evaluation_id');
  const followupRoundId = str(form, 'followup_round_id');
  let detail = '';
  const res = await attempt(
    () => {
      const r = w.recomputeOutcome(s, caseId, {
        evaluationId: evaluationId || undefined,
        followupRoundId: followupRoundId || undefined,
      });
      const did = r.did === null ? 'no estimate' : `${r.did > 0 ? '+' : ''}${r.did} pp`;
      detail = r.newRound
        ? `Checked against ${r.followupRoundId}: ${did}, ${r.category.replace(/_/g, ' ')}. Saved as a new outcome check; earlier checks stay on the record.`
        : r.agreesWithStored
        ? `Re-derived from the raw assessment rows: ${r.did === null ? 'no estimate' : `${r.did > 0 ? '+' : ''}${r.did} pp`}, ${r.category.replace(/_/g, ' ')}. This matches what was on record.`
        : `Re-derived from the raw assessment rows: ${r.did === null ? 'no estimate' : `${r.did > 0 ? '+' : ''}${r.did} pp`}, ${r.category.replace(/_/g, ' ')}. This DIFFERS from what was on record — the evaluation has been updated.`;
    },
    '',
  );
  revalidatePath(`/cases/${caseId}`);
  return res.error ? res : { ok: detail };
}

export async function reviewOutcomeAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const res = await attempt(
    () => { w.reviewOutcome(s, str(form, 'outcome_id')); },
    'Signed off as read.',
  );
  revalidatePath(`/cases/${caseId}`);
  return res;
}

// ------------------------------------------------------------------ notifications
export async function markReadAction(form: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(form.get('notification_id') ?? '');
  if (id === 'all') w.markAllRead(s);
  else if (id) w.markNotificationRead(s, id);
  revalidatePath('/notifications');
  const to = String(form.get('then') ?? '');
  if (to) redirect(localPath(to));
}

// ------------------------------------------------------------------ demo controls
export async function reminderSweepAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  let detail = '';
  const res = await attempt(
    () => {
      const r = w.reminderSweep(s, str(form, 'as_of') || undefined);
      detail = `Sweep finished: ${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'} sent, `
        + `${r.breachNudges} overdue nudge${r.breachNudges === 1 ? '' : 's'} sent, `
        + `${r.escalationsCreated} escalation${r.escalationsCreated === 1 ? '' : 's'} raised. `
        + 'Running it again today will send nothing further.';
    },
    '',
  );
  revalidatePath('/admin');
  revalidatePath('/admin/jobs');
  return res.error ? res : { ok: detail };
}

export async function setClockAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const date = str(form, 'date');
  const res = await attempt(
    () => { w.setDemoClock(s, `${date}T06:30:00.000Z`); },
    `The demo clock is now ${date}. Overdue counts and reminder windows move with it.`,
  );
  // Deadlines follow the demo clock, so reminders due on the new date go out now, not at the next hourly run.
  if (res.ok) {
    const r = runScheduledSweep('clock_moved');
    if (r && res.ok) {
      res.ok += ` The reminder sweep ran for the new date: ${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'}, `
        + `${r.breachNudges} overdue nudge${r.breachNudges === 1 ? '' : 's'}, ${r.escalationsCreated} escalation${r.escalationsCreated === 1 ? '' : 's'}.`;
    }
  }
  revalidatePath('/', 'layout');
  return res;
}

export async function demoResetAction(_prev: State, _form: FormData): Promise<State> {
  const s = await requireSession();
  const res = await attempt(
    () => { w.demoReset(s); },
    'The demo has been restored to the canonical seed, and the reset itself is in the audit log.',
  );
  // The reset replaced the database, sessions table included, which signed everyone out.
  // Keep the admin who pressed the button signed in.
  if (res.ok) {
    runScheduledSweep('demo_reset');
    const h = await headers();
    (await cookies()).set(SESSION_COOKIE, createSession(s.user_id, h.get('user-agent')), sessionCookieOptions(isHttps(h)));
  }
  revalidatePath('/', 'layout');
  return res;
}

// ------------------------------------------------------------------ blockers
export async function reportBlockerAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { reportBlocker } = await import('./blockers');
  const taskId = str(form, 'task_id');
  let id = '';
  const res = await attempt(() => {
    id = reportBlocker(s, { taskId, type: str(form, 'type'), severity: str(form, 'severity'), description: str(form, 'description') });
  }, 'Blocker recorded.');
  if (res.ok) res.ok = `Blocker ${id} recorded and written to the audit trail.`;
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/execution');
  return res;
}

export async function updateBlockerAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { updateBlocker } = await import('./blockers');
  const action = str(form, 'action') === 'escalate' ? 'escalate' : 'resolve';
  const res = await attempt(() => updateBlocker(s, str(form, 'blocker_id'), action, str(form, 'note')),
    action === 'escalate' ? 'Blocker escalated to the next level.' : 'Blocker marked resolved.');
  revalidatePath('/execution');
  return res;
}

// ------------------------------------------------------------------ reports
export async function generateReportAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { buildReport, saveReport } = await import('./reports');
  const bool = (k: string) => form.get(k) === '1';
  let id = '';
  const res = await attempt(() => {
    const r = buildReport(s, {
      type: str(form, 'type') as never,
      from: str(form, 'from') || undefined, to: str(form, 'to') || undefined,
      includeEvidence: bool('include_evidence'), includeUnresolved: bool('include_unresolved'),
      includeDataQuality: bool('include_dq'), includeSummary: bool('include_summary'),
    });
    if (!r) throw new Refused('Your role cannot generate reports.', 'role');
    id = saveReport(s, r);
  }, 'Report generated.');
  revalidatePath('/reports');
  if (res.ok) redirect(`/reports/${id}?generated=1`);
  return res;
}

// ------------------------------------------------------------------ complaints
export async function createComplaintAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { createComplaint } = await import('./complaints');
  let id = '';
  const res = await attempt(() => {
    id = createComplaint(s, {
      category: str(form, 'category'), title: str(form, 'title'), description: str(form, 'description'),
      priority: str(form, 'priority'), severity: str(form, 'severity') || 'moderate',
      schoolId: str(form, 'school_id') || null, restricted: form.get('restricted') === '1',
      accusedUserId: str(form, 'accused_user_id') || null, caseId: str(form, 'case_id') || null,
    });
  }, 'Complaint submitted.');
  revalidatePath('/complaints');
  if (res.ok) redirect(`/complaints/${id}?submitted=1`);
  return res;
}

export async function complaintActionAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { actOnComplaint, STATUS } = await import('./complaints');
  const id = str(form, 'complaint_id');
  let to = '';
  const res = await attempt(() => { to = actOnComplaint(s, id, str(form, 'action'), str(form, 'note')); }, 'Done.');
  if (res.ok) res.ok = `Updated: now "${STATUS[to]?.label ?? to}".`;
  revalidatePath(`/complaints/${id}`);
  revalidatePath('/complaints');
  return res;
}

export async function escalateComplaintAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { escalateComplaint } = await import('./complaints');
  const id = str(form, 'complaint_id');
  let to: string | null = null;
  const res = await attempt(() => { to = escalateComplaint(s, id, str(form, 'reason'), false); }, 'Escalated.');
  if (res.ok) res.ok = to ? 'Escalated to the next designated authority.' : 'There is no higher designated authority; the attempt was recorded.';
  revalidatePath(`/complaints/${id}`);
  revalidatePath('/complaints');
  return res;
}

export async function linkComplaintCaseAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { linkCase } = await import('./complaints');
  const id = str(form, 'complaint_id');
  const res = await attempt(() => linkCase(s, id, str(form, 'case_id').toUpperCase()), 'Case linked.');
  revalidatePath(`/complaints/${id}`);
  revalidatePath('/complaints');
  return res;
}

export async function complaintSweepAction(_prev: State, _form: FormData): Promise<State> {
  const s = await requireSession();
  const { complaintSlaSweep } = await import('./complaints');
  const { may: canDo } = await import('./guard');
  if (!canDo(s, 'demo.reset') && !canDo(s, 'settings.configure')) return { error: 'Only the system or demo administrator can run the sweep by hand.' };
  let r = { ackEscalated: 0, resolutionEscalated: 0 };
  const res = await attempt(() => { r = complaintSlaSweep(); }, 'Sweep complete.');
  if (res.ok) res.ok = `Complaint SLA sweep: ${r.ackEscalated} escalated for missed acknowledgement, ${r.resolutionEscalated} for missed resolution.`;
  revalidatePath('/complaints');
  return res;
}

// ------------------------------------------------------------------ onboarding & accounts
export async function registerAction(_prev: State, form: FormData): Promise<State> {
  const { createRegistration } = await import('./onboarding');
  let out = { id: '', code: '' };
  const res = await attempt(() => {
    out = createRegistration({
      fullName: str(form, 'full_name'), email: str(form, 'email'), mobile: str(form, 'mobile') || undefined,
      organisation: str(form, 'organisation') || undefined, role: str(form, 'role'),
      scopeType: str(form, 'scope_type'), scopeId: str(form, 'scope_id'), affiliationRef: str(form, 'affiliation_ref') || undefined,
    });
  }, 'Request created.');
  if (res.ok) {
    // The demo shows the code on screen instead of emailing it; it goes in a cookie for this
    // browser, never in the address (see reg-code.ts).
    const { rememberDemoCode, rememberRequest } = await import('./reg-code');
    await rememberDemoCode(out.id, out.code);
    await rememberRequest(out.id, str(form, 'email'));
    redirect(`/register/status?id=${out.id}`);
  }
  return res;
}

export async function verifyEmailAction(_prev: State, form: FormData): Promise<State> {
  const { verifyEmail } = await import('./onboarding');
  const id = str(form, 'id'); const email = str(form, 'email');
  const res = await attempt(() => verifyEmail(id, email, str(form, 'code')), 'Email verified.');
  if (res.ok) {
    const { forgetDemoCode } = await import('./reg-code');
    await forgetDemoCode();
    redirect(`/register/status?id=${id}`);
  }
  return res;
}

export async function affiliationAction(_prev: State, form: FormData): Promise<State> {
  const { checkAffiliation } = await import('./onboarding');
  const id = str(form, 'id'); const email = str(form, 'email');
  let r = { passed: false, message: '' };
  try { r = checkAffiliation(id, email, str(form, 'affiliation_ref') || undefined); }
  catch (e) { return { error: e instanceof Refused ? e.message : (e as Error).message }; }
  if (!r.passed) return { error: r.message };
  redirect(`/register/status?id=${id}`);
}

export async function respondInfoAction(_prev: State, form: FormData): Promise<State> {
  const { respondToInfo } = await import('./onboarding');
  const id = str(form, 'id'); const email = str(form, 'email');
  const res = await attempt(() => respondToInfo(id, email, str(form, 'response')), 'Sent to the verifier.');
  if (res.ok) redirect(`/register/status?id=${id}`);
  return res;
}

/** Look a request up by reference and email; the email goes into a cookie, not the address. */
export async function lookupRequestAction(_prev: State, form: FormData): Promise<State> {
  const { publicRequest } = await import('./onboarding');
  const r = publicRequest(str(form, 'id'), str(form, 'email'));
  if (!r) return { error: 'No request matches that reference and email.' };
  const { rememberRequest } = await import('./reg-code');
  await rememberRequest(r.id, r.email);
  redirect(`/register/status?id=${r.id}`);
}

export async function decideRegistrationAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { decideRegistration } = await import('./onboarding');
  const action = str(form, 'action') as 'approve' | 'reject' | 'request_info' | 'reassign';
  let created: string | null = null;
  const res = await attempt(() => { created = decideRegistration(s, str(form, 'id'), action, str(form, 'reason'), str(form, 'reassign_to') || undefined); }, 'Done.');
  if (res.ok) res.ok = action === 'approve' ? `Approved${created ? ` - account ${created} is active.` : '.'}` : action === 'reject' ? 'Rejected; the applicant sees your reason.' : action === 'request_info' ? 'Information requested from the applicant.' : 'Verifier reassigned.';
  revalidatePath('/admin/accounts');
  return res;
}

export async function requestChangeAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { requestChange } = await import('./onboarding');
  let id = '';
  const res = await attempt(() => { id = requestChange(s, str(form, 'role'), str(form, 'scope_type'), str(form, 'scope_id'), str(form, 'reason')); }, 'Requested.');
  if (res.ok) res.ok = `Change request ${id} sent to your designated verifier. Nothing changes until it is approved.`;
  revalidatePath('/account');
  return res;
}

export async function accountStatusAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { requirePermission } = await import('./authz');
  const { setAccountStatus } = await import('./org');
  const userId = str(form, 'user_id');
  const to = str(form, 'to') as 'active' | 'suspended' | 'deactivated';
  const reason = str(form, 'reason');
  const res = await attempt(() => {
    requirePermission(s, 'manage_users', { kind: 'user', userId });
    if (!['active', 'suspended', 'deactivated'].includes(to)) throw new Refused('Unknown status.', 'input');
    if (reason.length < 5) throw new Refused('A written reason is required.', 'input');
    setAccountStatus(s, userId, to, reason);
  }, `Account is now ${to}.`);
  revalidatePath('/admin/accounts');
  return res;
}

export async function setManagerAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { requirePermission } = await import('./authz');
  const { setManager } = await import('./org');
  const userId = str(form, 'user_id');
  const managerId = str(form, 'manager_id') || null;
  const res = await attempt(() => {
    requirePermission(s, 'manage_hierarchy', { kind: 'user', userId });
    setManager(s, userId, managerId, str(form, 'reason') || 'Reporting line updated');
  }, 'Reporting line updated.');
  revalidatePath('/admin/hierarchy');
  return res;
}

export async function delegationAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const { requirePermission } = await import('./authz');
  const org = await import('./org');
  const op = str(form, 'op');
  const res = await attempt(() => {
    if (op === 'revoke') {
      const d = org.listDelegations(() => true).find((x) => x.id === str(form, 'id'));
      if (!d) throw new Refused('Unknown delegation.', 'input');
      requirePermission(s, 'manage_hierarchy', { kind: 'scope', type: d.scope_type, id: d.scope_id });
      org.revokeDelegation(s, d.id, str(form, 'reason') || 'Revoked');
      return;
    }
    const from = org.userCard(str(form, 'from_user_id'));
    const to = org.userCard(str(form, 'to_user_id'));
    if (!from || !to) throw new Refused('Choose both officers.', 'input');
    requirePermission(s, 'manage_hierarchy', { kind: 'user', userId: from.id });
    requirePermission(s, 'manage_hierarchy', { kind: 'user', userId: to.id });
    if (from.id === to.id) throw new Refused('An officer cannot delegate to themselves.', 'input');
    if (org.ROLE_RANK[to.role] < org.ROLE_RANK[from.role] - 1) throw new Refused('Acting charge can only go to someone at most one level junior.', 'input');
    const starts = str(form, 'starts_on'); const ends = str(form, 'ends_on');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends) || ends < starts) throw new Refused('Give a valid date range.', 'input');
    const reason = str(form, 'reason');
    if (reason.length < 8) throw new Refused('Give the reason for the acting arrangement.', 'input');
    org.createDelegation(s, { from_user_id: from.id, to_user_id: to.id, role: from.role, scope_type: from.scope_type, scope_id: from.scope_id, starts_on: starts, ends_on: ends, reason });
  }, op === 'revoke' ? 'Delegation revoked.' : 'Acting arrangement created.');
  revalidatePath('/admin/hierarchy');
  return res;
}
