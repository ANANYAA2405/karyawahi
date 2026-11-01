import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { chainAbove, statusHistory, userCard } from '@/lib/org';
import { all } from '@/lib/db';
import { scopeName, userNames } from '@/lib/repo';
import { PERMISSIONS, can } from '@/lib/authz';
import { REG_STATUS } from '@/lib/onboarding';
import { pick } from '@/lib/i18n';
import { PageHead, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { requestChangeAction } from '@/lib/actions';
import { ROLE_LABELS } from '@domain/permissions';

/**
 * My account: role, scope, acting arrangements, reporting chain, effective permissions, status
 * history — and a role/scope change request, which changes nothing until a verifier approves.
 */
export default async function AccountPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const chain = chainAbove(session.user_id);
  const names = userNames(chain);
  const history = statusHistory(session.user_id);
  const requests = all<{ id: string; requested_role: string; scope_type: string; scope_id: string; status: string; created_at: string; decision_reason: string | null }>(
    `select id, requested_role, scope_type, scope_id, status, created_at, decision_reason from registration_requests where target_user_id = ? or lower(email) = ? order by created_at desc`,
    session.user_id, session.email.toLowerCase(),
  );
  const granted = PERMISSIONS.filter((p) => can(session, p));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHead title={pick(lang, 'My account', 'मेरा खाता')} sub={session.email} />
      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-base font-semibold text-ink">Role and scope</h2>
          <p className="mt-2 text-md font-medium text-ink">{ROLE_LABELS[session.role]?.en}</p>
          <p className="text-sm text-ink-soft">{scopeName(session.scope_type, session.scope_id)}</p>
          {session.roles.filter((r) => r.delegated).map((r) => (
            <p key={r.delegated!.id} className="mt-2 rounded-lg bg-pend-light px-3 py-2 text-sm text-pend">Acting {ROLE_LABELS[r.role]?.en} for {scopeName(r.scope_type, r.scope_id)} until {fmtDate(r.delegated!.ends_on)}</p>
          ))}
          <h3 className="label mt-4">Reports to</h3>
          <ol className="mt-1 space-y-1 text-sm">
            {chain.map((u, i) => { const c = userCard(u); return <li key={u} style={{ paddingLeft: i * 12 }}>{i ? '↳ ' : ''}{names.get(u)} <span className="text-ink-faint">· {c ? ROLE_LABELS[c.role]?.en : ''}</span></li>; })}
            {chain.length === 0 ? <li className="text-ink-faint">Top of the hierarchy.</li> : null}
          </ol>
        </section>
        <section className="card p-5">
          <h2 className="text-base font-semibold text-ink">What you can do</h2>
          <p className="text-xs text-ink-faint">Always limited to your scope; checked on the server for every action.</p>
          <ul className="mt-2 flex flex-wrap gap-1">{granted.map((p) => <li key={p} className="chip border-line-strong bg-paper-sunk text-ink-soft">{p.replace(/_/g, ' ')}</li>)}</ul>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="text-base font-semibold text-ink">Request a role or scope change</h2>
        <p className="text-sm text-ink-faint">For a transfer or promotion. It goes to the designated verifier for the new place; your current access is unchanged until approval.</p>
        <div className="mt-3">
          <Disclose label="Start a change request…">
            <ActionForm action={requestChangeAction} label="Send request">
              <div className="mb-2 grid gap-2 sm:grid-cols-3">
                <label className="block"><span className="label">Role</span>
                  <select name="role" className="input mt-1 h-9 text-sm" defaultValue={session.role}>{['headmaster', 'crc', 'brc', 'beo', 'deo'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS].en}</option>)}</select></label>
                <label className="block"><span className="label">Level</span>
                  <select name="scope_type" className="input mt-1 h-9 text-sm" defaultValue={session.scope_type}>{['school', 'cluster', 'block', 'district'].map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
                <label className="block"><span className="label">Place id</span><input name="scope_id" required className="input mt-1 h-9 text-sm" placeholder="e.g. BLK-02" /></label>
              </div>
              <ReasonBox name="reason" required label="Reason (e.g. transfer order number)" rows={2} />
            </ActionForm>
          </Disclose>
        </div>
        {requests.length ? (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
            {requests.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span><span className="font-mono">{r.id}</span> · {r.requested_role.toUpperCase()} {scopeName(r.scope_type, r.scope_id)}</span><span className="text-ink-soft">{REG_STATUS[r.status]?.label ?? r.status}{r.decision_reason ? ` — ${r.decision_reason}` : ''}</span></li>)}
          </ul>
        ) : null}
      </section>

      {history.length ? (
        <section className="card p-5">
          <h2 className="text-base font-semibold text-ink">Account history</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">{history.map((h) => <li key={h.id}><Icon name="history" size={12} className="mr-1 inline" />{fmtDate(h.ts, true)}: {h.from_status ?? 'new'} → {h.to_status}. {h.reason}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
