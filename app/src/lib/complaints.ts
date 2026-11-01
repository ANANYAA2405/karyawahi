import 'server-only';
import { all, one, run, tx, nextSeq, nextIdFor } from './db';
import { and, or, inScope, type Pred } from './scope';
import type { Session } from './session';
import { nowIso, today, addDays, daysBetween } from './clock';
import { appendAudit, notify } from './write';
import { Refused } from './guard';
import { requirePermission } from './authz';
import { managerOf, chainAbove, authorityFor, pathOf, scopeContains, type ScopeType } from './org';
import { getCase } from './cases';

/**
 * Grievance and complaint management.
 *
 * A complaint is its own record — not a case — though it can be linked to one. Routing goes
 * to the reporter's *designated* authority (reporting_lines), unless the category's policy has
 * an explicit rule (e.g. infrastructure → block office; critical teacher absence → district).
 * It moves up only by escalation: a missed SLA, or a handler escalating with a written reason.
 * Restricted complaints are never visible merely because someone is senior, and an officer a
 * complaint is about can neither see nor handle it.
 */

export const STATUS: Record<string, { label: string; tone: 'neutral' | 'pending' | 'active' | 'good' | 'warn' | 'critical'; open: boolean }> = {
  draft: { label: 'Draft', tone: 'neutral', open: true },
  submitted: { label: 'Acknowledgement pending', tone: 'pending', open: true },
  acknowledged: { label: 'Acknowledged', tone: 'active', open: true },
  assigned: { label: 'Assigned', tone: 'active', open: true },
  under_investigation: { label: 'Under investigation', tone: 'active', open: true },
  information_requested: { label: 'Information requested', tone: 'warn', open: true },
  resolution_proposed: { label: 'Resolution proposed', tone: 'pending', open: true },
  awaiting_verification: { label: 'Awaiting verification', tone: 'pending', open: true },
  escalated: { label: 'Escalated', tone: 'critical', open: true },
  reopened: { label: 'Reopened', tone: 'warn', open: true },
  resolved: { label: 'Resolved', tone: 'good', open: false },
  rejected: { label: 'Rejected with reason', tone: 'neutral', open: false },
  closed: { label: 'Closed', tone: 'neutral', open: false },
};
/** The same statuses in Hindi, for the field screens. */
export const STATUS_HI: Record<string, string> = {
  draft: 'मसौदा', submitted: 'पावती लंबित', acknowledged: 'पावती दी गई', assigned: 'सौंपी गई',
  under_investigation: 'जाँच जारी', information_requested: 'जानकारी माँगी गई', resolution_proposed: 'समाधान प्रस्तावित',
  awaiting_verification: 'सत्यापन प्रतीक्षित', escalated: 'आगे बढ़ाई गई', reopened: 'फिर खोली गई',
  resolved: 'हल हुई', rejected: 'कारण सहित अस्वीकृत', closed: 'बंद',
};
export const OPEN_STATUSES = Object.entries(STATUS).filter(([, v]) => v.open).map(([k]) => k);

