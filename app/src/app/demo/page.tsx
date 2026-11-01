import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { one } from '@/lib/db';
import { demoAccounts, scopeName, type UserWithRole } from '@/lib/repo';
import { AuthFrame } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { SubmitButton } from '@/components/SubmitButton';
import { ROLE_LABELS } from '@domain/permissions';
import { AS_OF_DATE } from '@domain/catalog';

/**
 * Explore the demo: pick a persona. Kept separate from /login so the demo mechanism never
 * passes for production authentication. Each card says what that role can and cannot do;
 * the server enforces it regardless of which card was clicked.
 */

const PERSONAS: { role: string; email: string; icon: string; can: string; story?: string }[] = [
  {
    role: 'beo', email: 'beo.blk-01@demo.karyavahi.test', icon: 'briefcase',
    can: 'Approves block-level plans, assigns work, verifies proof and closes cases — only in their own block.',
    story: 'Start here. CASE-0184 is waiting on this officer’s decision.',
  },
  {
    role: 'deo', email: 'deo.rmp@demo.karyavahi.test', icon: 'layers',
    can: 'Sees every block in the district, decides district-lever plans and receives escalations.',
  },
  {
    role: 'crc', email: 'crc.clu-001@demo.karyavahi.test', icon: 'pin',
    can: 'Runs coaching visits and spot assessments in one cluster, submits proof, raises field concerns.',
  },
  {
    role: 'brc', email: 'brc1.blk-01@demo.karyavahi.test', icon: 'users',
    can: 'Owns training and independent spot-checks of other people’s proof across the block.',
  },
  {
    role: 'headmaster', email: 'hm.sch-00002@demo.karyavahi.test', icon: 'school',
    can: 'Sees only their own school and their own tasks. Cannot approve, verify or read the audit trail.',
  },
  {
    role: 'state_admin', email: 'state.lead@demo.karyavahi.test', icon: 'globe',
    can: 'Whole-state view. Configures detection thresholds and decides district and PAB plans.',
  },
  {
    role: 'auditor', email: 'auditor.state@demo.karyavahi.test', icon: 'shield',
    can: 'Read-only across the state, plus the hash-chained audit trail and every AI interaction.',
  },
  {
    role: 'demo_admin', email: 'admin@demo.karyavahi.test', icon: 'settings',
    can: 'System and demo controls: move the demo clock, run the reminder sweep, reset the seed.',
  },
];

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const existing = await getSession();
  if (existing) redirect(homeFor(existing));
  const { error } = await searchParams;

  const demo = new Map(demoAccounts().map((a) => [a.email, a]));
  const resolve = (email: string): UserWithRole | null =>
    demo.get(email) ??
    one<UserWithRole>(
      `select u.*, ur.role, ur.scope_type, ur.scope_id from users u join user_roles ur on ur.user_id = u.id
        where u.email = ? and u.status = 'active' limit 1`, email,
    );

  const cards = PERSONAS.map((p) => ({ ...p, user: resolve(p.email) })).filter((p) => p.user);
  const [lead, ...rest] = cards;

  return (
    <AuthFrame right={<Link href="/login" className="btn-quiet">Sign in with email</Link>}>
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn-light px-3 py-1 text-xs font-medium text-warn">
            <Icon name="info" size={14} /> Demo access — not production authentication
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight text-ink">Choose a persona</h1>
          <p className="mt-2 text-md leading-relaxed text-ink-soft">
            Each persona sees the same case ledger through its own authority. Scope is enforced on the server —
            a block officer cannot open another block’s case, whichever card you pick. “Today” in the data is {AS_OF_DATE}.
          </p>
        </div>

        {error ? (
          <p role="alert" className="mt-5 rounded-lg border border-crit/30 bg-crit-light px-3 py-2.5 text-sm text-crit">That persona could not be used.</p>
        ) : null}

        {lead?.user ? (
          <form action="/api/sign-in" method="post" className="mt-8">
            <input type="hidden" name="user_id" value={lead.user.id} />
            <input type="hidden" name="from" value="demo" />
            <div className="flex flex-col gap-5 rounded-2xl bg-navy p-6 text-white shadow-lift sm:flex-row sm:items-center sm:p-7">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand text-white"><Icon name={lead.icon} size={22} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-soft">Recommended walkthrough</p>
                <p className="mt-1 text-lg font-semibold">{ROLE_LABELS[lead.role as keyof typeof ROLE_LABELS].en} · {scopeName(lead.user.scope_type, lead.user.scope_id)}</p>
                <p className="mt-1 text-sm leading-relaxed text-navy-200">{lead.can} {lead.story}</p>
                <p className="mt-1.5 text-xs text-navy-300">{lead.user.full_name} · {lead.user.email}</p>
              </div>
              <SubmitButton className="btn shrink-0 border-white bg-white px-5 py-2.5 text-navy hover:bg-navy-100" pendingLabel="Entering…">
                Enter as block officer <Icon name="arrow-right" size={16} />
              </SubmitButton>
            </div>
          </form>
        ) : null}

        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => {
            const r = ROLE_LABELS[p.role as keyof typeof ROLE_LABELS];
            return (
              <li key={p.role}>
                <form action="/api/sign-in" method="post" className="flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-card transition-shadow hover:shadow-lift">
                  <input type="hidden" name="user_id" value={p.user!.id} />
                  <input type="hidden" name="from" value="demo" />
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light text-brand"><Icon name={p.icon} size={19} /></span>
                    <div className="min-w-0">
                      <p className="text-md font-semibold text-ink">{r.en}</p>
                      <p className="truncate text-sm text-ink-faint">{scopeName(p.user!.scope_type, p.user!.scope_id)}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-soft">{p.can}</p>
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="truncate text-xs text-ink-faint" title={p.user!.email}>{p.user!.full_name}</span>
                    <SubmitButton className="btn-quiet btn-sm shrink-0" pendingLabel="Entering…">
                      Enter <Icon name="arrow-right" size={14} />
                    </SubmitButton>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-sm text-ink-faint">
          Want a different block or school? <Link href="/login/block-officer" className="link">Browse more seeded accounts by role</Link>.
        </p>
      </div>
    </AuthFrame>
  );
}
