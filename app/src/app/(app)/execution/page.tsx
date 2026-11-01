import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, countTasks, evidenceToCheck } from '@/lib/cases';
import { listBlockers, blockerSummary, workload, blockerMeta } from '@/lib/blockers';
import { lookupsFor } from '@/lib/lookups';
import { may, grant } from '@/lib/guard';
import { today, daysBetween } from '@/lib/clock';
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

type SP = { tab?: string };
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: 'overdue', label: 'Overdue', n: counts.overdue, tone: counts.overdue ? 'text-crit' : 'text-ink', icon: 'clock' },
          { k: 'soon', label: 'Due in 7 days', n: counts.soon, tone: 'text-warn', icon: 'calendar' },
          { k: 'check', label: 'Awaiting proof check', n: counts.check, tone: 'text-pend', icon: 'check-circle' },
          { k: 'blockers', label: 'Open blockers', n: counts.blocked, tone: counts.blocked ? 'text-crit' : 'text-ink', icon: 'ban' },
        ].map((x) => (
          <Link key={x.k} href={`/execution?tab=${x.k}`} className="rounded-xl border border-line bg-white px-4 py-3 shadow-card transition-shadow hover:shadow-lift">
            <p className="flex items-center justify-between"><span className="label">{x.label}</span><Icon name={x.icon} size={16} className="text-ink-faint" /></p>
            <p className={`kpi-num mt-2 ${x.tone}`}>{x.n}</p>
          </Link>
        ))}
      </div>

      <nav aria-label="Execution views" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t) => (
          <Link key={t.key} href={`/execution?tab=${t.key}`} aria-current={t.key === tab ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${t.key === tab ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t.label}{t.n !== undefined ? <span className={`tnum rounded-full px-1.5 text-2xs font-semibold ${t.key === tab ? 'bg-brand text-white' : 'bg-paper-deep text-ink-soft'}`}>{t.n}</span> : null}
          </Link>
        ))}
      </nav>

      {['mine', 'overdue', 'soon', 'check'].includes(tab) ? (
        <section className="card overflow-hidden">
          {tasks.length === 0 ? (
            <div className="px-6 py-14 text-center"><Icon name="check-circle" size={28} className="mx-auto text-good" /><p className="mt-3 font-medium text-ink">{pick(lang, 'Nothing here', 'यहाँ कुछ नहीं')}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[860px]">
                <thead><tr><th>Task</th><th>School</th><th>Owner</th><th>Due</th><th>Status</th><th>Proof required</th></tr></thead>
                <tbody>
                  {tasks.map((t) => {
                    const late = !t.submitted_at && t.due_date < today() ? daysBetween(t.due_date, today()) : 0;
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
          )}
          {tab === 'check' && proof.length ? (
            <p className="border-t border-line bg-paper-sunk px-4 py-2.5 text-sm text-ink-soft">{proof.length} proof submission(s) are waiting for you specifically — none submitted by you. <Link href="/evidence" className="link">Open the proof queue</Link> to accept or send back.</p>
          ) : null}
        </section>
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
        <section className="card overflow-hidden">
          <header className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-md font-semibold text-ink">Workload by officer</h2>
            <p className="text-xs text-ink-faint">Open tasks per person in your scope, with plain flags. Reassigning is an officer’s decision and is never done automatically.</p>
          </header>
          {load.length === 0 ? <p className="px-6 py-12 text-center text-sm text-ink-faint">No open tasks.</p> : (
            <div className="overflow-x-auto">
              <table className="table min-w-[760px]">
                <thead><tr><th>Officer</th><th className="text-right">Open</th><th>Load</th><th className="text-right">Overdue</th><th className="text-right">Escalated</th><th className="text-right">Due this week</th><th>Flags</th></tr></thead>
                <tbody>
                  {load.slice(0, 60).map((r) => {
                    const max = Math.max(...load.map((x) => x.open));
                    return (
                      <tr key={r.user_id}>
                        <td className="text-sm font-medium text-ink">{r.name}<span className="block text-xs font-normal uppercase text-ink-faint">{r.role}</span></td>
                        <td className="tnum text-right">{r.open}</td>
                        <td className="w-40"><div className="h-2 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${r.flags.length ? 'bg-warn' : 'bg-navy-600'}`} style={{ width: `${(100 * r.open) / max}%` }} /></div></td>
                        <td className={`tnum text-right ${r.overdue ? 'text-crit' : ''}`}>{r.overdue}</td>
                        <td className="tnum text-right">{r.escalated}</td>
                        <td className="tnum text-right">{r.dueThisWeek}</td>
                        <td className="text-xs text-warn">{r.flags.join(' · ') || <span className="text-ink-faint">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