/** Who may do what from which status. 'assignee' = current authority; 'reporter' = complainant. */
type Actor = 'assignee' | 'reporter';
const T: Record<string, { action: string; label: string; to: string; by: Actor; needsNote?: boolean }[]> = {
  submitted: [
    { action: 'acknowledge', label: 'Acknowledge', to: 'acknowledged', by: 'assignee' },
    { action: 'request_info', label: 'Request information', to: 'information_requested', by: 'assignee', needsNote: true },
    { action: 'reject', label: 'Reject with reason', to: 'rejected', by: 'assignee', needsNote: true },
  ],
  escalated: [
    { action: 'acknowledge', label: 'Acknowledge', to: 'acknowledged', by: 'assignee' },
    { action: 'reject', label: 'Reject with reason', to: 'rejected', by: 'assignee', needsNote: true },
  ],
  acknowledged: [
    { action: 'investigate', label: 'Start investigation', to: 'under_investigation', by: 'assignee' },
    { action: 'request_info', label: 'Request information', to: 'information_requested', by: 'assignee', needsNote: true },
    { action: 'propose', label: 'Propose resolution', to: 'awaiting_verification', by: 'assignee', needsNote: true },
  ],
  assigned: [{ action: 'investigate', label: 'Start investigation', to: 'under_investigation', by: 'assignee' }],
  under_investigation: [
    { action: 'propose', label: 'Propose resolution', to: 'awaiting_verification', by: 'assignee', needsNote: true },
    { action: 'request_info', label: 'Request information', to: 'information_requested', by: 'assignee', needsNote: true },
  ],
  information_requested: [
    { action: 'respond', label: 'Send the information', to: 'under_investigation', by: 'reporter', needsNote: true },
    { action: 'investigate', label: 'Resume investigation', to: 'under_investigation', by: 'assignee' },
  ],
  resolution_proposed: [
    { action: 'request_verification', label: 'Ask the complainant to verify', to: 'awaiting_verification', by: 'assignee' },
    { action: 'confirm', label: 'Confirm it is resolved', to: 'resolved', by: 'reporter' },
  ],
  awaiting_verification: [
    { action: 'confirm', label: 'Confirm it is resolved', to: 'resolved', by: 'reporter' },
    { action: 'dispute', label: 'Not resolved — reopen', to: 'reopened', by: 'reporter', needsNote: true },
  ],
  reopened: [
    { action: 'investigate', label: 'Investigate again', to: 'under_investigation', by: 'assignee' },
    { action: 'propose', label: 'Propose resolution', to: 'awaiting_verification', by: 'assignee', needsNote: true },
  ],
  resolved: [
    { action: 'close', label: 'Close', to: 'closed', by: 'assignee' },
    { action: 'reopen', label: 'Reopen', to: 'reopened', by: 'reporter', needsNote: true },
  ],
  rejected: [{ action: 'reopen', label: 'Appeal — reopen', to: 'reopened', by: 'reporter', needsNote: true }],
  closed: [],
};
/** Statuses from which the current authority may escalate with a written reason. */
const ESCALATABLE = ['submitted', 'escalated', 'acknowledged', 'under_investigation', 'information_requested', 'reopened', 'assigned'];

export interface Complaint {
  id: string; category_key: string; title: string; description: string; reporter_user_id: string; reporter_role: string;
  organisation: string | null; school_id: string | null; cluster_id: string | null; block_id: string | null; district_id: string | null; state_id: string | null;
  priority: string; severity: string; confidentiality: 'standard' | 'restricted'; accused_user_id: string | null;
  status: string; assigned_user_id: string | null; assigned_role: string | null; escalation_level: number; case_id: string | null;
  ack_due: string | null; resolve_due: string | null; acknowledged_at: string | null; resolved_at: string | null; closed_at: string | null;
  resolution_summary: string | null; created_at: string; updated_at: string; provenance: string;
}
export interface ComplaintEvent { id: string; complaint_id: string; ts: string; actor_user_id: string | null; actor_label: string; kind: string; from_status: string | null; to_status: string | null; note: string | null; internal: number; assigned_to: string | null }
export interface Category { key: string; label: string; description: string; route: string; route_level: string | null; confidential_default: number; sort: number }

export const categories = (): Category[] => all<Category>('select * from complaint_categories order by sort');
export const policyFor = (cat: string, pri: string) => one<{ ack_sla_days: number; resolve_sla_days: number; escalate_to: string; critical_direct_level: string | null; notify_roles: string }>(
  'select * from escalation_policies where category_key = ? and priority = ?', cat, pri);

const isOverseer = (s: Session) => s.roles.some((r) => ['state_admin', 'deo', 'beo', 'auditor'].includes(r.role));
const isAuditor = (s: Session) => s.roles.some((r) => r.role === 'auditor');

