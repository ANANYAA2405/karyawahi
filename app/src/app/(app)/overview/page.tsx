import Link from 'next/link';
import { Suspense } from 'react';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { headline } from '@/lib/dash';
import { priorityActions, recentProgress, learningTrend, systemStatus, plainBrief } from '@/lib/overview';
import { topHotspots, stageStrip } from '@/lib/home';
import { countEvidenceToCheck } from '@/lib/cases';
import { scopeName } from '@/lib/repo';
import { may } from '@/lib/guard';
import { now } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ProgressTimeline } from '@/components/overview';
import { TrendChart } from '@/components/charts';
import { GeoMap } from '@/components/GeoMap';
import { SERIES } from '@/lib/viz';
import { SEVERITY_COLORS } from '@/lib/maplayers';
import { AiBriefing } from '@/components/AiBriefing';
import { AskClaudeInline } from '@/components/Copilot';
import { aiStatus } from '@/lib/ai/config';
import { mayReadBriefing } from '@/lib/ai/briefing';

/**
 * The command centre: the officer's home.
 *
 * The map of their own area fills the screen, coloured by where learning is falling, with a few
 * cards floating beside it, each one picture and one action: what needs them now, the worst
 * hotspots, where their cases stand, and how learning is moving. Clicking the map opens that
 * area in the hotspot explorer. The longer views (the trend over time, recent progress) sit
 * below the map for whoever scrolls.
 */

/** One-word stage names that fit under a bar; the full name is the title. */
const STAGE_SHORT: Record<string, [string, string]> = {
  detected: ['Found', 'पहचान'], investigation: ['Look', 'जाँच'], approval: ['Approve', 'स्वीकृति'], assignment: ['Assign', 'आवंटन'],
  execution: ['Do', 'काम'], verification: ['Check', 'सत्यापन'], closure: ['Done', 'पूर्ण'],
};

const HOT_TONE = { critical: SEVERITY_COLORS.critical, high: SEVERITY_COLORS.significant, medium: SEVERITY_COLORS.moderate } as const;

