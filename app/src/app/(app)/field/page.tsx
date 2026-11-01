import Link from 'next/link';
import { Suspense } from 'react';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, evidenceToCheck, type Task } from '@/lib/cases';
import { listComplaints, slaState, STATUS as CSTATUS, STATUS_HI as CSTATUS_HI } from '@/lib/complaints';
import { listBlockers } from '@/lib/blockers';
import { lookupsFor } from '@/lib/lookups';
import { scopeName } from '@/lib/repo';
import { all } from '@/lib/db';
import { schoolsPred, and, evidencePred } from '@/lib/scope';
import { may } from '@/lib/guard';
import { can } from '@/lib/authz';
import { today, daysBetween } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { GeoMap } from '@/components/GeoMap';
import { EvidenceTypeName } from '@/components/labels';

/**
 * Field Operations — "What must I do today, where must I go, and what needs my response?"
 *
 *   A task metrics · B priority inbox (48%) + live map of my area (52%) · C upcoming visits + evidence
 *
 * The inbox merges my own tasks, overdue school tasks in my area that I follow up, and
 * complaints assigned to me. Rows open the existing task page or the complaint drawer.
 */

type InboxRow = {
  id: string; ref: string; title: string; type: 'mine' | 'follow_up' | 'complaint'; priority: 'critical' | 'high' | 'medium' | 'low';
  where: string; due: string | null; dueLabel: string; status: string; overdue: boolean; dueToday: boolean; blocked: boolean; href: string;
};

const PRI = {
  critical: { dot: 'bg-crit', w: 'Critical', hi: 'अति गंभीर' }, high: { dot: 'bg-amber', w: 'High', hi: 'अधिक' },
  medium: { dot: 'bg-navy-300', w: 'Medium', hi: 'मध्यम' }, low: { dot: 'bg-line-strong', w: 'Low', hi: 'कम' },
} as const;
const TASK_STATUS: Record<string, [string, string]> = {
  assigned: ['Assigned', 'सौंपा गया'], acknowledged: ['Acknowledged', 'देख लिया'], in_progress: ['In progress', 'जारी'],
  sent_back: ['Proof sent back', 'सबूत लौटाया गया'], submitted: ['Proof submitted', 'सबूत जमा'], verified: ['Verified', 'सत्यापित'],
};
const TYPE: Record<InboxRow['type'], [string, string]> = { mine: ['My task', 'मेरा काम'], follow_up: ['Follow-up', 'अनुवर्ती'], complaint: ['Complaint', 'शिकायत'] };

