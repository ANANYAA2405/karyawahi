import Link from 'next/link';
import { Suspense } from 'react';
import type { Session } from '@/lib/session';
import { listComplaints, queueCounts, categories } from '@/lib/complaints';
import { hotspotUnits } from '@/lib/hotspots';
import { userNames } from '@/lib/repo';
import { can } from '@/lib/authz';
import { GeoMap } from './GeoMap';
import { ComplaintStatus, PriorityChip, SlaChip } from './complaint-bits';
import { Icon } from './Icon';
import { SEV_META, type Sev } from '@/lib/sev';

/** Panels composed into the role dashboards. Server components; data is scoped per session. */

export function ComplaintsPanel({ s, mode, lang = 'en' }: { s: Session; mode: 'respond' | 'mine'; lang?: 'en' | 'hi' }) {
  const L = (en: string, hi: string) => (lang === 'hi' ? hi : en);
  const list = listComplaints(s, { queue: mode === 'respond' ? 'mine' : 'submitted_by_me', limit: 6 });
  const counts = queueCounts(s);
  const names = userNames(list.flatMap((c) => [c.reporter_user_id, c.assigned_user_id ?? '']));
  const cats = new Map(categories().map((c) => [c.key, c.label]));
  return (
    <section className="card overflow-hidden" aria-labelledby={`cp-${mode}`}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <div>
          <h2 id={`cp-${mode}`} className="text-md font-semibold tracking-tight text-ink">{mode === 'respond' ? L('Complaints requiring your response', 'आपके उत्तर की प्रतीक्षा में शिकायतें') : L('Your complaints', 'आपकी शिकायतें')}</h2>
          <p className="text-sm text-ink-faint">{mode === 'respond' ? L(`${counts.mine} assigned to you · ${counts.overdue} overdue in your view · ${counts.escalated} escalated`, `${counts.mine} आपको सौंपी गईं · ${counts.overdue} विलंबित · ${counts.escalated} आगे भेजी गईं`) : L('Track what you raised and confirm resolutions.', 'आपने जो दर्ज किया उसे देखें और समाधान की पुष्टि करें।')}</p>
        </div>
        <div className="flex gap-2">
          {can(s, 'create_complaint') ? <Link href="/complaints/new" className="btn-quiet btn-sm"><Icon name="plus" size={14} />{L('Raise', 'दर्ज करें')}</Link> : null}
          <Link href={`/complaints?queue=${mode === 'respond' ? 'mine' : 'submitted_by_me'}`} className="btn-quiet btn-sm">{L('All', 'सभी')}<Icon name="arrow-right" size={14} /></Link>
        </div>
      </header>
      {list.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">{mode === 'respond' ? L('Nothing is waiting on you.', 'आप पर कुछ लंबित नहीं।') : L('You have not raised any complaints.', 'आपने कोई शिकायत दर्ज नहीं की है।')}</p> : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <Link href={`/complaints/${c.id}`} className="text-base font-medium text-ink hover:text-brand">{c.title}</Link>
                <p className="text-xs text-ink-faint"><span className="font-mono">{c.id}</span> · {cats.get(c.category_key)} · {mode === 'respond' ? `${L('from', 'द्वारा')} ${names.get(c.reporter_user_id)}` : `${L('with', 'पास:')} ${names.get(c.assigned_user_id ?? '') ?? '—'}`}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5"><ComplaintStatus status={c.status} lang={lang} /><PriorityChip p={c.priority} lang={lang} />{c.confidentiality === 'restricted' ? <span className="chip border-crit/30 bg-crit-light text-crit">{L('Restricted', 'गोपनीय')}</span> : null}<SlaChip c={c} lang={lang} /></div>
              </div>
              <Link href={`/complaints/${c.id}`} className="btn-quiet btn-sm shrink-0">{mode === 'respond' ? L('Respond', 'उत्तर दें') : L('Open', 'खोलें')}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MapPanel({ title = 'Your area on the map', height = 320, lang = 'en' }: { title?: string; height?: number; lang?: 'en' | 'hi' }) {
  const L = (en: string, hi: string) => (lang === 'hi' ? hi : en);
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <div><h2 className="text-md font-semibold tracking-tight text-ink">{title}</h2><p className="text-sm text-ink-faint">{L('Opens at your own scope. Click an area to inspect it.', 'आपके अपने क्षेत्र पर खुलता है। जानकारी के लिए क्षेत्र पर क्लिक करें।')}</p></div>
        <Link href="/hotspots" className="btn-quiet btn-sm">{L('Open map', 'नक्शा खोलें')}<Icon name="arrow-right" size={14} /></Link>
      </header>
      <div className="p-3"><Suspense fallback={<div className="skeleton w-full" style={{ height }} />}><GeoMap compact height={height} lang={lang} /></Suspense></div>
    </section>
  );
}

/** For district and state officers: the units one level down, ranked by what needs attention. */
export function PerformanceTable({ s }: { s: Session }) {
  const { level, units, pair } = hotspotUnits(s, {});
  const label = level === 'district' ? 'District' : level === 'block' ? 'Block' : level === 'cluster' ? 'Cluster' : 'School';
  const rows = [...units].sort((a, b) => b.criticalCases - a.criticalCases || b.hotChildren - a.hotChildren || b.overdueTasks - a.overdueTasks);
  return (
    <section className="card overflow-hidden" aria-labelledby="perf-title">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <div><h2 id="perf-title" className="text-md font-semibold tracking-tight text-ink">{label} performance</h2><p className="text-sm text-ink-faint">{pair ? `${pair.prev.code} → ${pair.curr.code}` : ''} · ranked by critical cases, then hot sub-areas, then overdue work</p></div>
        <Link href="/hotspots?view=list" className="btn-quiet btn-sm">Details<Icon name="arrow-right" size={14} /></Link>
      </header>
      <div className="overflow-x-auto">
        <table className="table min-w-[680px]">
          <thead><tr><th>{label}</th><th>Learning</th><th className="text-right">Hot sub-areas</th><th className="text-right">Open cases</th><th className="text-right">Critical</th><th className="text-right">Overdue tasks</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><Link href={`/hotspots?plevel=${u.level}&parent=${u.id}`} className="font-medium text-ink hover:text-brand">{u.name}</Link></td>
                <td><span className={`inline-flex items-center gap-1.5 text-sm ${SEV_META[u.severity as Sev].text}`}><span className={`h-2.5 w-2.5 rounded-sm ${SEV_META[u.severity as Sev].dot}`} />{SEV_META[u.severity as Sev].label}{u.relPp !== null && u.severity !== 'insufficient' ? ` · ${u.relPp > 0 ? '+' : ''}${u.relPp} pp` : ''}</span></td>
                <td className={`tnum text-right ${u.hotChildren ? 'font-medium text-crit' : ''}`}>{u.hotChildren}</td>
                <td className="tnum text-right">{u.openCases}</td>
                <td className={`tnum text-right ${u.criticalCases ? 'text-crit' : ''}`}>{u.criticalCases}</td>
                <td className={`tnum text-right ${u.overdueTasks ? 'text-warn' : ''}`}>{u.overdueTasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EscalationsPanel({ s }: { s: Session }) {
  const esc = listComplaints(s, { queue: 'escalated', limit: 6 });
  const names = userNames(esc.flatMap((c) => [c.assigned_user_id ?? '']));
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-md font-semibold text-ink">Escalated issues</h2>
        <Link href="/complaints?queue=escalated" className="link text-sm">All</Link>
      </header>
      {esc.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">No escalated complaints in your view.</p> : (
        <ul className="divide-y divide-line">
          {esc.map((c) => (
            <li key={c.id} className="px-4 py-2.5">
              <Link href={`/complaints/${c.id}`} className="text-sm font-medium text-ink hover:text-brand">{c.title}</Link>
              <p className="text-xs text-ink-faint">{c.id} · escalated ×{c.escalation_level} · now with {names.get(c.assigned_user_id ?? '')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