function Tile({ href, icon, n, label, tone }: { href: string; icon: string; n: number; label: string; tone: 'crit' | 'warn' | 'pend' | 'brand' }) {
  const ring = { crit: 'bg-crit-light text-crit', warn: 'bg-warn-light text-warn', pend: 'bg-pend-light text-pend', brand: 'bg-brand-light text-brand' }[tone];
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 transition-colors hover:border-line-strong">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${n ? ring : 'bg-paper-sunk text-ink-faint'}`}><Icon name={icon} size={17} /></span>
      <span className="min-w-0">
        <span className={`tnum block text-xl font-semibold leading-none ${n ? 'text-ink' : 'text-ink-faint'}`}>{n}</span>
        <span className="mt-1 block text-xs leading-tight text-ink-soft">{label}</span>
      </span>
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white/95 p-4 shadow-lift backdrop-blur">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default async function CommandCentre() {
  const session = await pageSession();
  const lang = await getLanguage();
  const h = headline(session);
  const pa = priorityActions(session, 5);
  const trend = learningTrend(session);
  const progress = recentProgress(session, 6);
  const sys = systemStatus();
  const brief = plainBrief(session);
  const hot = topHotspots(session, 4);
  const stages = stageStrip(session);
  const proof = may(session, 'evidence.verify') ? countEvidenceToCheck(session) : 0;
  const scope = scopeName(session.scope_type, session.scope_id);

  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now()));
  const greet = pick(lang, hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening', 'नमस्ते');
  const approver = may(session, 'plan.approve_block') || may(session, 'plan.approve_district_or_pab');
  const last = trend.scope.length - 1;
  const lfl = last >= 2 && trend.scope[last] !== null && trend.scope[last - 2] !== null ? trend.scope[last]! - trend.scope[last - 2]! : null;
  const stageMax = Math.max(1, ...stages.map((s) => s.n));
  const worstRel = Math.max(1, ...hot.map((x) => Math.abs(x.relPp)));
  // Claude sits in the first card on the map: ask it anything about this area. District and state
  // officers also get its written briefing below the map (ai.executive_briefing).
  const claude = may(session, 'ai.assistant') ? aiStatus().configured : null;
  const briefing = claude !== null && mayReadBriefing(session);
  const claudeQuestions = approver
    ? [pick(lang, 'What should I prioritise this week?', 'इस सप्ताह किसे प्राथमिकता दूँ?'), pick(lang, 'Which areas are slipping, and why?', 'कौन से क्षेत्र पिछड़ रहे हैं, और क्यों?'), pick(lang, 'Prepare an agenda for my review meeting', 'समीक्षा बैठक का एजेंडा बनाएँ')]
    : [pick(lang, 'What should I do first today?', 'आज सबसे पहले क्या करूँ?'), pick(lang, 'Why are tasks overdue, and what is blocking them?', 'काम विलंबित क्यों हैं, और क्या रुकावट है?'), pick(lang, 'Which schools need a visit first?', 'किन विद्यालयों में पहले जाना चाहिए?')];

  const cards = (
    <>
      <Panel title={pick(lang, 'Needs you now', 'अभी आपके ध्यान में')}>
        <div className="grid grid-cols-2 gap-2">
          <Tile href={approver ? '/approvals' : '/cases?tab=approval'} icon="check-circle" n={approver ? pa.counts.approval : h.awaiting_approval} label={pick(lang, approver ? 'Plans to decide' : 'Awaiting a decision', 'निर्णय हेतु योजनाएँ')} tone="warn" />
          <Tile href="/execution?tab=overdue" icon="clock" n={h.overdue_tasks} label={pick(lang, 'Overdue tasks', 'विलंबित काम')} tone="crit" />
          <Tile href="/complaints?queue=mine" icon="inbox" n={pa.counts.complaint} label={pick(lang, 'Complaints on you', 'आप पर शिकायतें')} tone="pend" />
          <Tile href="/evidence" icon="file" n={proof} label={pick(lang, 'Proof to check', 'जाँचने योग्य सबूत')} tone="brand" />
        </div>
      </Panel>

      <Panel title={pick(lang, 'Worst hotspots', 'सबसे गंभीर हॉटस्पॉट')} action={<Link href="/findings" className="text-xs font-medium text-brand hover:underline">{pick(lang, 'All findings', 'सभी निष्कर्ष')}</Link>}>
        {hot.length === 0 ? <p className="text-sm text-ink-faint">{pick(lang, 'No hotspot in the latest round.', 'नवीनतम दौर में कोई हॉटस्पॉट नहीं।')}</p> : (
          <ul className="space-y-2.5">
            {hot.map((x) => (
              <li key={x.id}>
                <Link href={x.caseId ? `/cases/${x.caseId}` : `/findings/${x.id}`} className="group block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink group-hover:text-brand">{x.cluster}<span className="font-normal text-ink-faint"> · {x.block}</span></span>
                    <span className="tnum shrink-0 text-sm font-semibold text-crit">{x.relPp > 0 ? '+' : '−'}{Math.abs(x.relPp).toFixed(1)} pp</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                      <span className="block h-full rounded-full" style={{ width: `${Math.round((100 * Math.abs(x.relPp)) / worstRel)}%`, background: HOT_TONE[x.severity] }} />
                    </span>
                    <span className="shrink-0 text-2xs text-ink-faint">{pick(lang, 'Class', 'कक्षा')} {x.grade} · {x.competency}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={pick(lang, 'Where your cases are', 'आपके प्रकरण कहाँ हैं')} action={<Link href="/cases" className="text-xs font-medium text-brand hover:underline">{pick(lang, 'All cases', 'सभी प्रकरण')}</Link>}>
        <div className="flex h-20 items-end gap-1.5" role="img" aria-label={stages.map((s) => `${s.en}: ${s.n}`).join(', ')}>
          {stages.map((s, i) => (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="tnum text-2xs font-semibold text-ink-soft">{s.n}</span>
              <span className={`w-full rounded-t-md ${i === stages.length - 1 ? 'bg-good/70' : i >= 4 ? 'bg-brand/70' : i >= 2 ? 'bg-amber/80' : 'bg-crit/70'}`} style={{ height: `${Math.max(4, Math.round((52 * s.n) / stageMax))}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5 text-center text-[10px] leading-tight text-ink-faint">
          {stages.map((s) => <span key={s.key} className="truncate" title={pick(lang, s.en, s.hi)}>{pick(lang, ...STAGE_SHORT[s.key])}</span>)}
        </div>
      </Panel>

      <Panel title={pick(lang, 'Learning', 'अधिगम')}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="tnum text-3xl font-semibold leading-none text-ink">{trend.scope[last] ?? '—'}<span className="text-lg text-ink-faint">%</span></p>
            <p className="mt-1 text-xs text-ink-soft">{pick(lang, 'at grade level', 'ग्रेड स्तर पर')} · {trend.labels[last]}</p>
          </div>
          <p className={`tnum text-right text-sm font-semibold ${lfl === null ? 'text-ink-faint' : lfl >= 0 ? 'text-good' : 'text-crit'}`}>
            {lfl === null ? '—' : `${lfl >= 0 ? '+' : '−'}${Math.abs(lfl).toFixed(1)} pp`}
            <span className="block text-2xs font-normal text-ink-faint">{pick(lang, 'on the same round last year', 'पिछले वर्ष के इसी दौर से')}</span>
          </p>
        </div>
      </Panel>
    </>
  );

  return (
    <div className="space-y-6">
      {/* The command centre: the map, with the day's story beside it. */}
      <div className="relative -mt-2 overflow-hidden rounded-3xl border border-line bg-map" style={{ height: 'max(560px, calc(100vh - 190px))' }}>
        <Suspense fallback={<div className="skeleton h-full w-full" />}>
          <GeoMap compact bare basemap="auto" height="100%" lang={lang} reserve={{ top: 120, right: 360 }} />
        </Suspense>

        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start sm:inset-x-4 sm:top-4">
          <div className="pointer-events-auto max-w-md rounded-2xl border border-line bg-white/95 px-4 py-3.5 shadow-lift backdrop-blur">
            <p className="text-xs text-ink-faint">{greet}, {session.full_name.split(' ')[0]} · {fmtDate(sys.demoDate, false, lang)}</p>
            <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight text-ink">{scope}</h1>
            <p className="mt-1.5 text-sm leading-snug text-ink-soft">{brief.concern} {brief.geography}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link href={approver && pa.counts.approval ? '/approvals' : '/hotspots'} className="btn-primary btn-sm">
                {approver && pa.counts.approval ? pick(lang, `Decide ${pa.counts.approval} plan${pa.counts.approval === 1 ? '' : 's'}`, `${pa.counts.approval} योजनाओं पर निर्णय`) : pick(lang, 'Explore the map', 'नक्शा देखें')}
                <Icon name="arrow-right" size={14} />
              </Link>
              <span className="text-xs text-ink-faint">{h.open_cases} {pick(lang, 'open cases', 'खुले प्रकरण')} · {h.critical} {pick(lang, 'critical', 'गंभीर')}</span>
            </div>
            {claude !== null ? (
              <div className="mt-3 border-t border-line pt-3">
                <AskClaudeInline disabled={!claude}
                  placeholder={pick(lang, `Ask Claude about ${scope}…`, `${scope} के बारे में Claude से पूछें…`)}
                  button={pick(lang, 'Ask', 'पूछें')} questions={claudeQuestions} />
                {briefing ? <a href="#claude-briefing" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">{pick(lang, 'Read Claude’s briefing', 'Claude की ब्रीफ़िंग पढ़ें')}<Icon name="chevron-down" size={13} /></a> : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="absolute bottom-4 right-4 top-4 hidden w-[340px] space-y-3 overflow-y-auto pr-1 lg:block" aria-label={pick(lang, 'Today', 'आज')}>
          {cards}
        </aside>

        <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-line bg-white/90 px-3 py-2 text-2xs text-ink-soft shadow-lift sm:bottom-4 sm:left-4" aria-label={pick(lang, 'Legend', 'संकेत')}>
          {([['critical', pick(lang, 'Critical', 'गंभीर')], ['significant', pick(lang, 'Falling', 'गिरावट')], ['moderate', pick(lang, 'Watch', 'ध्यान दें')], ['stable', pick(lang, 'Stable', 'स्थिर')]] as const).map(([k, t]) => (
            <li key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLORS[k] }} />{t}</li>
          ))}
        </ul>
      </div>

      {/* On a phone and a small screen, the cards follow the map. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">{cards}</div>

      {briefing ? <div id="claude-briefing" className="scroll-mt-24"><AiBriefing fallback={brief} /></div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="lp-title">
          <h2 id="lp-title" className="mb-3 text-md font-semibold tracking-tight text-ink">{pick(lang, 'Learning over time', 'समय के साथ अधिगम')}</h2>
          <TrendChart
            xLabels={trend.labels} lang={lang}
            series={[
              { key: 'scope', label: trend.scopeLabel, color: SERIES.one, points: trend.scope },
              ...(session.scope_type !== 'state' ? [{ key: 'state', label: pick(lang, 'Whole state', 'पूरा राज्य'), color: SERIES.two, points: trend.state, dashed: true }] : []),
            ]}
            yMax={70} height={220} caption={`Percent of assessed students at grade benchmark, ${trend.scopeLabel}`}
          />
          <p className="mt-2 text-xs text-ink-faint">{pick(lang, 'Endline rounds run higher than baselines each year, so compare a round with the same round a year earlier.', 'हर वर्ष अंतिम दौर आधार से ऊँचे रहते हैं, इसलिए किसी दौर की तुलना पिछले वर्ष के उसी दौर से करें।')}</p>
        </section>
        <section className="rounded-2xl border border-line bg-white" aria-labelledby="pr-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="pr-title" className="text-md font-semibold tracking-tight text-ink">{pick(lang, 'What moved recently', 'हाल में क्या हुआ')}</h2>
            {may(session, 'audit.view') ? <Link href="/audit" className="text-sm font-medium text-brand hover:underline">{pick(lang, 'Full history', 'पूरा इतिहास')}</Link> : null}
          </header>
          <ProgressTimeline items={progress} />
        </section>
      </div>
    </div>
  );
}