/** SQL predicate: complaints this user may see at all. */
export function complaintsPred(s: Session, a = 'c'): Pred {
  const cols = { state: `${a}.state_id`, district: `${a}.district_id`, block: `${a}.block_id`, cluster: `${a}.cluster_id`, school: `${a}.school_id` };
  const overseer = { ...s, roles: s.roles.filter((r) => ['state_admin', 'deo', 'beo', 'auditor'].includes(r.role)) };
  const geo = isOverseer(s) ? inScope(overseer, cols) : null;
  // Restricted complaints go to an auditor only for their own area: the state auditor sees them
  // all, a district auditor sees their district's.
  const audited = isAuditor(s) ? inScope({ ...s, roles: s.roles.filter((r) => r.role === 'auditor') }, cols) : null;
  return and(
    { sql: `(${a}.accused_user_id is null or ${a}.accused_user_id <> ?)`, params: [s.user_id] },
    or(
      { sql: `${a}.reporter_user_id = ?`, params: [s.user_id] },
      { sql: `${a}.assigned_user_id = ?`, params: [s.user_id] },
      { sql: `exists (select 1 from complaint_events ce where ce.complaint_id = ${a}.id and ce.assigned_to = ?)`, params: [s.user_id] },
      geo ? and({ sql: `${a}.confidentiality = 'standard'`, params: [] }, geo) : null,
      audited ? and({ sql: `${a}.confidentiality = 'restricted'`, params: [] }, audited) : null,
    ),
  );
}

export type Relation = 'reporter' | 'assignee' | 'past_handler' | 'oversight' | 'auditor';
export function complaintAccess(s: Session, id: string): { complaint: Complaint; relation: Relation } | null {
  const p = complaintsPred(s, 'c');
  const c = one<Complaint>(`select c.* from complaints c where c.id = ? and ${p.sql}`, id, ...p.params);
  if (!c) return null;
  const relation: Relation = c.assigned_user_id === s.user_id ? 'assignee'
    : c.reporter_user_id === s.user_id ? 'reporter'
    : one('select 1 x from complaint_events where complaint_id = ? and assigned_to = ?', id, s.user_id) ? 'past_handler'
    : c.confidentiality === 'restricted' ? 'auditor' : 'oversight';
  return { complaint: c, relation };
}

export interface ComplaintFilter { queue?: 'mine' | 'pending_ack' | 'investigating' | 'overdue' | 'escalated' | 'verification' | 'resolved' | 'submitted_by_me' | 'all'; q?: string; category?: string; limit?: number }

export function listComplaints(s: Session, f: ComplaintFilter = {}): Complaint[] {
  const parts: Pred[] = [complaintsPred(s, 'c')];
  const d = today();
  switch (f.queue) {
    case 'mine': parts.push({ sql: `c.assigned_user_id = ? and c.status in (${OPEN_STATUSES.map(() => '?').join(',')})`, params: [s.user_id, ...OPEN_STATUSES] }); break;
    case 'pending_ack': parts.push({ sql: `c.status in ('submitted','escalated')`, params: [] }); break;
    case 'investigating': parts.push({ sql: `c.status in ('acknowledged','under_investigation','information_requested','assigned','reopened')`, params: [] }); break;
    case 'overdue': parts.push({ sql: `((c.status in ('submitted','escalated') and c.ack_due < ?) or (c.status in (${OPEN_STATUSES.map(() => '?').join(',')}) and c.resolve_due < ?))`, params: [d, ...OPEN_STATUSES, d] }); break;
    case 'escalated': parts.push({ sql: `c.escalation_level > 0 and c.status in (${OPEN_STATUSES.map(() => '?').join(',')})`, params: [...OPEN_STATUSES] }); break;
    case 'verification': parts.push({ sql: `c.status in ('resolution_proposed','awaiting_verification')`, params: [] }); break;
    case 'resolved': parts.push({ sql: `c.status in ('resolved','closed','rejected')`, params: [] }); break;
    case 'submitted_by_me': parts.push({ sql: 'c.reporter_user_id = ?', params: [s.user_id] }); break;
  }
  if (f.category) parts.push({ sql: 'c.category_key = ?', params: [f.category] });
  if (f.q) parts.push({ sql: '(c.title like ? or c.id like ?)', params: [`%${f.q}%`, `%${f.q}%`] });
  const p = and(...parts);
  return all<Complaint>(
    `select c.* from complaints c where ${p.sql}
      order by case c.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               case when c.status in ('submitted','escalated') then 0 else 1 end, c.updated_at desc limit ?`,
    ...p.params, f.limit ?? 200,
  );
}

