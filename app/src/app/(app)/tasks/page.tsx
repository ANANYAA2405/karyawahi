import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, countTasks } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { today, daysBetween, addDays } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { Card, PageHead, Callout, fmtDate } from '@/components/ui';
import { TaskTable } from '@/components/lists';
import { TaskStatusPill, EvidenceTypeName } from '@/components/labels';
import { Icon } from '@/components/Icon';
import type { TaskStatus } from '@domain/types';

/**
 * My work. For a headmaster or a coordinator this is the whole application, so it opens with a
 * picture of where the work stands and what falls due, then one card per task. A table is one
 * click away for anyone who wants to scan many rows.
 */

type SP = { filter?: string; view?: string };
const FILTERS = ['todo', 'overdue', 'sent_back', 'submitted', 'verified', 'all'] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const mine = { ownerUserId: session.user_id };
  const todo: TaskStatus[] = ['assigned', 'acknowledged', 'in_progress', 'sent_back'];
  const counts = {
    todo: countTasks(session, { ...mine, status: todo }),
    overdue: countTasks(session, { ...mine, overdue: true }),
    submitted: countTasks(session, { ...mine, status: ['submitted'] }),
    verified: countTasks(session, { ...mine, status: ['verified'] }),
    sentBack: countTasks(session, { ...mine, status: ['sent_back'] }),
  };

  const f = (FILTERS as readonly string[]).includes(sp.filter ?? '') ? sp.filter! : 'todo';
  const filter =
    f === 'overdue' ? { ...mine, overdue: true }
    : f === 'submitted' ? { ...mine, status: ['submitted'] as TaskStatus[] }
    : f === 'verified' ? { ...mine, status: ['verified'] as TaskStatus[] }
    : f === 'sent_back' ? { ...mine, status: ['sent_back'] as TaskStatus[] }
    : f === 'all' ? mine
    : { ...mine, status: todo };

  const tasks = listTasks(session, { ...filter, limit: 200 });
  const look = lookupsFor(lang, {
    users: tasks.map((t) => t.owner_user_id),
    schools: tasks.map((t) => t.school_id ?? ''),
  });
  const now = today();
  const view = sp.view === 'table' ? 'table' : 'cards';
  const href = (q: { filter?: string; view?: string }) => {
    const u = new URLSearchParams({ filter: q.filter ?? f });
    if ((q.view ?? view) === 'table') u.set('view', 'table');
    return `/tasks?${u}`;
  };

  // The picture, part one: where my work stands, as one bar from "to do" to "verified".
  const working = Math.max(0, counts.todo - counts.sentBack);
  const stages = [
    { key: 'todo', label: pick(lang, 'To do', 'करना है'), n: working, bar: 'bg-brand/60', text: 'text-brand' },
    { key: 'sent_back', label: pick(lang, 'Sent back to me', 'मुझे लौटाया'), n: counts.sentBack, bar: 'bg-warn', text: 'text-warn' },
    { key: 'submitted', label: pick(lang, 'Waiting on a checker', 'जाँच की प्रतीक्षा'), n: counts.submitted, bar: 'bg-pend/70', text: 'text-pend' },
    { key: 'verified', label: pick(lang, 'Verified', 'सत्यापित'), n: counts.verified, bar: 'bg-good', text: 'text-good' },
  ];
  const stageTotal = stages.reduce((a, s) => a + s.n, 0);

  // Part two: what falls due over the next two weeks, with the late work in front of it.
  const open = listTasks(session, { ...mine, status: todo, limit: 1000 });
  const days = Array.from({ length: 14 }, (_, i) => {
    const iso = addDays(now, i);
    const d = new Date(`${iso}T00:00:00`);
    return {
      iso, n: open.filter((t) => !t.submitted_at && t.due_date === iso).length, day: d.getDate(),
      wk: d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'narrow' }), weekend: d.getDay() === 0,
    };
  });
  const dayMax = Math.max(1, counts.overdue, ...days.map((d) => d.n));
  const thisWeek = days.slice(0, 7).reduce((a, d) => a + d.n, 0);

  const chips = [
    { value: 'todo', label: pick(lang, 'To do', 'करना है'), count: counts.todo },
    { value: 'overdue', label: pick(lang, 'Overdue', 'विलंबित'), count: counts.overdue },
    { value: 'sent_back', label: pick(lang, 'Sent back', 'लौटाए'), count: counts.sentBack },
    { value: 'submitted', label: pick(lang, 'Submitted', 'जमा'), count: counts.submitted },
    { value: 'verified', label: pick(lang, 'Verified', 'सत्यापित'), count: counts.verified },
    { value: 'all', label: pick(lang, 'Everything', 'सभी'), count: undefined },
  ];

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'My tasks', 'मेरे काम')}
        sub={pick(
          lang,
          'Each task names the proof it has to produce. Submitting proof is not the same as finishing: somebody else has to check it.',
          'हर काम बताता है कि कौन सा सबूत चाहिए। सबूत जमा करना पूरा होना नहीं है — कोई और उसे जाँचेगा।',
        )}
      />

      {/* The picture: where the work stands, and what falls due. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" aria-label={pick(lang, 'My work at a glance', 'मेरा काम एक नज़र में')}>
        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'Where my work stands', 'मेरा काम कहाँ है')}</span>
            <span className="text-xs text-ink-faint"><span className="tnum kpi-num mr-1 text-ink">{stageTotal}</span>{pick(lang, 'tasks', 'काम')}</span>
          </p>
          <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-paper-deep" role="img"
            aria-label={stages.map((s) => `${s.n} ${s.label}`).join(', ')}>
            {stages.map((s) => s.n ? <span key={s.key} className={`h-full ${s.bar}`} style={{ width: `${(100 * s.n) / Math.max(1, stageTotal)}%` }} /> : null)}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stages.map((s) => (
              <li key={s.key}>
                <Link href={href({ filter: s.key })} aria-current={f === s.key ? 'true' : undefined}
                  className={`flex h-full flex-col rounded-xl border px-3 py-2 transition-colors ${f === s.key ? 'border-brand/40 bg-brand-light/50' : 'border-line hover:border-line-strong'}`}>
                  <span className="flex items-center gap-1.5 text-xs text-ink-soft"><span className={`h-2 w-2 shrink-0 rounded-full ${s.bar}`} />{s.label}</span>
                  <span className={`tnum mt-1 text-xl font-semibold ${s.n ? s.text : 'text-ink-faint'}`}>{s.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <Link href={href({ filter: counts.overdue ? 'overdue' : 'todo' })} className="rounded-2xl border border-line bg-white p-4 transition-colors hover:border-line-strong sm:p-5">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'Falling due, next two weeks', 'अगले दो सप्ताह में देय')}</span>
            <span className="text-xs text-ink-faint">
              <span className="tnum kpi-num mr-1 text-warn">{thisWeek}</span>{pick(lang, 'this week', 'इस सप्ताह')}
            </span>
          </p>
          <ol className="mt-3 grid items-end gap-1" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) repeat(14, minmax(0, 1fr))' }} aria-label={pick(lang, 'Tasks due per day', 'प्रतिदिन देय काम')}>
            <li className="flex flex-col items-center gap-1 border-r border-line pr-1" title={pick(lang, 'Already late', 'पहले से विलंबित')}>
              <span className={`tnum text-2xs ${counts.overdue ? 'font-semibold text-crit' : 'text-ink-faint'}`}>{counts.overdue || ''}</span>
              <span className="flex h-16 w-full items-end">
                <span className="w-full rounded-t-md bg-crit" style={{ height: `${counts.overdue ? Math.max(8, (100 * counts.overdue) / dayMax) : 4}%` }} />
              </span>
              <span className="text-2xs font-semibold text-crit">{pick(lang, 'Late', 'विलंब')}</span>
              <span className="text-2xs text-transparent" aria-hidden>0</span>
            </li>
            {days.map((d, i) => (
              <li key={d.iso} className="flex flex-col items-center gap-1" title={`${fmtDate(d.iso, false, lang)}: ${d.n}`}>
                <span className={`tnum text-2xs ${d.n ? 'font-semibold text-ink' : 'text-ink-faint'}`}>{d.n || ''}</span>
                <span className="flex h-16 w-full items-end">
                  <span className={`w-full rounded-t-md ${i === 0 ? 'bg-crit/70' : i < 7 ? 'bg-amber' : 'bg-brand/50'} ${d.weekend ? 'opacity-50' : ''}`} style={{ height: `${d.n ? Math.max(8, (100 * d.n) / dayMax) : 4}%` }} />
                </span>
                <span className={`text-2xs ${i === 0 ? 'font-semibold text-brand' : 'text-ink-faint'}`}>{d.wk}</span>
                <span className="tnum text-2xs text-ink-faint">{d.day}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-2xs text-ink-faint">{pick(lang, 'A reminder comes two days before a deadline. Seven days late, the work is raised to the district.', 'समय-सीमा से दो दिन पहले याद दिलाया जाता है। सात दिन विलंब पर मामला ज़िले को जाता है।')}</p>
        </Link>
      </section>

      {counts.sentBack > 0 ? (
        <Callout tone="warn" title={pick(lang, 'Some proof came back', 'कुछ सबूत लौटाए गए')}>
          {pick(
            lang,
            'A checker sent proof back with a reason. Open the task to read it and submit again.',
            'जाँचकर्ता ने कारण के साथ सबूत लौटाया है। काम खोलकर पढ़ें और फिर जमा करें।',
          )}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={pick(lang, 'Filter', 'छानें')} className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const on = c.value === f;
            return (
              <Link key={c.value} href={href({ filter: c.value })} aria-current={on ? 'true' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink'}`}>
                {c.label}{c.count !== undefined ? <span className={`tnum text-2xs font-semibold ${on ? 'text-white/80' : 'text-ink-faint'}`}>{c.count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <span className="ml-auto inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={pick(lang, 'View', 'दृश्य')}>
          <Link href={href({ view: 'cards' })} aria-current={view === 'cards' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'cards' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="grid" size={14} />{pick(lang, 'Cards', 'कार्ड')}</Link>
          <Link href={href({ view: 'table' })} aria-current={view === 'table' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'table' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="list" size={14} />{pick(lang, 'Table', 'तालिका')}</Link>
        </span>
      </div>

      <p className="text-sm text-ink-soft"><span className="font-medium text-ink">{pick(lang, 'Tasks', 'काम')}</span> · {tasks.length} {pick(lang, 'shown, soonest due first', 'दिखाए गए, जल्दी देय पहले')}</p>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
          <Icon name="check-circle" size={28} className="mx-auto text-good" />
          <p className="mt-3 font-medium text-ink">{pick(lang, 'Nothing here.', 'कुछ नहीं।')}</p>
        </div>
      ) : view === 'table' ? (
        <Card>
          <TaskTable tasks={tasks} look={look} lang={lang} today={now} emptyText={pick(lang, 'Nothing here.', 'कुछ नहीं।')} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {tasks.map((t) => {
            const late = !t.submitted_at && t.due_date < now ? daysBetween(t.due_date, now) : 0;
            const inDays = !t.submitted_at && t.due_date >= now ? daysBetween(now, t.due_date) : null;
            const stripe = t.status === 'verified' ? 'bg-good'
              : t.status === 'submitted' ? 'bg-pend/60'
              : t.status === 'sent_back' ? 'bg-warn'
              : late ? (late > 14 ? 'bg-crit' : 'bg-warn')
              : inDays !== null && inDays <= 2 ? 'bg-amber' : 'bg-brand/40';
            return (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white p-4 pl-5 transition-colors hover:border-line-strong">
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    <span className="font-mono">{t.id}</span><span>· {t.case_id}</span>
                    <span className="ml-auto shrink-0"><TaskStatusPill status={t.status} lang={lang} /></span>
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-md font-semibold leading-snug text-ink group-hover:text-brand">{pick(lang, t.title_en, t.title_hi)}</span>
                  {t.school_id ? <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink-soft"><Icon name="school" size={13} className="shrink-0 text-ink-faint" />{look.schools.get(t.school_id) ?? t.school_id}</span> : null}
                  <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-paper-sunk px-2 py-0.5 text-ink-soft"><Icon name="file" size={12} />{t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} /></span>
                    {t.cross_source ? <span className="rounded-full bg-brand-light px-2 py-0.5 text-brand">{pick(lang, 'independent check', 'स्वतंत्र जाँच')}</span> : null}
                    {t.escalated_at ? <span className="rounded-full bg-crit-light px-2 py-0.5 text-crit">{pick(lang, 'escalated', 'आगे भेजा')}</span> : null}
                  </span>
                  <span className="mt-auto flex items-center gap-2.5 border-t border-line pt-3 text-xs">
                    <span className="min-w-0 truncate text-ink-faint">{pick(lang, 'Due', 'नियत')} <span className="tnum">{fmtDate(t.due_date, false, lang)}</span></span>
                    <span className={`tnum ml-auto shrink-0 ${late ? 'font-medium text-crit' : inDays !== null && inDays <= 2 ? 'font-medium text-warn' : 'text-ink-soft'}`}>
                      <Icon name="calendar" size={12} className="mr-1 inline" />
                      {t.status === 'verified' ? pick(lang, 'checked and accepted', 'जाँचा और स्वीकारा')
                        : t.submitted_at ? pick(lang, 'proof handed in', 'सबूत जमा')
                        : late ? `${late} ${pick(lang, 'days late', 'दिन विलंब')}`
                        : inDays === 0 ? pick(lang, 'due today', 'आज देय')
                        : `${inDays} ${pick(lang, 'days left', 'दिन बाकी')}`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
