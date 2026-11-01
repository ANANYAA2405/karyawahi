import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { can, authorize } from '@/lib/authz';
import { all } from '@/lib/db';
import { chainAbove, listDelegations, scopeContains, userCard, type ScopeType } from '@/lib/org';
import { scopeName, userNames } from '@/lib/repo';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { setManagerAction, delegationAction } from '@/lib/actions';
import { ROLE_LABELS } from '@domain/permissions';
import type { RoleCode } from '@domain/types';

/**
 * Organisational hierarchy: your reporting chain, the officers who report to you (and to
 * them), designated-authority changes, and acting arrangements. All changes are audited and
 * limited to junior roles inside your scope.
 */

export default async function HierarchyPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const manage = can(session, 'manage_hierarchy');
  const chain = chainAbove(session.user_id);
  const reports = all<{ user_id: string; full_name: string; role: RoleCode; scope_type: string; scope_id: string; status: string }>(
    `select r.user_id, u.full_name, ur.role, ur.scope_type, ur.scope_id, u.status from reporting_lines r join users u on u.id = r.user_id join user_roles ur on ur.user_id = u.id
      where r.manager_user_id = ? order by ur.role, u.full_name limit 200`, session.user_id,
  );
  const second = reports.length && reports.length < 40 ? all<{ user_id: string; manager_user_id: string; full_name: string; role: RoleCode; scope_id: string }>(
    `select r.user_id, r.manager_user_id, u.full_name, ur.role, ur.scope_id from reporting_lines r join users u on u.id = r.user_id join user_roles ur on ur.user_id = u.id
      where r.manager_user_id in (${reports.map(() => '?').join(',')}) order by u.full_name`, ...reports.map((r) => r.user_id),
  ) : [];
  const names = userNames([...chain, session.user_id]);
  const delegations = listDelegations((d) => scopeContains(session, d.scope_type, d.scope_id) || d.to_user_id === session.user_id || d.from_user_id === session.user_id);
  const dnames = userNames(delegations.flatMap((d) => [d.from_user_id, d.to_user_id, d.created_by]));
  const role = (r: RoleCode) => ROLE_LABELS[r]?.en ?? r;

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/admin" className="link">Administration</Link>}
        title={pick(lang, 'Organisation & reporting lines', 'संगठन व रिपोर्टिंग')}
        sub={pick(lang, 'Who each officer reports to decides where their complaints and requests go first. Acting arrangements extend an officer’s scope for a fixed period.', 'रिपोर्टिंग से तय होता है कि शिकायतें पहले किसे जाएँ।')}
      />

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="card p-4">
          <h2 className="text-base font-semibold text-ink">Your chain</h2>
          <ol className="mt-3 space-y-2">
            {[...chain].reverse().map((u) => {
              const c = userCard(u);
              return <li key={u} className="rounded-lg border border-line px-3 py-2 text-sm"><span className="font-medium text-ink">{names.get(u)}</span><span className="block text-xs text-ink-faint">{c ? `${role(c.role)} · ${scopeName(c.scope_type, c.scope_id)}` : ''}</span></li>;
            })}
            <li className="rounded-lg border-2 border-navy bg-navy-100 px-3 py-2 text-sm"><span className="font-semibold text-ink">{session.full_name} (you)</span><span className="block text-xs text-ink-soft">{role(session.role)} · {scopeName(session.scope_type, session.scope_id)}</span></li>
          </ol>
          {session.roles.filter((r) => r.delegated).map((r) => (
            <p key={r.delegated!.id} className="mt-3 rounded-lg bg-pend-light px-3 py-2 text-sm text-pend"><Icon name="users" size={13} className="mr-1 inline" />Acting {role(r.role)} for {scopeName(r.scope_type, r.scope_id)} until {fmtDate(r.delegated!.ends_on)}</p>
          ))}
        </section>

        <section className="card overflow-hidden">
          <header className="border-b border-line px-4 py-3"><h2 className="text-base font-semibold text-ink">Reporting to you ({reports.length})</h2></header>
          {reports.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-faint">Nobody reports to you directly.</p> : (
            <ul className="divide-y divide-line">
              {reports.slice(0, 60).map((r) => {
                const d = authorize(session, 'manage_hierarchy', { kind: 'user', userId: r.user_id });
                const sub = second.filter((x) => x.manager_user_id === r.user_id);
                return (
                  <li key={r.user_id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm"><span className="font-medium text-ink">{r.full_name}</span> <span className="text-ink-faint">· {role(r.role)} · {scopeName(r.scope_type, r.scope_id)}</span>{r.status !== 'active' ? <span className="chip ml-1 border-crit/30 bg-crit-light text-crit">{r.status}</span> : null}
                        {sub.length ? <span className="block text-xs text-ink-faint">{sub.length} report to them{sub.length <= 4 ? `: ${sub.map((x) => x.full_name).join(', ')}` : ''}</span> : null}
                      </div>
                      {manage && d.allowed ? (
                        <Disclose label="Change authority">
                          <ActionForm action={setManagerAction} hidden={{ user_id: r.user_id }} label="Save" tone="quiet">
                            <input name="manager_id" required placeholder="New designated authority (user id)" className="input mb-2 h-9 text-sm" />
                            <ReasonBox name="reason" required label="Reason" rows={2} />
                          </ActionForm>
                        </Disclose>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div><h2 className="text-base font-semibold text-ink">Acting arrangements (delegated authority)</h2><p className="text-xs text-ink-faint">Active on {fmtDate(today())} unless shown otherwise. They lapse on their end date automatically.</p></div>
        </header>
        {delegations.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">None in your scope.</p> : (
          <ul className="divide-y divide-line">
            {delegations.map((d) => {
              const active = !d.revoked_at && d.starts_on <= today() && d.ends_on >= today();
              return (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p><span className="font-medium text-ink">{dnames.get(d.to_user_id)}</span> acts as {role(d.role)} for {scopeName(d.scope_type, d.scope_id)} <span className="text-ink-faint">(covering {dnames.get(d.from_user_id)})</span></p>
                    <p className="text-xs text-ink-faint">{d.id} · {fmtDate(d.starts_on)} → {fmtDate(d.ends_on)} · {d.reason} · set by {dnames.get(d.created_by)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`chip ${d.revoked_at ? 'border-line-strong bg-paper-sunk text-ink-faint' : active ? 'border-good/30 bg-good-light text-good' : 'border-pend/30 bg-pend-light text-pend'}`}>{d.revoked_at ? 'revoked' : active ? 'active' : d.starts_on > today() ? 'scheduled' : 'ended'}</span>
                    {manage && !d.revoked_at && authorize(session, 'manage_hierarchy', { kind: 'scope', type: d.scope_type as ScopeType, id: d.scope_id }).allowed ? (
                      <ActionForm action={delegationAction} hidden={{ op: 'revoke', id: d.id, reason: 'Revoked from hierarchy page' }} label="Revoke" tone="quiet" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {manage ? (
          <div className="border-t border-line bg-paper-sunk p-4">
            <Disclose label="Create an acting arrangement…">
              <ActionForm action={delegationAction} hidden={{ op: 'create' }} label="Create" tone="primary">
                <div className="mb-2 grid gap-2 sm:grid-cols-2">
                  <label className="block"><span className="label">Officer on leave (user id)</span><input name="from_user_id" required className="input mt-1 h-9 text-sm" placeholder="USR-…" /></label>
                  <label className="block"><span className="label">Acting officer (user id)</span><input name="to_user_id" required className="input mt-1 h-9 text-sm" placeholder="USR-…" /></label>
                  <label className="block"><span className="label">From</span><input type="date" name="starts_on" required defaultValue={today()} className="input mt-1 h-9 text-sm" /></label>
                  <label className="block"><span className="label">Until</span><input type="date" name="ends_on" required className="input mt-1 h-9 text-sm" /></label>
                </div>
                <ReasonBox name="reason" required label="Reason" rows={2} />
              </ActionForm>
            </Disclose>
          </div>
        ) : null}
      </section>
      {!manage ? <Callout tone="method">You can view your reporting lines. Changing them needs the hierarchy-management permission.</Callout> : null}
    </div>
  );
}
