import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, countTasks, evidenceToCheck } from '@/lib/cases';
import { listBlockers, blockerSummary, workload, blockerMeta } from '@/lib/blockers';
import { lookupsFor } from '@/lib/lookups';
import { may, grant } from '@/lib/guard';
import { today, daysBetween, addDays } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, fmtDate } from '@/components/ui';
import { TaskStatusPill, EvidenceTypeName } from '@/components/labels';
import { Icon } from '@/components/Icon';
import { ActionForm, Disclose, ReasonBox } from '@/components/ActionForm';
import { updateBlockerAction } from '@/lib/actions';
import type { Task } from '@/lib/cases';

/**
 * Field execution: who owes what, what is late, what is waiting on a check, what is stuck and
 * why, and whether the work is spread sensibly. Nothing here reassigns work automatically —
 * it shows the pattern and leaves the decision to an officer with the authority.
 */

type SP = { tab?: string; view?: string };
const OPEN_STATUSES = ['assigned', 'acknowledged', 'in_progress', 'sent_back'] as const;

export default async function ExecutionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;
  const isOwner = may(session, 'task.update_own');
  const canManage = grant(session, 'task.assign') === 'yes';

  const counts = {
    mine: countTasks(session, { ownerUserId: session.user_id, status: [...OPEN_STATUSES] }),
    overdue: countTasks(session, { overdue: true }),
    soon: listTasks(session, { dueWithinDays: 7, limit: 500 }).length,
    check: countTasks(session, { awaitingVerification: true }),
    blocked: blockerSummary(session).open,
  };
  const tabs = [
    ...(isOwner ? [{ key: 'mine', label: pick(lang, 'My tasks', 'मेरे काम'), n: counts.mine }] : []),
    { key: 'overdue', label: pick(lang, 'Overdue', 'विलंबित'), n: counts.overdue },
    { key: 'soon', label: pick(lang, 'Due in 7 days', '7 दिन में'), n: counts.soon },
    { key: 'check', label: pick(lang, 'Awaiting proof check', 'सबूत जाँच प्रतीक्षित'), n: counts.check },
    { key: 'blockers', label: pick(lang, 'Blockers', 'बाधाएँ'), n: counts.blocked },
    ...(canManage || may(session, 'audit.view') ? [{ key: 'workload', label: pick(lang, 'Workload', 'कार्यभार'), n: undefined }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0].key;

  let tasks: Task[] = [];
  if (tab === 'mine') tasks = listTasks(session, { ownerUserId: session.user_id, status: [...OPEN_STATUSES], limit: 100 });
  if (tab === 'overdue') tasks = listTasks(session, { overdue: true, limit: 150 });
  if (tab === 'soon') tasks = listTasks(session, { dueWithinDays: 7, limit: 150 });
  if (tab === 'check') tasks = listTasks(session, { awaitingVerification: true, limit: 150 });
  const proof = tab === 'check' && may(session, 'evidence.verify') ? evidenceToCheck(session, { limit: 200 }) : [];
  const blockers = tab === 'blockers' ? listBlockers(session, { limit: 200 }) : [];
  const summary = tab === 'blockers' ? blockerSummary(session) : null;
  const load = tab === 'workload' ? workload(session) : [];
  const look = lookupsFor(lang, { users: tasks.map((t) => t.owner_user_id), schools: tasks.map((t) => t.school_id ?? '') });
  const blockedTasks = new Set(listBlockers(session, { open: true, limit: 500 }).flatMap((b) => b.task_ids));

  // The deadline picture: how late the late work is, and what falls due in the next two weeks.
  const now = today();
  const lateAll = listTasks(session, { overdue: true, limit: 5000 });
  const LATE_BUCKETS = [
    { en: '1–7 days', hi: '1–7 दिन', min: 1, max: 7, tone: 'bg-amber' },
    { en: '8–14 days', hi: '8–14 दिन', min: 8, max: 14, tone: 'bg-warn' },
    { en: '15–30 days', hi: '15–30 दिन', min: 15, max: 30, tone: 'bg-crit/70' },
    { en: 'Over 30 days', hi: '30 दिन से अधिक', min: 31, max: Infinity, tone: 'bg-crit' },
  ].map((b) => ({ ...b, n: lateAll.filter((t) => { const d = daysBetween(t.due_date, now); return d >= b.min && d <= b.max; }).length }));
  const lateMax = Math.max(1, ...LATE_BUCKETS.map((b) => b.n));
  const ahead = listTasks(session, { dueWithinDays: 13, limit: 5000 });
  const days = Array.from({ length: 14 }, (_, i) => {
    const iso = addDays(now, i);
    const d = new Date(`${iso}T00:00:00`);
    return { iso, n: ahead.filter((t) => t.due_date === iso).length, day: d.getDate(), wk: d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'narrow' }), weekend: d.getDay() === 0 };
  });
  const dayMax = Math.max(1, ...days.map((d) => d.n));
  const view = sp.view === 'table' ? 'table' : 'cards';
  const href = (q: { tab?: string; view?: string }) => {
    const u = new URLSearchParams({ tab: q.tab ?? tab });
    if ((q.view ?? view) === 'table') u.set('view', 'table');
    return `/execution?${u}`;
  };
  const initials = (name: string) => name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Field execution', 'क्षेत्र कार्यान्वयन')}
        sub={pick(lang, 'The work that delivers each plan: deadlines, proof, blockers and who is carrying it. Reminders go two days before a deadline; seven days late escalates to the district.', 'हर योजना का काम: समय-सीमा, सबूत, बाधाएँ और ज़िम्मेदार।')}
        right={<div className="flex gap-2">
          {may(session, 'evidence.verify') ? <Link href="/evidence" className="btn-quiet"><Icon name="check-circle" size={15} />{pick(lang, 'Proof queue', 'सबूत कतार')}</Link> : null}
          <Link href="/tasks" className="btn-quiet"><Icon name="list" size={15} />{pick(lang, 'All tasks', 'सभी काम')}</Link>
        </div>}
      />

      {/* The deadline picture. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_220px]">
        <Link href="/execution?tab=overdue" className="rounded-2xl border border-line bg-white p-4 transition-colors hover:border-line-strong sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'How late the late work is', 'विलंबित काम कितना पीछे है')}</span>
            <span className={`kpi-num ${counts.overdue ? 'text-crit' : 'text-ink'}`}>{counts.overdue}</span>
          </p>
          <ul className="mt-4 space-y-2.5">
            {LATE_BUCKETS.map((b) => (
              <li key={b.en} className="grid grid-cols-[92px_minmax(0,1fr)_32px] items-center gap-2 text-xs">
                <span className="text-ink-soft">{pick(lang, b.en, b.hi)}</span>
                <span className="h-3 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${b.tone}`} style={{ width: `${b.n ? Math.max(4, (100 * b.n) / lateMax) : 0}%` }} /></span>
                <span className="tnum text-right font-semibold text-ink">{b.n}</span>
              </li>
            ))}
          </ul>
        </Link>

        <Link href="/execution?tab=soon" className="rounded-2xl border border-line bg-white p-4 transition-colors hover:border-line-strong sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'Falling due, next two weeks', 'अगले दो सप्ताह में देय')}</span>
            <span className="text-xs text-ink-faint"><span className="tnum kpi-num mr-1 text-warn">{counts.soon}</span>{pick(lang, 'this week', 'इस सप्ताह')}</span>
          </p>
          <ol className="mt-3 grid items-end gap-1" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }} aria-label={pick(lang, 'Tasks due per day', 'प्रतिदिन देय काम')}>
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
        </Link>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {[
            { k: 'check', label: pick(lang, 'Awaiting proof check', 'सबूत जाँच प्रतीक्षित'), n: counts.check, tone: 'text-pend', icon: 'check-circle' },
            { k: 'blockers', label: pick(lang, 'Open blockers', 'खुली बाधाएँ'), n: counts.blocked, tone: counts.blocked ? 'text-crit' : 'text-ink', icon: 'ban' },
          ].map((x) => (
            <Link key={x.k} href={`/execution?tab=${x.k}`} className="flex flex-col justify-between rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:border-line-strong">
              <p className="flex items-center justify-between gap-2"><span className="label">{x.label}</span><Icon name={x.icon} size={16} className="shrink-0 text-ink-faint" /></p>
              <p className={`kpi-num mt-2 ${x.tone}`}>{x.n}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Execution views" className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const on = t.key === tab;
            return (
              <Link key={t.key} href={href({ tab: t.key })} aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink'}`}>
                {t.label}{t.n !== undefined ? <span className={`tnum text-2xs font-semibold ${on ? 'text-white/80' : 'text-ink-faint'}`}>{t.n}</span> : null}
              </Link>
            );
          })}
        </nav>
        {['mine', 'overdue', 'soon', 'check'].includes(tab) ? (
          <span className="ml-auto inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={pick(lang, 'View', 'दृश्य')}>
            <Link href={href({ view: 'cards' })} aria-current={view === 'cards' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'cards' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="grid" size={14} />{pick(lang, 'Cards', 'कार्ड')}</Link>
            <Link href={href({ view: 'table' })} aria-current={view === 'table' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'table' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="list" size={14} />{pick(lang, 'Table', 'तालिका')}</Link>
          </span>
        ) : null}
      </div>

      {['mine', 'overdue', 'soon', 'check'].includes(tab) && tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center"><Icon name="check-circle" size={28} className="mx-auto text-good" /><p className="mt-3 font-medium text-ink">{pick(lang, 'Nothing here', 'यहाँ कुछ नहीं')}</p></div>
      ) : null}

      {['mine', 'overdue', 'soon', 'check'].includes(tab) && tasks.length && view === 'cards' ? (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {tasks.map((t) => {
            const late = !t.submitted_at && t.due_date < now ? daysBetween(t.due_date, now) : 0;
            const inDays = !t.submitted_at && t.due_date >= now ? daysBetween(now, t.due_date) : null;
            const owner = look.users.get(t.owner_user_id) ?? t.owner_user_id;
            const stripe = late ? (late > 14 ? 'bg-crit' : 'bg-warn') : inDays !== null && inDays <= 2 ? 'bg-amber' : 'bg-brand/40';
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
                    {blockedTasks.has(t.id) ? <span className="rounded-full bg-warn-light px-2 py-0.5 text-warn">{pick(lang, 'blocker reported', 'बाधा दर्ज')}</span> : null}
                  </span>
                  <span className="mt-auto flex items-center gap-2.5 border-t border-line pt-3 text-xs">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-100 text-2xs font-semibold text-navy-700" title={owner}>{initials(owner)}</span>
                    <span className="min-w-0 truncate text-ink-soft">{owner}<span className="ml-1 uppercase text-ink-faint">{t.owner_role}</span></span>
                    <span className={`tnum ml-auto shrink-0 ${late ? 'font-medium text-crit' : inDays !== null && inDays <= 2 ? 'font-medium text-warn' : 'text-ink-soft'}`}>
                      <Icon name="calendar" size={12} className="mr-1 inline" />{late ? `${late} ${pick(lang, 'days late', 'दिन विलंब')}` : inDays === 0 ? pick(lang, 'due today', 'आज देय') : inDays !== null ? `${pick(lang, 'in', '')} ${inDays} ${pick(lang, 'days', 'दिन में')}` : fmtDate(t.due_date, false, lang)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {['mine', 'overdue', 'soon', 'check'].includes(tab) && tasks.length && view === 'table' ? (
        <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table min-w-[860px]">
                <thead><tr><th>Task</th><th>School</th><th>Owner</th><th>Due</th><th>Status</th><th>Proof required</th></tr></thead>
                <tbody>
                  {tasks.map((t) => {
                    const late = !t.submitted_at && t.due_date < now ? daysBetween(t.due_date, now) : 0;
                    return (
                      <tr key={t.id}>
                        <td className="max-w-md">
                          <Link href={`/tasks/${t.id}`} className="font-medium text-ink hover:text-brand">{pick(lang, t.title_en, t.title_hi)}</Link>
                          <p className="mt-0.5 text-xs text-ink-faint">
                            <span className="font-mono">{t.id}</span> · <Link href={`/cases/${t.case_id}`} className="hover:text-brand">{t.case_id}</Link>
                            {t.escalated_at ? <span className="text-crit"> · escalated</span> : null}
                            {blockedTasks.has(t.id) ? <span className="text-warn"> · blocker reported</span> : null}
                          </p>
                        </td>
                        <td className="text-sm">{t.school_id ? <Link href={`/schools/${t.school_id}`} className="hover:text-brand">{look.schools.get(t.school_id) ?? t.school_id}</Link> : '—'}</td>
                        <td className="text-sm">{look.users.get(t.owner_user_id) ?? t.owner_user_id}<span className="block text-xs uppercase text-ink-faint">{t.owner_role}</span></td>
                        <td className={`tnum whitespace-nowrap text-sm ${late ? 'font-medium text-crit' : ''}`}>{fmtDate(t.due_date)}{late ? <span className="block text-xs">{late} days late</span> : null}</td>
                        <td><TaskStatusPill status={t.status} lang={lang} /></td>
                        <td className="text-sm text-ink-soft">{t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />{t.cross_source ? <span className="block text-xs text-brand">independent check</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        </section>
      ) : null}

      {tab === 'check' && proof.length ? (
        <p className="rounded-xl border border-line bg-paper-sunk px-4 py-2.5 text-sm text-ink-soft">{proof.length} proof submission(s) are waiting for you specifically — none submitted by you. <Link href="/evidence" className="link">Open the proof queue</Link> to accept or send back.</p>
      ) : null}

      {tab === 'blockers' && summary ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="card overflow-hidden">
            <header className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-md font-semibold text-ink">Reported blockers</h2>
              <p className="text-xs text-ink-faint">Report a new one from any task page. Rows marked “derived” come from reasons the seed already records for deadline changes and reassignments.</p>
            </header>
            {blockers.length === 0 ? <p className="px-6 py-12 text-center text-sm text-ink-faint">No blockers reported in your scope.</p> : (
              <ul className="divide-y divide-line">
                {blockers.map((b) => (
                  <li key={b.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${b.status === 'resolved' ? 'border-good/30 bg-good-light text-good' : b.status === 'escalated' ? 'border-crit/30 bg-crit-light text-crit' : 'border-warn/30 bg-warn-light text-warn'}`}>{b.status}</span>
                      <span className="text-sm font-semibold text-ink">{blockerMeta(b.blocker_type).label}</span>
                      <span className={`chip ${b.severity === 'high' ? 'border-crit/30 bg-crit-light text-crit' : 'border-line-strong bg-paper-sunk text-ink-soft'}`}>{b.severity}</span>
                      {b.source === 'derived_from_seed' ? <span className="chip border-line-strong bg-white text-ink-faint">derived</span> : null}
                      <span className="ml-auto font-mono text-xs text-ink-faint">{b.id}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{b.description}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      <Link href={`/cases/${b.case_id}`} className="hover:text-brand">{b.case_id}</Link> · tasks {b.task_ids.map((t) => <Link key={t} href={`/tasks/${t}`} className="hover:text-brand">{t} </Link>)}· reported {fmtDate(b.reported_at)} ({daysBetween(b.reported_at.slice(0, 10), today())}d) · responsible: {b.responsible_level}
                      {b.resolution ? ` · ${b.resolution}` : ''}
                    </p>
                    {b.status !== 'resolved' ? (
                      <p className="mt-1.5 rounded-md bg-paper-sunk px-2.5 py-1.5 text-xs text-ink-soft"><Icon name="info" size={12} className="mr-1 inline text-brand" />Suggested: {blockerMeta(b.blocker_type).fix}</p>
                    ) : null}
                    {b.status !== 'resolved' && (canManage || b.reported_by === session.user_id) ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Disclose label="Resolve…">
                          <ActionForm action={updateBlockerAction} hidden={{ blocker_id: b.id, action: 'resolve' }} label="Mark resolved" tone="good">
                            <ReasonBox name="note" required label="How was it resolved?" rows={2} />
                          </ActionForm>
                        </Disclose>
                        {canManage && b.status === 'open' ? (
                          <Disclose label="Escalate…">
                            <ActionForm action={updateBlockerAction} hidden={{ blocker_id: b.id, action: 'escalate' }} label="Escalate to next level" tone="quiet">
                              <ReasonBox name="note" required label="What is needed from the next level?" rows={2} />
                            </ActionForm>
                          </Disclose>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <aside className="space-y-4">
            <section className="card p-4">
              <h2 className="text-base font-semibold text-ink">What is blocking work</h2>
              <p className="mb-3 text-xs text-ink-faint">Open blockers grouped by type.</p>
              {summary.byType.length === 0 ? <p className="text-sm text-ink-faint">Nothing open.</p> : (
                <ul className="space-y-3">
                  {summary.byType.map((t) => (
                    <li key={t.type}>
                      <p className="flex items-center justify-between text-sm"><span className="font-medium text-ink">{t.label}</span><span className="tnum font-semibold text-ink">{t.n}</span></p>
                      <p className="text-xs text-ink-faint">{t.tasks} task(s) · oldest {t.oldestDays}d · {t.level} authority</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-warn" style={{ width: `${(100 * t.n) / Math.max(...summary.byType.map((x) => x.n))}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      ) : null}

      {tab === 'workload' ? (
        <section className="rounded-2xl border border-line bg-white">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-md font-semibold text-ink">{pick(lang, 'Workload by officer', 'अधिकारी-वार कार्यभार')}</h2>
              <p className="text-xs text-ink-faint">{pick(lang, 'Open tasks per person in your scope. Reassigning is an officer’s decision and is never done automatically.', 'हर व्यक्ति के खुले काम। काम सौंपना अधिकारी का निर्णय है।')}</p>
            </div>
            <p className="flex flex-wrap gap-3 text-2xs text-ink-soft">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-crit" />{pick(lang, 'Overdue', 'विलंबित')}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" />{pick(lang, 'Due this week', 'इस सप्ताह')}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-navy-600/60" />{pick(lang, 'Other open', 'अन्य खुले')}</span>
            </p>
          </header>
          {load.length === 0 ? <p className="px-6 py-12 text-center text-sm text-ink-faint">No open tasks.</p> : (
            <ul className="divide-y divide-line">
              {load.slice(0, 60).map((r) => {
                const max = Math.max(...load.map((x) => x.open));
                const rest = Math.max(0, r.open - r.overdue - r.dueThisWeek);
                return (
                  <li key={r.user_id} className="grid items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[220px_minmax(0,1fr)_200px] sm:px-5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy-100 text-2xs font-semibold text-navy-700">{initials(r.name)}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{r.name}</span><span className="block text-2xs uppercase text-ink-faint">{r.role}</span></span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex h-3.5 overflow-hidden rounded-full bg-paper-deep" style={{ width: `${Math.max(6, (100 * r.open) / max)}%` }} role="img" aria-label={`${r.open} open, ${r.overdue} overdue, ${r.dueThisWeek} due this week`}>
                        <span className="h-full bg-crit" style={{ width: `${(100 * r.overdue) / r.open}%` }} />
                        <span className="h-full bg-amber" style={{ width: `${(100 * r.dueThisWeek) / r.open}%` }} />
                        <span className="h-full bg-navy-600/60" style={{ width: `${(100 * rest) / r.open}%` }} />
                      </span>
                      <span className="tnum text-sm font-semibold text-ink">{r.open}</span>
                    </span>
                    <span className="text-xs">
                      {r.overdue ? <span className="tnum mr-2 text-crit">{r.overdue} {pick(lang, 'late', 'विलंबित')}</span> : null}
                      {r.escalated ? <span className="tnum mr-2 text-ink-soft">{r.escalated} {pick(lang, 'escalated', 'आगे भेजे')}</span> : null}
                      {r.flags.length ? <span className="text-warn">{r.flags.join(' · ')}</span> : !r.overdue && !r.escalated ? <span className="text-ink-faint">—</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