export function queueCounts(s: Session): Record<NonNullable<ComplaintFilter['queue']>, number> {
  const keys: NonNullable<ComplaintFilter['queue']>[] = ['mine', 'pending_ack', 'investigating', 'overdue', 'escalated', 'verification', 'resolved', 'submitted_by_me', 'all'];
  return Object.fromEntries(keys.map((k) => [k, listComplaints(s, { queue: k, limit: 5000 }).length])) as Record<NonNullable<ComplaintFilter['queue']>, number>;
}

export function complaintEvents(id: string, includeInternal: boolean): ComplaintEvent[] {
  return all<ComplaintEvent>(`select * from complaint_events where complaint_id = ? ${includeInternal ? '' : 'and internal = 0'} order by ts, id`, id);
}

export function availableActions(s: Session, c: Complaint, relation: Relation) {
  const acts = (T[c.status] ?? []).filter((t) => (t.by === 'assignee' ? relation === 'assignee' : relation === 'reporter'));
  const canEscalate = relation === 'assignee' && ESCALATABLE.includes(c.status);
  return { acts, canEscalate };
}

// ---------------------------------------------------------------- routing
export interface Route { assignee: string | null; explicit: string | null }

/**
 * Initial authority for a new complaint. Default: the reporter's designated authority.
 * Explicit category or priority rules may route to a specific level; restricted complaints
 * about an officer skip that officer (and route to the next independent authority).
 */
export function routeFor(reporterId: string, category: string, priority: string, geo: { state_id: string | null; district_id: string | null; block_id: string | null; cluster_id: string | null }, accusedId: string | null): Route {
  const cat = one<Category>('select * from complaint_categories where key = ?', category);
  const pol = policyFor(category, priority);
  let assignee = managerOf(reporterId);
  let explicit: string | null = null;
  const levelId = (lvl: string) => (lvl === 'district' ? geo.district_id : lvl === 'block' ? geo.block_id : lvl === 'cluster' ? geo.cluster_id : geo.state_id);
  if (cat?.route === 'level' && cat.route_level) {
    const a = authorityFor(cat.route_level as ScopeType, levelId(cat.route_level) ?? '');
    if (a && a !== reporterId) { assignee = a; explicit = `Category rule: “${cat.label}” is routed to the ${cat.route_level} office.`; }
  }
  if (priority === 'critical' && pol?.critical_direct_level) {
    const a = authorityFor(pol.critical_direct_level as ScopeType, levelId(pol.critical_direct_level) ?? '');
    if (a && a !== reporterId) { assignee = a; explicit = `Critical priority: policy routes this category directly to the ${pol.critical_direct_level} office.`; }
  }
  if (accusedId) {
    // Conflict of interest: the first authority in the reporter's chain who is not the officer concerned.
    const chain = [managerOf(reporterId), ...chainAbove(reporterId)].filter((x): x is string => !!x);
    assignee = chain.find((u) => u !== accusedId) ?? null;
    explicit = 'Restricted: the complaint concerns an officer in the normal route, so it goes to the next independent authority.';
  }
  if (!assignee || assignee === reporterId) assignee = chainAbove(reporterId).find((u) => u !== accusedId) ?? null;
  return { assignee, explicit };
}

// ---------------------------------------------------------------- writes
function nextComplaintId(): string {
  return nextIdFor('complaint', 'complaints', 'CMP-', 4);
}
function addEvent(cid: string, actor: Session | null, kind: string, from: string | null, to: string | null, note: string | null, internal = 0, assignedTo: string | null = null) {
  const id = nextIdFor('complaint_event', 'complaint_events', 'CEVT-', 5);
  run(`insert into complaint_events values (?,?,?,?,?,?,?,?,?,?,?)`, id, cid, nowIso(), actor?.user_id ?? null, actor?.full_name ?? 'system', kind, from, to, note, internal, assignedTo);
}
const userName = (id: string | null) => (id ? one<{ full_name: string }>('select full_name from users where id = ?', id)?.full_name ?? id : '—');
const roleOfUser = (id: string | null) => (id ? one<{ role: string }>('select role from user_roles where user_id = ? limit 1', id)?.role ?? null : null);

