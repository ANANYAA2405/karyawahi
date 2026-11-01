import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { count } from '@/lib/db';
import { AuthFrame, WORKFLOW } from '@/components/Brand';
import { Icon } from '@/components/Icon';

/**
 * The public front door. It explains the product; it does not expose the permission model.
 * The figures in the side panel are counted from the (fictional) demo ledger on every request.
 */

export default async function Landing() {
  const s = await getSession();
  if (s) redirect(homeFor(s));

  const stats = {
    cases: count('select count(*) c from cases'),
    closed: count(`select count(*) c from cases where status = 'closed' and closure_type like 'improved%'`),
    reopened: count('select count(*) c from cases where reopen_count > 0'),
    rejected: count(`select count(*) c from findings where status like 'rejected%'`),
    schools: count('select count(*) c from schools'),
  };

  return (
    <AuthFrame
      right={
        <>
          <Link href="/demo" className="btn-ghost hidden sm:inline-flex">Explore demo</Link>
          <Link href="/login" className="btn-navy">Sign in</Link>
        </>
      }
    >
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-light px-3 py-1 text-xs font-medium text-brand">
            <Icon name="target" size={14} /> Education accountability platform
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl">
            From learning gaps to <span className="text-brand">accountable action.</span>
          </h1>
          <p className="mt-5 max-w-xl text-md leading-relaxed text-ink-soft">
            Karyavahi helps education administrators identify learning gaps, investigate their causes,
            select evidence-backed interventions, track delivery and verify outcomes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="btn-primary px-5 py-2.5 text-md">
              Sign in <Icon name="arrow-right" size={16} />
            </Link>
            <Link href="/demo" className="btn-quiet px-5 py-2.5 text-md">
              <Icon name="play" size={15} /> Explore the demo
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-faint">Demo build · fictional data · no password needed for demo accounts</p>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-brand-light via-ivory-deep to-navy-100 opacity-70" aria-hidden />
          <div className="card overflow-hidden shadow-lift">
            <div className="flex items-center justify-between border-b border-line bg-paper-sunk px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">The case is the unit of work</p>
              <span className="chip border-warn/30 bg-warn-light text-warn">Fictional</span>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="font-mono text-xs text-ink-faint">CASE-0184 · Rampur Sadar</p>
                <p className="mt-0.5 text-md font-semibold text-ink">Class 3 subtraction fell 17.9 pts in Rampur cluster</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="chip border-crit/30 bg-crit-light text-crit">Critical</span>
                  <span className="chip border-pend/30 bg-pend-light text-pend">Awaiting approval</span>
                  <span className="chip border-line-strong bg-paper-sunk text-ink-soft">z = −3.92</span>
                </div>
              </div>
              <ol className="relative space-y-3 border-l border-line pl-5 text-sm">
                {[
                  ['Finding', '42.3% → 24.4% proficient, 11.3 pp worse than the district', 'alert', 'text-crit'],
                  ['Diagnosis', '4 of 5 driver schools lost a teacher; 4 had no CRC visit for 60+ days', 'search', 'text-warn'],
                  ['Plan', 'Teacher-led remedial hour · success threshold locked at approval', 'flask', 'text-brand'],
                  ['Outcome', 'Closes only if the next round shows the gain', 'check-circle', 'text-good'],
                ].map(([title, body, icon, tone]) => (
                  <li key={title} className="relative">
                    <span className={`absolute -left-[29px] top-0 grid h-[18px] w-[18px] place-items-center rounded-full bg-white ring-1 ring-line ${tone}`}>
                      <Icon name={icon} size={12} strokeWidth={2.2} />
                    </span>
                    <p className="font-medium text-ink">{title}</p>
                    <p className="text-ink-soft">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
            <dl className="grid grid-cols-3 divide-x divide-line border-t border-line bg-paper-sunk text-center">
              {[
                [stats.cases, 'cases in the ledger'],
                [stats.closed, 'closed on a verified gain'],
                [stats.reopened, 'reopened — no gain shown'],
              ].map(([n, l]) => (
                <div key={String(l)} className="px-2 py-3">
                  <dt className="sr-only">{l}</dt>
                  <dd className="font-display text-xl font-semibold text-ink tnum">{n}</dd>
                  <dd className="text-2xs leading-tight text-ink-faint">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <p className="h-section">One connected workflow</p>
          <h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold tracking-tight text-ink">
            A learning drop becomes a case, and the case stays open until the learning comes back.
          </h2>
          <ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {WORKFLOW.map((w, i) => (
              <li key={w.key} className="relative rounded-xl border border-line bg-ivory px-3 py-4">
                <span className="text-2xs font-semibold text-ink-faint tnum">{String(i + 1).padStart(2, '0')}</span>
                <Icon name={w.icon} size={20} className="mt-2 text-brand" />
                <p className="mt-2 text-base font-semibold text-ink">{w.en}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-14 md:grid-cols-3">
        {[
          ['Evidence before conclusions', 'Every condition in a diagnosis traces to the record it came from, and is labelled association, not cause.', 'search'],
          ['AI assists. Humans decide.', 'AI retrieves, summarises and explains. Only an officer with the right authority approves, assigns or closes.', 'sparkles'],
          ['Done is not the same as improved', 'Task complete, proof verified and learning improved are three separate states. A case closes only on the third.', 'check-circle'],
        ].map(([title, body, icon]) => (
          <div key={title} className="rounded-xl border border-line bg-white p-6 shadow-card">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-light text-brand"><Icon name={icon} size={20} /></span>
            <h3 className="mt-4 text-md font-semibold text-ink">{title}</h3>
            <p className="mt-1.5 text-base leading-relaxed text-ink-soft">{body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="flex flex-col items-start justify-between gap-5 rounded-2xl bg-navy px-8 py-9 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">See it through an officer&apos;s eyes</h2>
            <p className="mt-1 text-base text-navy-200">
              {stats.schools.toLocaleString('en-IN')} fictional schools across three districts. Pick a persona and work a case end to end.
            </p>
          </div>
          <Link href="/demo" className="btn bg-white text-navy hover:bg-navy-100">
            Explore the demo <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </section>
    </AuthFrame>
  );
}
