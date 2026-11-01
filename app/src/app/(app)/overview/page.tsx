import Link from 'next/link';
import { Suspense } from 'react';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { headline } from '@/lib/dash';
import { priorityActions, recentProgress, learningTrend, systemStatus, plainBrief } from '@/lib/overview';
import { scopeName } from '@/lib/repo';
import { may } from '@/lib/guard';
import { can } from '@/lib/authz';
import { now } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AttentionList, MetricStrip, ProgressTimeline } from '@/components/overview';
import { AiBriefing } from '@/components/AiBriefing';
import { TrendChart } from '@/components/charts';
import { GeoMap } from '@/components/GeoMap';
import { SERIES } from '@/lib/viz';

/**
 * Dashboard — "What is happening, what needs my attention, and what should I do next?"
 *
 *   A introduction · B intelligence brief · C metric strip · D attention (42%) + live map (58%)
 *   E learning performance · F recent operational progress
 *
 * Technical controls (clock, reset, jobs, outbox) live under Administration.
 */

export default async function DashboardPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const h = headline(session);
  const pa = priorityActions(session, 5);
  const trend = learningTrend(session);
  const progress = recentProgress(session, 8);
  const sys = systemStatus();
  const scope = scopeName(session.scope_type, session.scope_id);

  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const approver = may(session, 'plan.approve_block') || may(session, 'plan.approve_district_or_pab');
  const primary = approver && pa.counts.approval
    ? { href: '/approvals', label: `Review ${pa.counts.approval} approval${pa.counts.approval === 1 ? '' : 's'}` }
    : pa.counts.complaint ? { href: '/complaints?queue=mine', label: `Respond to ${pa.counts.complaint} complaint${pa.counts.complaint === 1 ? '' : 's'}` }
    : { href: '/hotspots', label: 'Explore learning hotspots' };

  const last = trend.scope.length - 1;
  const lfl = last >= 2 && trend.scope[last] !== null && trend.scope[last - 2] !== null ? trend.scope[last]! - trend.scope[last - 2]! : null;
  const vsState = trend.scope[last] !== null && trend.state[last] !== null ? trend.scope[last]! - trend.state[last]! : null;

  return (
    <div className="space-y-6">
      {/* A — introduction */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-ink-faint">{pick(lang, `${greet}, ${session.full_name.split(' ')[0]}`, `नमस्ते, ${session.full_name.split(' ')[0]}`)}</p>
          <h1 className="mt-0.5 text-2xl font-semibold leading-tight tracking-tight text-ink">{pick(lang, 'Education performance overview', 'शिक्षा प्रदर्शन अवलोकन')}</h1>
          <p className="mt-1 text-sm text-ink-soft">{scope} · {sys.latestRound ?? 'no completed round'} · {fmtDate(sys.demoDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <dl className="hidden gap-5 text-xs sm:flex">
            <div><dt className="text-ink-faint">Data refreshed</dt><dd className="font-medium text-ink">{sys.lastImport ? fmtDate(sys.lastImport) : '—'}</dd></div>
            <div><dt className="text-ink-faint">Assessment period</dt><dd className="font-medium text-ink">{sys.latestRound?.split(' · ')[0] ?? '—'}</dd></div>
          </dl>
          <Link href={primary.href} className="btn-primary">{primary.label}<Icon name="arrow-right" size={15} /></Link>
        </div>
      </header>

      {/* B — intelligence brief */}
      {may(session, 'ai.assistant') ? <AiBriefing fallback={plainBrief(session)} /> : null}

      {/* C — operational indicators */}
      <MetricStrip metrics={[
        { label: 'Open cases', value: h.open_cases, note: h.critical ? `${h.critical} critical` : 'none critical', href: '/cases?tab=open', tone: h.critical ? 'crit' : undefined },
        { label: 'Pending approvals', value: approver ? pa.counts.approval : h.awaiting_approval, note: approver ? 'waiting on you' : 'awaiting a decision', href: approver ? '/approvals' : '/cases?tab=approval', tone: (approver ? pa.counts.approval : h.awaiting_approval) ? 'warn' : undefined },
        { label: 'Overdue actions', value: h.overdue_tasks, note: `${h.escalated_tasks} escalated`, href: '/execution?tab=overdue', tone: h.overdue_tasks ? 'crit' : undefined },
        { label: 'Awaiting verification', value: h.outcome_pending, note: 'next round decides', href: '/cases?tab=verification', tone: 'pend' },
        { label: 'Verified outcomes', value: h.closed_verified, note: `${h.reopened} reopened`, href: '/impact', tone: 'good' },
      ]} />

      {/* D — attention + geography */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
        <section className="flex flex-col rounded-xl border border-line bg-white" aria-labelledby="att-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="att-title" className="text-md font-semibold tracking-tight text-ink">Requires your attention</h2>
            <span className="text-xs text-ink-faint">{Object.values(pa.counts).reduce((a, b) => a + b, 0)} open items</span>
          </header>
          <div className="flex-1"><AttentionList items={pa.items} empty="Nothing needs your action right now." /></div>
          <footer className="border-t border-line px-5 py-2.5 text-right">
            <Link href={can(session, 'resolve_complaint') ? '/complaints?queue=mine' : '/cases?tab=open'} className="text-sm font-medium text-brand hover:underline">View all</Link>
          </footer>
        </section>
        <section className="rounded-xl border border-line bg-white" aria-labelledby="geo-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="geo-title" className="text-md font-semibold tracking-tight text-ink">Geographic overview</h2>
            <Link href="/hotspots" className="text-sm font-medium text-brand hover:underline">Open hotspot workspace</Link>
          </header>
          <div className="p-3"><Suspense fallback={<div className="skeleton h-[380px] w-full" />}><GeoMap compact height={380} /></Suspense></div>
        </section>
      </div>

      {/* E — learning performance */}
      <section className="rounded-xl border border-line bg-white" aria-labelledby="lp-title">
        <header className="border-b border-line px-5 py-3">
          <h2 id="lp-title" className="text-md font-semibold tracking-tight text-ink">Learning performance</h2>
        </header>
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <TrendChart
            xLabels={trend.labels}
            series={[
              { key: 'scope', label: trend.scopeLabel, color: SERIES.one, points: trend.scope },
              ...(session.scope_type !== 'state' ? [{ key: 'state', label: 'Whole state', color: SERIES.two, points: trend.state, dashed: true }] : []),
            ]}
            yMax={70} height={230} caption={`Percent of assessed students at grade benchmark, ${trend.scopeLabel}`}
          />
          <dl className="space-y-4 border-line lg:border-l lg:pl-6">
            <div><dt className="text-xs text-ink-faint">Latest round</dt><dd className="kpi-num mt-0.5 text-ink">{trend.scope[last] ?? '—'}%</dd><dd className="text-xs text-ink-faint">{trend.labels[last]}</dd></div>
            <div><dt className="text-xs text-ink-faint">Same round last year</dt><dd className={`text-lg font-semibold tnum ${lfl === null ? 'text-ink' : lfl >= 0 ? 'text-good' : 'text-crit'}`}>{lfl === null ? '—' : `${lfl >= 0 ? '+' : '−'}${Math.abs(lfl).toFixed(1)} pp`}</dd></div>
            {vsState !== null && session.scope_type !== 'state' ? <div><dt className="text-xs text-ink-faint">Versus the state</dt><dd className={`text-lg font-semibold tnum ${vsState >= 0 ? 'text-good' : 'text-crit'}`}>{vsState >= 0 ? '+' : '−'}{Math.abs(vsState).toFixed(1)} pp</dd></div> : null}
            <p className="text-xs leading-snug text-ink-faint">Endline rounds run higher than baselines each year, so compare a round with the same round a year earlier.</p>
          </dl>
        </div>
      </section>

      {/* F — recent operational progress */}
      <section className="rounded-xl border border-line bg-white" aria-labelledby="pr-title">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="pr-title" className="text-md font-semibold tracking-tight text-ink">Recent operational progress</h2>
          {may(session, 'audit.view') ? <Link href="/audit" className="text-sm font-medium text-brand hover:underline">Full audit history</Link> : null}
        </header>
        <ProgressTimeline items={progress} />
      </section>
    </div>
  );
}