export interface NewComplaint { category: string; title: string; description: string; priority: string; severity: string; schoolId?: string | null; scopeType?: ScopeType; scopeId?: string; restricted?: boolean; accusedUserId?: string | null; caseId?: string | null }

export function createComplaint(s: Session, input: NewComplaint): string {
  requirePermission(s, 'create_complaint');
  const cat = one<Category>('select * from complaint_categories where key = ?', input.category);
  if (!cat) throw new Refused('Choose a category.', 'input');
  if (!['low', 'medium', 'high', 'critical'].includes(input.priority)) throw new Refused('Choose a priority.', 'input');
  const title = input.title.trim().slice(0, 160);
  const desc = input.description.trim().slice(0, 4000);
  if (title.length < 6) throw new Refused('Give the complaint a short title (6+ characters).', 'input');
  if (desc.length < 15) throw new Refused('Describe the problem in a sentence or two.', 'input');

  // Location: a school, or the reporter's own unit. Must be inside the reporter's scope.
  let type: ScopeType = input.schoolId ? 'school' : (input.scopeType ?? (s.scope_type as ScopeType));
  let uid = input.schoolId || input.scopeId || s.scope_id;
  if (!scopeContains(s, type, uid)) throw new Refused('You can only raise a complaint about a place inside your own scope.', 'scope');
  const path = pathOf(type, uid);
  if (!path) throw new Refused('Unknown location.', 'input');

  const restricted = cat.confidential_default === 1 || !!input.restricted;
  const accused = restricted ? (input.accusedUserId || null) : null;
  if (accused && accused === s.user_id) throw new Refused('You cannot raise a complaint about yourself.', 'input');
  // The form offers the officers in the reporter's own reporting line; anyone else would hide the
  // complaint from a person it was never about.
  if (accused && ![managerOf(s.user_id), ...chainAbove(s.user_id)].includes(accused)) {
    throw new Refused('A conduct complaint can name only an officer in your own reporting line.', 'input');
  }
  if (input.caseId && !getCase(s, input.caseId)) throw new Refused('That case is not in your scope.', 'scope');
  const route = routeFor(s.user_id, cat.key, input.priority, { state_id: path.state, district_id: path.district, block_id: path.block, cluster_id: path.cluster }, accused);
  if (!route.assignee) throw new Refused('No designated authority is configured above you. Ask an administrator to set your reporting line.', 'routing');
  const pol = policyFor(cat.key, input.priority)!;
  const d = today();
  return tx(() => {
    const id = nextComplaintId();
    run(`insert into complaints values (${Array(30).fill('?').join(',')})`,
      id, cat.key, title, desc, s.user_id, s.role, null, path.school, path.cluster, path.block, path.district, path.state,
      input.priority, input.severity || 'moderate', restricted ? 'restricted' : 'standard', accused,
      'submitted', route.assignee, roleOfUser(route.assignee), 0, input.caseId || null,
      addDays(d, pol.ack_sla_days), addDays(d, pol.resolve_sla_days), null, null, null, null, nowIso(), nowIso(), 'app');
    addEvent(id, s, 'submitted', 'draft', 'submitted', null, 0, route.assignee);
    if (route.explicit) addEvent(id, null, 'routed', null, null, route.explicit, 1, route.assignee);
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'complaint.submit', entityType: 'complaint', entityId: id, after: { category: cat.key, priority: input.priority, assigned_to: route.assignee, confidentiality: restricted ? 'restricted' : 'standard' } });
    notify({ userId: route.assignee!, kind: 'complaint_assigned', title: `New complaint ${id}: ${title}`, body: `Acknowledge by ${addDays(d, pol.ack_sla_days)}.`, entityType: 'complaint', entityId: id, link: `/complaints/${id}` });
    return id;
  });
}

