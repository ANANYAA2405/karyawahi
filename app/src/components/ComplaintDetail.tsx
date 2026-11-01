import Link from 'next/link';
import type { Session } from '@/lib/session';
import { complaintAccess, complaintEvents, availableActions, categories, STATUS, slaState } from '@/lib/complaints';
import { userNames, scopeName } from '@/lib/repo';
import { Mono, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ComplaintStatus, PriorityChip } from '@/components/complaint-bits';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { complaintActionAction, escalateComplaintAction, linkComplaintCaseAction } from '@/lib/actions';

/**
 * One complaint's content, shared by the full page (/complaints/[id]) and the inbox drawer
 * (/complaints?open=…). Access is resolved here with complaintAccess, so both entry points apply
 * exactly the same rule: the complainant sees status and resolution but never internal notes;
 * the assigned authority sees everything and the actions; oversight is read-only.
 * Returns null when the viewer may not see the complaint.
 */

const RELATION_LABEL = {
  reporter: 'You raised this complaint', assignee: 'This complaint is assigned to you',
  past_handler: 'This complaint was routed through you', oversight: 'Read-only oversight view (inside your scope)', auditor: 'Auditor view of a restricted complaint',
} as const;

export function ComplaintDetail({ session, id, layout = 'page' }: { session: Session; id: string; layout?: 'page' | 'drawer' }) {
  const a = complaintAccess(session, id.toUpperCase());
  if (!a) return null;
  const { complaint: c, relation } = a;
  const internal = relation !== 'reporter';
  const events = complaintEvents(c.id, internal);
  const names = userNames([c.reporter_user_id, c.assigned_user_id ?? '', ...events.map((e) => e.actor_user_id ?? ''), ...events.map((e) => e.assigned_to ?? '')]);
  const cat = categories().find((x) => x.key === c.category_key);
  const { acts, canEscalate } = availableActions(session, c, relation);
  const sla = slaState(c);
  const where = c.school_id ? scopeName('school', c.school_id) : c.cluster_id ? scopeName('cluster', c.cluster_id) : c.block_id ? scopeName('block', c.block_id) : c.district_id ? scopeName('district', c.district_id) : '—';
  const expected = ['submitted', 'escalated'].includes(c.status) ? `Acknowledgement due ${fmtDate(c.ack_due)}` : STATUS[c.status]?.open ? `Resolution due ${fmtDate(c.resolve_due)}` : null;
  const drawer = layout === 'drawer';

  const header = (
    <header className={drawer ? 'border-b border-line px-5 py-4' : 'card p-5 sm:p-6'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-faint"><Mono>{c.id}</Mono> · {cat?.label ?? c.category_key} · {where}</p>
          <h1 className={`mt-0.5 font-semibold leading-tight tracking-tight text-ink ${drawer ? 'text-lg' : 'text-2xl'}`}>{c.title}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ComplaintStatus status={c.status} /><PriorityChip p={c.priority} />
          {c.confidentiality === 'restricted' ? <span className="chip border-crit/30 bg-crit-light text-crit"><Icon name="lock" size={11} />Restricted</span> : null}
          {c.provenance === 'synthetic_demo' ? <span className="chip border-warn/30 bg-warn-light text-warn">Fictional</span> : null}
        </div>
      </div>
      <dl className={`mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm ${drawer ? '' : 'sm:grid-cols-4'}`}>
        <div><dt className="label">Raised by</dt><dd className="mt-0.5 font-medium text-ink">{names.get(c.reporter_user_id)}<span className="block text-xs font-normal uppercase text-ink-faint">{c.reporter_role}</span></dd></div>
        <div><dt className="label">Responsible authority</dt><dd className="mt-0.5 font-medium text-ink">{names.get(c.assigned_user_id ?? '') ?? '—'}<span className="block text-xs font-normal uppercase text-ink-faint">{c.assigned_role}{c.escalation_level ? ` · escalated ×${c.escalation_level}` : ''}</span></dd></div>
        <div><dt className="label">Submitted</dt><dd className="mt-0.5 font-medium text-ink">{fmtDate(c.created_at)}</dd></div>
        <div><dt className="label">Expected response</dt><dd className={`mt-0.5 font-medium ${sla.tone === 'crit' ? 'text-crit' : sla.tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{expected ?? 'Not open'}{sla.label ? <span className="block text-xs font-normal">{sla.label}</span> : null}</dd></div>
      </dl>
      <p className="mt-4 rounded-lg bg-paper-sunk px-3 py-2 text-sm text-ink-soft"><Icon name="info" size={13} className="mr-1 inline" />{RELATION_LABEL[relation]}.</p>
    </header>
  );

  const description = (
    <section className={drawer ? 'border-b border-line px-5 py-4' : 'card p-5'}>
      <h2 className="sub-title">Description</h2>
      <p className="mt-1.5 whitespace-pre-wrap text-base leading-relaxed text-ink-soft">{c.description}</p>
      {c.resolution_summary ? <div className="mt-4 rounded-lg border border-good/30 bg-good-light/60 p-3"><p className="text-sm font-semibold text-good">Resolution</p><p className="text-sm text-ink">{c.resolution_summary}</p></div> : null}
      {c.case_id ? <p className="mt-3 text-sm">Linked case: <Link href={`/cases/${c.case_id}`} className="link">{c.case_id}</Link></p> : null}
    </section>
  );

  const nextStep = (
    <section className={drawer ? 'border-b border-line bg-paper-sunk/50 px-5 py-4' : 'card p-4'}>
      <h2 className="sub-title">Next step</h2>
      {acts.length === 0 && !canEscalate ? (
        <p className="mt-1.5 text-sm text-ink-soft">{relation === 'oversight' || relation === 'auditor' ? 'Read-only: only the assigned authority can act on this complaint.' : relation === 'past_handler' ? 'This complaint has moved on from you.' : STATUS[c.status]?.open ? 'Waiting on the responsible office.' : 'Nothing further to do.'}</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {acts.map((t) => t.needsNote ? (
            <Disclose key={t.action} label={t.label}>
              <ActionForm action={complaintActionAction} hidden={{ complaint_id: c.id, action: t.action }} label={t.label} tone={t.action === 'reject' || t.action === 'dispute' ? 'danger' : 'primary'}>
                <ReasonBox name="note" required label={t.action === 'propose' ? 'Proposed resolution' : t.action === 'request_info' ? 'What do you need?' : 'Note'} rows={3} />
              </ActionForm>
            </Disclose>
          ) : (
            <ActionForm key={t.action} action={complaintActionAction} hidden={{ complaint_id: c.id, action: t.action, note: '' }} label={t.label} tone={t.action === 'confirm' || t.action === 'close' ? 'good' : 'primary'} />
          ))}
          {canEscalate ? (
            <Disclose label="Escalate…" tone="danger">
              <ActionForm action={escalateComplaintAction} hidden={{ complaint_id: c.id }} label="Escalate to next authority" tone="danger">
                <ReasonBox name="reason" required label="Why it needs the next level" rows={3} />
              </ActionForm>
            </Disclose>
          ) : null}
        </div>
      )}
      {relation === 'assignee' && !c.case_id ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium text-ink">Link to a learning case</p>
          <p className="mt-0.5 text-xs text-ink-faint">A complaint stays separate from a case; linking records the relationship.</p>
          <ActionForm action={linkComplaintCaseAction} hidden={{ complaint_id: c.id }} label="Link case" tone="quiet" className="mt-2">
            <input name="case_id" required placeholder="CASE-0184" className="input mb-2 h-9 text-sm" pattern="CASE-\d{4}" />
          </ActionForm>
        </div>
      ) : null}
    </section>
  );

  const timeline = (
    <section className={drawer ? 'px-5 py-4' : 'card overflow-hidden'} aria-label="Timeline">
      <header className={drawer ? 'mb-3' : 'border-b border-line px-5 py-3'}>
        <h2 className="sub-title">Timeline</h2>
        <p className="text-xs text-ink-faint">{internal ? 'Includes internal notes (shaded), which the complainant does not see.' : 'Updates from the responsible office.'} Every step is also in the audit chain.</p>
      </header>
      <ol className={drawer ? '' : 'px-5 py-4'}>
        {events.map((e, i) => (
          <li key={e.id} className={`relative flex gap-3 pb-4 last:pb-0 ${e.internal ? 'rounded-lg bg-paper-sunk px-2 py-1.5' : ''}`}>
            {i < events.length - 1 ? <span className="absolute left-[5px] top-4 h-full w-px bg-line" aria-hidden /> : null}
            <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white ${e.kind === 'escalated' ? 'bg-crit' : e.kind === 'resolved' || e.kind === 'closed' ? 'bg-good' : 'bg-navy-300'}`} />
            <div className="min-w-0">
              <p className="text-sm text-ink">
                <span className="font-medium">{e.kind === 'routed' ? 'Routing rule applied' : e.to_status ? (STATUS[e.to_status]?.label ?? e.to_status) : e.kind.replace(/_/g, ' ')}</span>
                {e.assigned_to ? <span className="text-ink-soft"> → {names.get(e.assigned_to) ?? e.assigned_to}</span> : null}
                {e.internal ? <span className="ml-1.5 chip border-line-strong bg-white text-ink-faint">internal</span> : null}
              </p>
              {e.note ? <p className="text-sm text-ink-soft">{e.note}</p> : null}
              <p className="text-xs text-ink-faint">{e.actor_user_id ? names.get(e.actor_user_id) ?? e.actor_label : e.actor_label} · {fmtDate(e.ts, true)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );

  const rules = (
    <section className={drawer ? 'border-t border-line px-5 py-4 text-sm text-ink-soft' : 'card p-4 text-sm text-ink-soft'}>
      <h2 className="mb-1 text-base font-semibold text-ink">How this complaint moves</h2>
      <ul className="space-y-1">
        <li>• Acknowledge by {fmtDate(c.ack_due)}; otherwise it escalates automatically.</li>
        <li>• Resolve by {fmtDate(c.resolve_due)}; otherwise it escalates to the next designated authority.</li>
        <li>• The authority may escalate earlier with a written reason. Nobody skips a level unless a policy says so.</li>
        {c.confidentiality === 'restricted' ? <li className="text-crit">• Restricted: never visible to the officer it concerns, or to seniors not on its route.</li> : null}
      </ul>
    </section>
  );

  if (drawer) return <div>{header}{nextStep}{description}{timeline}{rules}</div>;
  return (
    <div className="space-y-5">
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,68fr)_minmax(300px,32fr)]">
        <div className="space-y-5">{description}{timeline}</div>
        <aside className="space-y-4 lg:sticky lg:top-[96px] lg:self-start">{nextStep}{rules}</aside>
      </div>
    </div>
  );
}
