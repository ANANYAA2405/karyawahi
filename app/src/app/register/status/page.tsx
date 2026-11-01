import Link from 'next/link';
import { publicRequest, REG_STATUS } from '@/lib/onboarding';
import { scopeName, userNames } from '@/lib/repo';
import { AuthFrame } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { ActionForm, ReasonBox } from '@/components/ActionForm';
import { verifyEmailAction, affiliationAction, respondInfoAction } from '@/lib/actions';

/**
 * Request status, looked up by reference + email (no account exists yet). Shows the applicant
 * where the request is and what they need to do next — and nothing internal.
 */

const STEPS = ['email_verification_pending', 'institutional_verification_pending', 'approval_pending', 'active'];
const STEP_LABEL = ['Email', 'Affiliation', 'Approval', 'Active'];

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ id?: string; email?: string; code?: string }> }) {
  const sp = await searchParams;
  const r = sp.id && sp.email ? publicRequest(sp.id, sp.email) : null;
  const verifier = r?.verifier_user_id ? userNames([r.verifier_user_id]).get(r.verifier_user_id) : null;
  const step = r ? (r.status === 'info_requested' ? 2 : r.status === 'rejected' ? -1 : STEPS.indexOf(r.status)) : -1;

  return (
    <AuthFrame right={<Link href="/login" className="btn-quiet">Sign in</Link>}>
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="font-display text-2xl font-semibold text-ink">Account request status</h1>
        {!r ? (
          <form method="get" className="card mt-5 space-y-3 p-6">
            {sp.id ? <p role="alert" className="rounded-lg border border-crit/30 bg-crit-light px-3 py-2 text-sm text-crit">No request matches that reference and email.</p> : null}
            <label className="block"><span className="text-sm font-medium text-ink">Request reference</span><input name="id" required placeholder="REG-0007" defaultValue={sp.id ?? ''} className="input mt-1" /></label>
            <label className="block"><span className="text-sm font-medium text-ink">Email used</span><input name="email" type="email" required defaultValue={sp.email ?? ''} className="input mt-1" /></label>
            <button type="submit" className="btn-primary w-full">Check status</button>
          </form>
        ) : (
          <div className="mt-5 space-y-4">
            <section className="card p-5">
              <p className="text-sm text-ink-faint"><span className="font-mono">{r.id}</span> · {r.full_name} · {r.email}</p>
              <p className="mt-1 text-md font-semibold text-ink">{r.requested_role.replace('_', ' ').toUpperCase()} · {scopeName(r.scope_type, r.scope_id)}</p>
              <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Progress">
                {STEP_LABEL.map((l, i) => (
                  <li key={l} className={`rounded-lg border px-2 py-1.5 text-center text-xs font-medium ${r.status === 'rejected' ? 'border-line bg-paper-sunk text-ink-faint' : i < step || r.status === 'active' ? 'border-good/30 bg-good-light text-good' : i === step ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-faint'}`}>{l}</li>
                ))}
              </ol>
              <p className="mt-3 text-sm"><span className="font-semibold text-ink">{REG_STATUS[r.status]?.label ?? r.status}.</span>{' '}
                {r.status === 'approval_pending' ? <span className="text-ink-soft">With {verifier ?? 'the designated verifier'} for approval.</span> : null}
                {r.status === 'active' ? <span className="text-ink-soft">You can now <Link href="/login" className="link">sign in</Link> with {r.email}.</span> : null}
                {r.status === 'rejected' ? <span className="text-ink-soft">Reason: {r.decision_reason}</span> : null}
              </p>
              {r.duplicate_of ? <p className="mt-2 rounded-lg bg-warn-light px-3 py-2 text-sm text-warn">This email already belongs to an account. The verifier will ask you to request a change from that account instead.</p> : null}
            </section>

            {r.status === 'email_verification_pending' ? (
              <section className="card p-5">
                <h2 className="text-md font-semibold text-ink">Verify your email</h2>
                {sp.code ? <p className="mt-2 rounded-lg border border-warn/30 bg-warn-light px-3 py-2 text-sm text-ink"><Icon name="info" size={14} className="mr-1 inline text-warn" />Demo mode: no email is sent. Your code is <strong className="font-mono text-md">{sp.code}</strong>.</p> : <p className="mt-1 text-sm text-ink-faint">Demo mode: the code was shown when you submitted. Seeded demo requests use a fixed code shown to the demo administrator.</p>}
                <ActionForm action={verifyEmailAction} hidden={{ id: r.id, email: r.email }} label="Verify" className="mt-3">
                  <input name="code" inputMode="numeric" required maxLength={6} placeholder="6-digit code" className="input mb-2 w-48 font-mono" defaultValue={sp.code ?? ''} />
                </ActionForm>
              </section>
            ) : null}

            {r.status === 'institutional_verification_pending' ? (
              <section className="card p-5">
                <h2 className="text-md font-semibold text-ink">Affiliation check</h2>
                <p className="mt-1 text-sm text-ink-faint">Simulated registry lookup. In production this would query the state staff database; it is not proof of employment on its own.</p>
                <ActionForm action={affiliationAction} hidden={{ id: r.id, email: r.email }} label="Check affiliation" className="mt-3">
                  <input name="affiliation_ref" defaultValue={r.affiliation_ref ?? ''} placeholder="EMP-EDU-1234" className="input mb-2 w-64 font-mono uppercase" />
                </ActionForm>
              </section>
            ) : null}

            {r.status === 'info_requested' ? (
              <section className="card p-5">
                <h2 className="text-md font-semibold text-ink">The verifier asked for more information</h2>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-paper-sunk px-3 py-2 text-sm text-ink">{r.info_request}</p>
                <ActionForm action={respondInfoAction} hidden={{ id: r.id, email: r.email }} label="Send response" className="mt-3">
                  <ReasonBox name="response" required label="Your response" rows={3} />
                </ActionForm>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </AuthFrame>
  );
}