export function actOnComplaint(s: Session, id: string, action: string, note: string): string {
  const a = complaintAccess(s, id);
  if (!a) throw new Refused('Complaint not found or not visible to you.', 'scope');
  const c = a.complaint;
  const t = (T[c.status] ?? []).find((x) => x.action === action);
  if (!t) throw new Refused(`“${action.replace(/_/g, ' ')}” is not possible while the complaint is “${STATUS[c.status]?.label ?? c.status}”.`, 'state');
  if (t.by === 'assignee' && a.relation !== 'assignee') throw new Refused('Only the authority this complaint is assigned to can do that.', 'role');
  if (t.by === 'reporter' && a.relation !== 'reporter') throw new Refused('Only the person who raised the complaint can do that.', 'role');
  if (t.by === 'assignee') requirePermission(s, 'resolve_complaint');
  const text = note.trim().slice(0, 2000);
  if (t.needsNote && text.length < 5) throw new Refused('A written note is required for this step.', 'input');
  tx(() => {
    const now = nowIso();
    const extra: string[] = [];
    const params: (string | null)[] = [];
    if (action === 'acknowledge') { extra.push('acknowledged_at = ?'); params.push(now); }
    if (action === 'propose') { extra.push('resolution_summary = ?'); params.push(text); }
    if (t.to === 'resolved') { extra.push('resolved_at = ?'); params.push(now); }
    if (t.to === 'closed') { extra.push('closed_at = ?'); params.push(now); }
    if (t.to === 'reopened') { extra.push('resolved_at = null', 'closed_at = null', 'resolve_due = ?'); params.push(addDays(today(), policyFor(c.category_key, c.priority)?.resolve_sla_days ?? 7)); }
    run(`update complaints set status = ?, updated_at = ?${extra.length ? `, ${extra.join(', ')}` : ''} where id = ?`, t.to, now, ...params, id);
    addEvent(id, s, action === 'acknowledge' ? 'acknowledged' : action, c.status, t.to, text || null, 0, null);
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: `complaint.${action}`, entityType: 'complaint', entityId: id, before: { status: c.status }, after: { status: t.to }, reason: text || null });
    const other = t.by === 'assignee' ? c.reporter_user_id : c.assigned_user_id;
    if (other) notify({ userId: other, kind: 'complaint_update', title: `${id}: ${STATUS[t.to]?.label ?? t.to}`, body: text.slice(0, 200) || c.title, entityType: 'complaint', entityId: id, link: `/complaints/${id}` });
  });
  return t.to;
}

/** Escalate to the next designated authority above the current one (skipping a conflicted officer). */
export function escalateComplaint(s: Session | null, id: string, reason: string, auto = false): string | null {
  const c = one<Complaint>('select * from complaints where id = ?', id);
  if (!c) throw new Refused('Complaint not found.', 'scope');
  if (!auto) {
    const a = s ? complaintAccess(s, id) : null;
    if (!a || a.relation !== 'assignee') throw new Refused('Only the authority this complaint is assigned to can escalate it.', 'role');
    requirePermission(s, 'escalate_complaint');
    if (!ESCALATABLE.includes(c.status)) throw new Refused('This complaint cannot be escalated in its current state.', 'state');
    if (reason.trim().length < 8) throw new Refused('Give a written reason for escalating (8+ characters).', 'input');
  }
  const next = c.assigned_user_id ? [managerOf(c.assigned_user_id), ...chainAbove(c.assigned_user_id)].find((u) => u && u !== c.accused_user_id && u !== c.reporter_user_id) ?? null : null;
  if (!next) {
    addEvent(id, s, 'escalation_blocked', c.status, c.status, `No higher designated authority above ${userName(c.assigned_user_id)}. ${reason}`, 1, null);
    return null;
  }
  const pol = policyFor(c.category_key, c.priority);
  tx(() => {
    const d = today();
    run(`update complaints set status = 'escalated', assigned_user_id = ?, assigned_role = ?, escalation_level = escalation_level + 1,
           ack_due = ?, resolve_due = ?, updated_at = ? where id = ?`,
      next, roleOfUser(next), addDays(d, pol?.ack_sla_days ?? 2), addDays(d, pol?.resolve_sla_days ?? 7), nowIso(), id);
    addEvent(id, s, 'escalated', c.status, 'escalated', reason, 0, next);
    appendAudit({ actorUserId: s?.user_id ?? null, actorLabel: s?.full_name ?? 'system:complaint-sla', actorRole: s?.role ?? 'system', action: auto ? 'complaint.escalate_sla' : 'complaint.escalate', entityType: 'complaint', entityId: id, before: { assigned_to: c.assigned_user_id, status: c.status }, after: { assigned_to: next, status: 'escalated' }, reason, source: auto ? 'system' : 'web' });
    notify({ userId: next, kind: 'complaint_escalated', title: `Escalated to you: ${id}`, body: `${c.title}. ${reason}`, entityType: 'complaint', entityId: id, link: `/complaints/${id}` });
    notify({ userId: c.reporter_user_id, kind: 'complaint_update', title: `${id} escalated`, body: `Now with ${userName(next)}.`, entityType: 'complaint', entityId: id, link: `/complaints/${id}` });
  });
  return next;
}

