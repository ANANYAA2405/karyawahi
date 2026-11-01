import Link from 'next/link';
import type { Complaint } from '@/lib/complaints';
import { STATUS, slaState } from '@/lib/complaints';
import { Icon } from './Icon';

/** Shared complaint presentation. */

const TONE = {
  neutral: 'border-line-strong bg-paper-sunk text-ink-soft', pending: 'border-pend/30 bg-pend-light text-pend',
  active: 'border-brand/30 bg-brand-light text-brand', good: 'border-good/30 bg-good-light text-good',
  warn: 'border-warn/30 bg-warn-light text-warn', critical: 'border-crit/30 bg-crit-light text-crit',
} as const;

export function ComplaintStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <span className={`chip ${TONE[s.tone]}`}>{s.label}</span>;
}

export function PriorityChip({ p }: { p: string }) {
  const cls = p === 'critical' ? TONE.critical : p === 'high' ? TONE.warn : TONE.neutral;
  return <span className={`chip ${cls}`}>{p[0].toUpperCase() + p.slice(1)}</span>;
}

export function SlaChip({ c }: { c: Complaint }) {
  const s = slaState(c);
  if (s.tone === 'none') return null;
  const cls = s.tone === 'crit' ? 'text-crit' : s.tone === 'warn' ? 'text-warn' : 'text-ink-faint';
  return <span className={`inline-flex items-center gap-1 text-xs ${cls}`}><Icon name="clock" size={12} />{s.label}</span>;
}

export function ComplaintRow({ c, names, categories, mine }: { c: Complaint; names: Map<string, string>; categories: Map<string, string>; mine?: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3.5 hover:bg-paper-sunk/60 sm:px-5">
      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${c.confidentiality === 'restricted' ? 'bg-crit-light text-crit' : 'bg-paper-deep text-ink-soft'}`}>
        <Icon name={c.confidentiality === 'restricted' ? 'lock' : 'inbox'} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/complaints/${c.id}`} className="text-base font-semibold text-ink hover:text-brand">{c.title}</Link>
          {mine ? <span className="chip border-navy/30 bg-navy-100 text-navy-700">Yours to act on</span> : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-faint">
          <span className="font-mono">{c.id}</span> · {categories.get(c.category_key) ?? c.category_key} · from {names.get(c.reporter_user_id) ?? c.reporter_user_id}
          {c.escalation_level > 0 ? <span className="text-crit"> · escalated ×{c.escalation_level}</span> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <ComplaintStatus status={c.status} />
          <PriorityChip p={c.priority} />
          {c.confidentiality === 'restricted' ? <span className="chip border-crit/30 bg-crit-light text-crit">Restricted</span> : null}
          <SlaChip c={c} />
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-ink-faint">
        <p>With <span className="font-medium text-ink-soft">{names.get(c.assigned_user_id ?? '') ?? '—'}</span></p>
        <p className="uppercase">{c.assigned_role ?? ''}</p>
      </div>
    </li>
  );
}
