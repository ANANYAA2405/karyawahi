import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { AuthFrame } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { SubmitButton } from '@/components/SubmitButton';

/**
 * Sign in. The demo has no passwords — every account is fictional — so the form asks only for
 * the account's email and says so plainly, rather than showing a password box that checks
 * nothing. In a real deployment this is replaced by the state single sign-on.
 */

const ERRORS: Record<string, string> = {
  'invalid-email': 'That does not look like an email address.',
  'unknown-email': 'No account uses that email. Demo accounts end in @demo.karyavahi.test.',
  'unknown-account': 'That account is inactive or has no role assigned.',
};

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const existing = await getSession();
  if (existing) redirect(homeFor(existing));
  const { error, email } = await searchParams;
  const message = error ? ERRORS[error] ?? 'Sign-in failed.' : null;

  return (
    <AuthFrame right={<Link href="/demo" className="btn-ghost">Explore demo</Link>}>
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 md:grid-cols-2 md:py-20">
        <div className="hidden md:block">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
            Welcome back.
          </h1>
          <p className="mt-3 max-w-sm text-md leading-relaxed text-ink-soft">
            Sign in to see the cases in your scope, the decisions waiting on you, and whether the work
            already done has actually moved learning.
          </p>
          <ul className="mt-8 space-y-3 text-base text-ink-soft">
            {[
              ['shield', 'You only ever see your own block, cluster or school.'],
              ['lock', 'Every approval and refusal is written to a tamper-evident audit chain.'],
              ['sparkles', 'Claude explains the records and drafts the next step; a person always decides.'],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-light text-brand"><Icon name={icon} size={16} /></span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-6 shadow-lift sm:p-8">
          <h2 className="font-display text-xl font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Use your Karyavahi account email.</p>

          {message ? (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-crit/30 bg-crit-light px-3 py-2.5 text-sm text-crit">
              <Icon name="alert" size={16} className="mt-px" />{message}
            </p>
          ) : null}

          <form action="/api/sign-in" method="post" className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-ink">Email address</span>
              <input
                type="email" name="email" required autoComplete="email" autoFocus
                defaultValue={email ?? ''} placeholder="name@demo.karyavahi.test"
                className="input mt-1.5 h-11" aria-invalid={message ? true : undefined}
              />
            </label>
            <div className="flex items-start gap-2 rounded-lg border border-line bg-paper-sunk px-3 py-2.5 text-sm leading-snug text-ink-soft">
              <Icon name="info" size={15} className="mt-px text-ink-faint" />
              <span>
                <strong className="font-semibold text-ink">Demo build — no password.</strong> Accounts are fictional, so there is
                nothing to protect. Production sign-in would use the state single sign-on.
              </span>
            </div>
            <SubmitButton className="btn-primary h-11 w-full text-base" pendingLabel="Signing in…">
              Sign in <Icon name="arrow-right" size={16} />
            </SubmitButton>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </div>
          <Link href="/demo" className="btn-quiet h-11 w-full">
            <Icon name="users" size={16} /> Explore with a demo persona
          </Link>
          <p className="mt-4 text-center text-sm text-ink-soft">New to Karyavahi? <Link href="/register" className="link">Request an account</Link> · <Link href="/register/status" className="link">Check a request</Link></p>
        </div>
      </div>
    </AuthFrame>
  );
}