export default async function FieldOperations({ searchParams }: { searchParams: Promise<{ inbox?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;
  const d = today();
  const role = session.roles.find((r) => ['crc', 'brc'].includes(r.role) && !r.delegated) ?? session.roles[0];
  const scope = scopeName(role.scope_type, role.scope_id);

  const open: Task['status'][] = ['assigned', 'acknowledged', 'in_progress', 'sent_back'];
  const mine = listTasks(session, { ownerUserId: session.user_id, status: open, limit: 100 });
  const followUps = listTasks(session, { overdue: true, limit: 100 }).filter((t) => t.owner_user_id !== session.user_id);
  const complaints = listComplaints(session, { queue: 'mine', limit: 50 });
  const blockedTasks = new Set(listBlockers(session, { open: true, limit: 500 }).flatMap((b) => b.task_ids));
  const look = lookupsFor(lang, { users: [...mine, ...followUps].map((t) => t.owner_user_id), schools: [...mine, ...followUps].map((t) => t.school_id ?? '').concat(complaints.map((c) => c.school_id ?? '')) });

  const taskRow = (t: Task, type: InboxRow['type']): InboxRow => {
    const late = !t.submitted_at && t.due_date < d;
    const days = daysBetween(d, t.due_date);
    return {
      id: t.id, ref: t.id, title: pick(lang, t.title_en, t.title_hi), type,
      priority: late && -days >= 14 ? 'critical' : late ? 'high' : days <= 2 ? 'medium' : 'low',
      where: t.school_id ? look.schools.get(t.school_id) ?? t.school_id : scope,
      due: t.due_date,
      dueLabel: late ? pick(lang, `${-days}d overdue`, `${-days} दिन विलंब`) : days === 0 ? pick(lang, 'Today', 'आज') : days === 1 ? pick(lang, 'Tomorrow', 'कल') : fmtDate(t.due_date, false, lang),
      status: TASK_STATUS[t.status] ? pick(lang, ...TASK_STATUS[t.status]) : t.status, overdue: late, dueToday: t.due_date === d, blocked: blockedTasks.has(t.id), href: `/tasks/${t.id}`,
    };
  };
  const rows: InboxRow[] = [
    ...complaints.map((c): InboxRow => {
      const sla = slaState(c, lang);
      return {
        id: c.id, ref: c.id, title: c.title, type: 'complaint',
        priority: (c.priority as InboxRow['priority']), where: c.school_id ? look.schools.get(c.school_id) ?? c.school_id : scope,
        due: ['submitted', 'escalated'].includes(c.status) ? c.ack_due : c.resolve_due, dueLabel: sla.label || '—',
        status: pick(lang, CSTATUS[c.status]?.label ?? c.status, CSTATUS_HI[c.status] ?? c.status), overdue: sla.tone === 'crit', dueToday: sla.days === 0, blocked: false, href: `/complaints?open=${c.id}`,
      };
    }),
    ...mine.map((t) => taskRow(t, 'mine')),
    ...followUps.slice(0, 25).map((t) => taskRow(t, 'follow_up')),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || ['critical', 'high', 'medium', 'low'].indexOf(a.priority) - ['critical', 'high', 'medium', 'low'].indexOf(b.priority) || (a.due ?? '').localeCompare(b.due ?? ''));

  const tab = ['today', 'overdue', 'blocked'].includes(sp.inbox ?? '') ? sp.inbox! : 'all';
  const shown = rows.filter((r) => tab === 'all' || (tab === 'today' && r.dueToday) || (tab === 'overdue' && r.overdue) || (tab === 'blocked' && r.blocked));
  const tabs = [
    { key: 'all', label: pick(lang, 'All', 'सभी'), n: rows.length }, { key: 'today', label: pick(lang, 'Due today', 'आज देय'), n: rows.filter((r) => r.dueToday).length },
    { key: 'overdue', label: pick(lang, 'Overdue', 'विलंबित'), n: rows.filter((r) => r.overdue).length }, { key: 'blocked', label: pick(lang, 'Blocked', 'बाधित'), n: rows.filter((r) => r.blocked).length },
  ];

  // Section C: visits and evidence.
  const sp2 = schoolsPred(session, 'sc');
  const dueVisits = all<{ id: string; name: string; last: string | null }>(
    `select sc.id, sc.name, (select max(v.visit_date) from visits v where v.school_id = sc.id) last
       from schools sc where ${sp2.sql} order by last is not null, last asc limit 6`, ...sp2.params,
  );
  const visitTasks = listTasks(session, { dueWithinDays: 14, limit: 200 }).filter((t) => t.proof_type === 'visit_log' || t.proof_type === 'spot_check_sheet' || t.proof_type === 'spot_assessment_sheet').slice(0, 6);
  const ep = and(evidencePred(session, 'e'), { sql: `e.status = 'pending' and e.submitted_by = ?`, params: [session.user_id] });
  const mySubmitted = all<{ id: string; case_id: string; task_id: string; evidence_type: string; submitted_at: string }>(`select e.id, e.case_id, e.task_id, e.evidence_type, e.submitted_at from evidence e where ${ep.sql} order by e.submitted_at desc limit 5`, ...ep.params);
  const toCheck = may(session, 'evidence.verify') ? evidenceToCheck(session, { limit: 5 }) : [];
  const needsProof = mine.filter((t) => t.status === 'sent_back' || t.status === 'in_progress').slice(0, 5);

  const metrics = [
    { label: pick(lang, 'Assigned to me', 'मुझे सौंपे गए'), value: mine.length + complaints.length, href: '/field?inbox=all' },
    { label: pick(lang, 'Due today', 'आज देय'), value: rows.filter((r) => r.dueToday).length, href: '/field?inbox=today', tone: 'text-warn' },
    { label: pick(lang, 'Overdue', 'विलंबित'), value: rows.filter((r) => r.overdue).length, href: '/field?inbox=overdue', tone: 'text-crit' },
    { label: pick(lang, 'Evidence pending', 'लंबित सबूत'), value: needsProof.length + mySubmitted.length + toCheck.length, href: '#evidence', tone: 'text-pend' },
  ];

  return (
    <div className="space-y-6">
      <PageHead
        title={pick(lang, 'Field Operations', 'क्षेत्र संचालन')}
        sub={pick(lang, 'Your assigned activities, school visits and outstanding actions.', 'आपकी गतिविधियाँ, विद्यालय भ्रमण और लंबित कार्य।')}
        meta={<><span className="inline-flex items-center gap-1"><Icon name="pin" size={12} />{scope}</span><span>{fmtDate(d, false, lang)}</span></>}
        right={can(session, 'create_complaint') ? <Link href="/complaints/new" className="btn-primary"><Icon name="plus" size={15} />{pick(lang, 'Raise an issue', 'समस्या दर्ज करें')}</Link> : undefined}
      />

      {/* A — metrics */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-white lg:grid-cols-4 lg:divide-x lg:divide-line">
        {metrics.map((m) => (
          <Link key={m.label} href={m.href} className="border-b border-line px-5 py-3 hover:bg-paper-sunk lg:border-b-0">
            <p className="text-xs font-medium text-ink-soft">{m.label}</p>
            <p className={`kpi-num mt-1 ${m.value ? m.tone ?? 'text-ink' : 'text-ink'}`}>{m.value}</p>
          </Link>
        ))}
      </div>

      {/* B — inbox + map */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,48fr)_minmax(0,52fr)]">
        <section className="flex min-h-[460px] flex-col rounded-xl border border-line bg-white" aria-labelledby="inbox-title">
          <header className="flex items-center justify-between border-b border-line px-5 pt-3">
            <h2 id="inbox-title" className="pb-3 text-md font-semibold tracking-tight text-ink">{pick(lang, 'Priority inbox', 'प्राथमिकता सूची')}</h2>
          </header>
          <nav className="flex gap-1 border-b border-line px-3" aria-label={pick(lang, 'Inbox filter', 'सूची छाँटें')}>
            {tabs.map((t) => (
              <Link key={t.key} href={`/field?inbox=${t.key}`} scroll={false} aria-current={tab === t.key ? 'page' : undefined}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm ${tab === t.key ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>
                {t.label}<span className="tnum text-xs text-ink-faint">{t.n}</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center gap-2 px-5 py-10 text-sm text-ink-soft"><Icon name="check-circle" size={18} className="text-good" />{pick(lang, 'Nothing in this view.', 'इस दृश्य में कुछ नहीं।')}</p>
          ) : (
            <ul className="flex-1 divide-y divide-line overflow-y-auto" style={{ maxHeight: 520 }}>
              {shown.slice(0, 40).map((r) => (
                <li key={`${r.type}-${r.id}`}>
                  <Link href={r.href} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-5 py-2.5 hover:bg-paper-sunk">
                    <span className={`dot mt-[7px] ${PRI[r.priority].dot}`} title={pick(lang, PRI[r.priority].w, PRI[r.priority].hi)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-ink-faint">
                        <span className="font-mono">{r.ref}</span><span>{pick(lang, ...TYPE[r.type])}</span>
                        <span className="sr-only">{pick(lang, PRI[r.priority].w, PRI[r.priority].hi)}</span>
                        <span className="inline-flex items-center gap-1"><Icon name="pin" size={10} />{r.where}</span>
                        <span>{r.status}</span>{r.blocked ? <span className="text-warn">{pick(lang, 'Blocked', 'बाधित')}</span> : null}
                      </span>
                    </span>
                    <span className={`mt-0.5 whitespace-nowrap text-xs ${r.overdue ? 'font-medium text-crit' : r.dueToday ? 'font-medium text-warn' : 'text-ink-soft'}`}>{r.dueLabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-line bg-white" aria-labelledby="fmap-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="fmap-title" className="text-md font-semibold tracking-tight text-ink">{pick(lang, 'Your area', 'आपका क्षेत्र')}</h2>
            <Link href="/hotspots" className="text-sm font-medium text-brand hover:underline">{pick(lang, 'Full map', 'पूरा नक्शा')}</Link>
          </header>
          <div className="p-3"><Suspense fallback={<div className="skeleton h-[400px] w-full" />}><GeoMap compact height={400} lang={lang} /></Suspense></div>
        </section>
      </div>

      {/* C — visits + evidence */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-white" aria-labelledby="visits-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="visits-title" className="text-md font-semibold tracking-tight text-ink">{pick(lang, 'Upcoming school visits', 'आगामी विद्यालय भ्रमण')}</h2>
            <Link href="/visits" className="text-sm font-medium text-brand hover:underline">{pick(lang, 'Visit log', 'भ्रमण लॉग')}</Link>
          </header>
          {visitTasks.length ? (
            <>
              <p className="px-5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'Scheduled by a plan', 'योजना द्वारा निर्धारित')}</p>
              <ul className="divide-y divide-line">
                {visitTasks.map((t) => (
                  <li key={t.id}><Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-paper-sunk">
                    <span className="min-w-0"><span className="block truncate text-sm text-ink">{t.school_id ? look.schools.get(t.school_id) ?? t.school_id : '—'}</span><span className="block truncate text-xs text-ink-faint">{pick(lang, t.title_en, t.title_hi)}</span></span>
                    <span className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(t.due_date, false, lang)}</span>
                  </Link></li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="px-5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'Longest without a visit', 'सबसे लंबे समय से बिना भ्रमण')}</p>
          <ul className="divide-y divide-line">
            {dueVisits.map((s) => (
              <li key={s.id}><Link href={`/schools/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-paper-sunk">
                <span className="truncate text-sm text-ink">{s.name}</span>
                <span className={`whitespace-nowrap text-xs ${!s.last || daysBetween(s.last, d) > 60 ? 'text-crit' : 'text-ink-soft'}`}>{s.last ? pick(lang, `${daysBetween(s.last, d)}d since last visit`, `पिछले भ्रमण को ${daysBetween(s.last, d)} दिन`) : pick(lang, 'never visited', 'कभी भ्रमण नहीं')}</span>
              </Link></li>
            ))}
          </ul>
        </section>

        <section id="evidence" className="scroll-mt-24 rounded-xl border border-line bg-white" aria-labelledby="ev-title">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="ev-title" className="text-md font-semibold tracking-tight text-ink">{pick(lang, 'Evidence', 'सबूत')}</h2>
            {may(session, 'evidence.verify') ? <Link href="/evidence" className="text-sm font-medium text-brand hover:underline">{pick(lang, 'Proof queue', 'सबूत कतार')}</Link> : null}
          </header>
          {needsProof.length + mySubmitted.length + toCheck.length === 0 ? <p className="px-5 py-8 text-sm text-ink-faint">{pick(lang, 'Nothing waiting.', 'कुछ लंबित नहीं।')}</p> : null}
          {needsProof.length ? (
            <>
              <p className="px-5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'Awaiting your submission', 'आपके जमा करने की प्रतीक्षा')}</p>
              <ul className="divide-y divide-line">{needsProof.map((t) => (
                <li key={t.id}><Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-paper-sunk">
                  <span className="min-w-0"><span className="block truncate text-sm text-ink">{pick(lang, t.title_en, t.title_hi)}</span><span className="text-xs text-ink-faint">{t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />{t.status === 'sent_back' ? pick(lang, ' · sent back', ' · लौटाया गया') : ''}</span></span>
                  <span className={`whitespace-nowrap text-xs ${t.due_date < d ? 'text-crit' : 'text-ink-soft'}`}>{fmtDate(t.due_date, false, lang)}</span>
                </Link></li>
              ))}</ul>
            </>
          ) : null}
          {mySubmitted.length ? (
            <>
              <p className="px-5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'Submitted, awaiting verification', 'जमा, सत्यापन प्रतीक्षित')}</p>
              <ul className="divide-y divide-line">{mySubmitted.map((e) => (
                <li key={e.id}><Link href={`/tasks/${e.task_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-paper-sunk">
                  <span className="truncate text-sm text-ink"><span className="font-mono text-xs text-ink-faint">{e.id}</span> <EvidenceTypeName type={e.evidence_type as Parameters<typeof EvidenceTypeName>[0]['type']} lang={lang} /></span>
                  <span className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(e.submitted_at, false, lang)}</span>
                </Link></li>
              ))}</ul>
            </>
          ) : null}
          {toCheck.length ? (
            <>
              <p className="px-5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'For you to verify', 'आपके सत्यापन हेतु')}</p>
              <ul className="divide-y divide-line">{toCheck.map((e) => (
                <li key={e.id}><Link href={`/cases/${e.case_id}#proof`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-paper-sunk">
                  <span className="truncate text-sm text-ink"><EvidenceTypeName type={e.evidence_type as Parameters<typeof EvidenceTypeName>[0]['type']} lang={lang} /> <span className="text-ink-faint">· {e.case_id}</span></span>
                  <span className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(e.submitted_at, false, lang)}</span>
                </Link></li>
              ))}</ul>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
