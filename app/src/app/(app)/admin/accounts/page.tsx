import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { can, authorize } from '@/lib/authz';
import { verificationQueue, canDecide, REG_STATUS } from '@/lib/onboarding';
import { scopeName, userNames } from '@/lib/repo';
import { managerOf, statusHistory, usersInArea } from '@/lib/org';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { decideRegistrationAction, accountStatusAction } from '@/lib/actions';
import { ROLE_LABELS } from '@domain/permissions';

/**
 * Accounts: the approval queue for registration and change requests routed to this officer, and
 * the accounts they may manage (junior roles inside their scope). Every decision needs the
 * authority it implies, and is audited; nobody can act on their own account.
 */

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;
  if (!can(session, 'approve_accounts') && !can(session, 'manage_users')) {
    return <div className="mx-auto max-w-2xl"><PageHead title="Accounts" /><Callout tone="warn">Your role does not approve or manage accounts.</Callout></div>;
  }
  const tab = sp.tab === 'users' ? 'users' : 'queue';
  const queue = verificationQueue(session);
  const open = queue.filter((r) => ['approval_pending', 'info_requested', 'institutional_verification_pending', 'email_verification_pending'].includes(r.status));
  const names = userNames([...queue.map((r) => r.verifier_user_id ?? ''), ...queue.map((r) => r.decided_by ?? '')]);
  const isDemoAdmin = session.roles.some((r) => r.role === 'demo_admin');

  const q = (sp.q ?? '').trim().slice(0, 60);
  // People inside the officer's area only; the officers above them are not theirs to manage.
  const users = tab === 'users' ? usersInArea(session, q) : [];

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/admin" className="link">Administration</Link>}
        title={pick(lang, 'Accounts & approvals', 'खाते व स्वीकृतियाँ')}
        sub={pick(lang, 'Approve only what you are responsible for: roles junior to yours, in places inside your scope.', 'केवल अपने दायरे में, अपने से कनिष्ठ भूमिकाएँ स्वीकृत करें।')}
        right={<Link href="/register" className="btn-quiet"><Icon name="plus" size={15} />Registration form</Link>}
      />
      <nav className="-mx-1 flex gap-1 border-b border-line px-1" aria-label="Account views">
        {[['queue', `Approval queue`, open.length], ['users', 'Manage accounts', null]].map(([k, l, n]) => (
          <Link key={String(k)} href={`/admin/accounts?tab=${k}`} aria-current={tab === k ? 'page' : undefined} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${tab === k ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {l}{n !== null ? <span className={`tnum rounded-full px-1.5 text-2xs font-semibold ${tab === k ? 'bg-brand text-white' : 'bg-paper-deep text-ink-soft'}`}>{n}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === 'queue' ? (
        queue.length === 0 ? <div className="card px-6 py-12 text-center text-sm text-ink-faint">No requests routed to you.</div> : (
          <ul className="space-y-3">
            {queue.map((r) => {
              const d = canDecide(session, r);
              const decidable = d.allowed && ['approval_pending', 'info_requested'].includes(r.status);
              return (
                <li key={r.id} className="card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-md font-semibold text-ink">{r.full_name} <span className="text-xs font-normal text-ink-faint">· {r.email}</span></p>
                      <p className="mt-0.5 text-sm text-ink-soft">{r.request_type === 'change' ? 'Change request: ' : 'Requests '}<strong className="text-ink">{ROLE_LABELS[r.requested_role]?.en ?? r.requested_role}</strong> at {scopeName(r.scope_type, r.scope_id)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                        <span className={`chip ${r.status === 'approval_pending' ? 'border-warn/30 bg-warn-light text-warn' : r.status === 'active' ? 'border-good/30 bg-good-light text-good' : r.status === 'rejected' ? 'border-crit/30 bg-crit-light text-crit' : 'border-pend/30 bg-pend-light text-pend'}`}>{REG_STATUS[r.status]?.label ?? r.status}</span>
                        <span className="chip border-line-strong bg-paper-sunk text-ink-soft">Ref {r.affiliation_ref ?? '—'}</span>
                        {r.duplicate_of ? <span className="chip border-crit/30 bg-crit-light text-crit"><Icon name="alert" size={11} />Duplicate of an existing account</span> : null}
                        {r.provenance === 'synthetic_demo' ? <span className="chip border-warn/30 bg-warn-light text-warn">Fictional</span> : null}
                        {isDemoAdmin && r.status === 'email_verification_pending' ? <span className="chip border-line-strong bg-white text-ink-soft">Demo code {r.email_code}</span> : null}
                      </div>
                      <p className="mt-1.5 text-xs text-ink-faint"><span className="font-mono">{r.id}</span> · submitted {fmtDate(r.created_at)} · verifier {names.get(r.verifier_user_id ?? '') ?? 'not yet assigned'}{r.decided_by ? ` · decided by ${names.get(r.decided_by) ?? r.decided_by}` : ''}</p>
                      {r.info_request ? <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-paper-sunk px-2.5 py-1.5 text-sm text-ink-soft">{r.info_request}</p> : null}
                      {r.decision_reason ? <p className="mt-1 text-sm text-ink-soft">Reason: {r.decision_reason}</p> : null}
                    </div>
                  </div>
                  {decidable ? (
                    <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-line pt-3">
                      <ActionForm action={decideRegistrationAction} hidden={{ id: r.id, action: 'approve', reason: '' }} label="Approve" tone="good" disabled={!!r.duplicate_of && r.request_type === 'new'} disabledReason="Duplicate — reject it instead." />
                      <Disclose label="Request information"><ActionForm action={decideRegistrationAction} hidden={{ id: r.id, action: 'request_info' }} label="Send request" tone="quiet"><ReasonBox name="reason" required label="What do you need?" rows={2} /></ActionForm></Disclose>
                      <Disclose label="Reject…" tone="danger"><ActionForm action={decideRegistrationAction} hidden={{ id: r.id, action: 'reject' }} label="Reject" tone="danger"><ReasonBox name="reason" required label="Reason (the applicant sees this)" rows={2} /></ActionForm></Disclose>
                      <Disclose label="Reassign verifier"><ActionForm action={decideRegistrationAction} hidden={{ id: r.id, action: 'reassign' }} label="Reassign" tone="quiet"><input name="reassign_to" required placeholder="User id, e.g. USR-00008" className="input mb-2 h-9 text-sm" /><ReasonBox name="reason" label="Note" rows={2} /></ActionForm></Disclose>
                    </div>
                  ) : !d.allowed && ['approval_pending', 'info_requested'].includes(r.status) ? (
                    <p className="mt-3 border-t border-line pt-3 text-sm text-ink-faint"><Icon name="lock" size={12} className="mr-1 inline" />{d.reason}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <section className="card overflow-hidden">
          <form method="get" className="flex gap-2 border-b border-line p-3">
            <input type="hidden" name="tab" value="users" />
            <input type="search" name="q" defaultValue={q} placeholder="Search name, email or id" aria-label="Search accounts" className="input h-9 max-w-sm text-sm" />
            <button className="btn-quiet h-9" type="submit">Search</button>
          </form>
          <div className="overflow-x-auto">
            <table className="table min-w-[860px]">
              <thead><tr><th>Account</th><th>Role & scope</th><th>Designated authority</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {users.map((u) => {
                  const d = authorize(session, 'manage_users', { kind: 'user', userId: u.id });
                  const mgr = managerOf(u.id);
                  const last = statusHistory(u.id)[0];
                  return (
                    <tr key={u.id}>
                      <td className="text-sm"><span className="font-medium text-ink">{u.full_name}</span><span className="block text-xs text-ink-faint">{u.email} · {u.id}</span></td>
                      <td className="text-sm">{ROLE_LABELS[u.role]?.en ?? u.role}<span className="block text-xs text-ink-faint">{scopeName(u.scope_type, u.scope_id)}</span></td>
                      <td className="text-sm text-ink-soft">{mgr ? userNames([mgr]).get(mgr) : '—'}</td>
                      <td><span className={`chip ${u.status === 'active' ? 'border-good/30 bg-good-light text-good' : 'border-crit/30 bg-crit-light text-crit'}`}>{u.status}</span>{last ? <span className="mt-0.5 block text-2xs text-ink-faint">{last.reason}</span> : null}</td>
                      <td>
                        {d.allowed ? (
                          u.status === 'active' ? (
                            <Disclose label="Suspend…" tone="danger"><ActionForm action={accountStatusAction} hidden={{ user_id: u.id, to: 'suspended' }} label="Suspend account" tone="danger"><ReasonBox name="reason" required label="Reason" rows={2} /></ActionForm></Disclose>
                          ) : (
                            <Disclose label="Reactivate…"><ActionForm action={accountStatusAction} hidden={{ user_id: u.id, to: 'active' }} label="Reactivate" tone="good"><ReasonBox name="reason" required label="Reason" rows={2} /></ActionForm></Disclose>
                          )
                        ) : <span className="text-xs text-ink-faint" title={d.reason}>Not yours to manage</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {users.length === 0 ? <p className="px-6 py-10 text-center text-sm text-ink-faint">No accounts found.</p> : null}
        </section>
      )}
    </div>
  );
}