/** SLA sweep: escalate unacknowledged and unresolved complaints past their due dates. Idempotent per day. */
export function complaintSlaSweep(): { ackEscalated: number; resolutionEscalated: number } {
  const d = today();
  let ack = 0, res = 0;
  const late = all<Complaint>(`select * from complaints where status in ('submitted','escalated') and ack_due < ?`, d);
  for (const c of late) {
    if (escalateComplaint(null, c.id, `Acknowledgement SLA missed (due ${c.ack_due}).`, true)) ack++;
  }
  const slow = all<Complaint>(`select * from complaints where status in ('acknowledged','under_investigation','assigned','reopened') and resolve_due < ?`, d);
  for (const c of slow) {
    if (escalateComplaint(null, c.id, `Resolution SLA missed (due ${c.resolve_due}).`, true)) res++;
  }
  return { ackEscalated: ack, resolutionEscalated: res };
}

export function linkCase(s: Session, id: string, caseId: string): void {
  const a = complaintAccess(s, id);
  if (!a || a.relation !== 'assignee') throw new Refused('Only the assigned authority can link a case.', 'role');
  if (!getCase(s, caseId)) throw new Refused('That case is not in your scope.', 'scope');
  tx(() => {
    run('update complaints set case_id = ?, updated_at = ? where id = ?', caseId, nowIso(), id);
    addEvent(id, s, 'linked_case', null, null, `Linked to ${caseId}.`, 0, null);
    appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: 'complaint.link_case', entityType: 'complaint', entityId: id, after: { case_id: caseId } });
  });
}

export const slaState = (c: Complaint, lang: 'en' | 'hi' = 'en'): { label: string; tone: 'crit' | 'warn' | 'ok' | 'none'; days: number | null } => {
  if (!STATUS[c.status]?.open) return { label: '', tone: 'none', days: null };
  const due = ['submitted', 'escalated'].includes(c.status) ? c.ack_due : c.resolve_due;
  if (!due) return { label: '', tone: 'none', days: null };
  const left = daysBetween(today(), due);
  const ack = ['submitted', 'escalated'].includes(c.status);
  if (lang === 'hi') {
    const what = ack ? 'पावती' : 'समाधान';
    return left < 0 ? { label: `${what} में ${-left} दिन विलंब`, tone: 'crit', days: left }
      : left <= 1 ? { label: `${what} ${left === 0 ? 'आज' : 'कल'} तक`, tone: 'warn', days: left }
      : { label: `${what} हेतु ${left} दिन`, tone: 'ok', days: left };
  }
  const what = ack ? 'acknowledge' : 'resolve';
  return left < 0 ? { label: `${-left}d overdue to ${what}`, tone: 'crit', days: left } : left <= 1 ? { label: `${what} ${left === 0 ? 'today' : 'tomorrow'}`, tone: 'warn', days: left } : { label: `${left}d to ${what}`, tone: 'ok', days: left };
};
