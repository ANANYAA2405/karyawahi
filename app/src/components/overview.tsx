import Link from 'next/link';
import type { PriorityItem, ProgressItem } from '@/lib/overview';
import { Icon } from './Icon';
import { fmtDate } from './ui';

/** Dashboard presentation: compact rows and strips. Every value arrives computed from the server. */

const SEV_DOT = { critical: 'bg-crit', high: 'bg-amber', medium: 'bg-navy-300' } as const;
const SEV_WORD = { critical: 'Critical', high: 'High', medium: 'Medium' } as const;
const KIND_LABEL: Record<PriorityItem['kind'], string> = {
  approval: 'Approval', overdue: 'Overdue work', evidence: 'Proof to check', no_gain: 'No gain shown',
  data_quality: 'Data quality', investigation: 'Investigation', complaint: 'Complaint',
};

/** "Requires your attention": severity · title · where · owner · when · next action. */
export function AttentionList({ items, empty }: { items: PriorityItem[]; empty: string }) {
  if (items.length === 0) {
    return <p className="flex items-center gap-2 px-5 py-10 text-sm text-ink-soft"><Icon name="check-circle" size={18} className="text-good" />{empty}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.id}>
          <Link href={it.href} className="group grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-5 py-3 hover:bg-paper-sunk">
            <span className={`dot mt-[7px] ${SEV_DOT[it.priority]}`} title={SEV_WORD[it.priority]} />
            <span className="min-w-0">
              <span className="block truncate text-base font-medium text-ink">{it.title}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-ink-faint">
                <span className="sr-only">{SEV_WORD[it.priority]} · </span>
                <span>{KIND_LABEL[it.kind]}</span>
                {it.scope ? <span className="inline-flex items-center gap-1"><Icon name="pin" size={11} />{it.scope}</span> : null}
                <span className="inline-flex items-center gap-1"><Icon name="user" size={11} />{it.owner}</span>
                <span className={`inline-flex items-center gap-1 ${/overdue/i.test(it.when) ? 'text-crit' : ''}`}><Icon name="clock" size={11} />{it.when}</span>
              </span>
            </span>
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand group-hover:underline">{it.action}<Icon name="arrow-right" size={13} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One aligned strip of metrics, each a link to its filtered view. */
export function MetricStrip({ metrics }: { metrics: { label: string; value: number | string; note?: string; href: string; tone?: 'crit' | 'warn' | 'good' | 'pend' }[] }) {
  const tone = { crit: 'text-crit', warn: 'text-warn', good: 'text-good', pend: 'text-pend' } as const;
  return (
    <div className="grid grid-cols-2 divide-line overflow-hidden rounded-xl border border-line bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
      {metrics.map((m) => (
        <Link key={m.label} href={m.href} className="group border-b border-line px-5 py-3.5 transition-colors hover:bg-paper-sunk lg:border-b-0">
          <p className="flex items-center justify-between text-xs font-medium text-ink-soft">{m.label}<Icon name="arrow-right" size={13} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" /></p>
          <p className={`kpi-num mt-1 ${m.tone ? tone[m.tone] : 'text-ink'}`}>{m.value}</p>
          {m.note ? <p className="mt-0.5 truncate text-xs text-ink-faint">{m.note}</p> : null}
        </Link>
      ))}
    </div>
  );
}

const KIND_ICON: Record<ProgressItem['kind'], { icon: string; cls: string }> = {
  approved: { icon: 'shield', cls: 'text-brand' }, evidence: { icon: 'check-circle', cls: 'text-pend' }, escalated: { icon: 'alert', cls: 'text-crit' },
  reopened: { icon: 'refresh', cls: 'text-warn' }, verified: { icon: 'target', cls: 'text-good' }, resolved: { icon: 'check', cls: 'text-good' }, other: { icon: 'activity', cls: 'text-ink-faint' },
};

export function ProgressTimeline({ items }: { items: ProgressItem[] }) {
  if (items.length === 0) return <p className="px-5 py-6 text-sm text-ink-faint">No recent progress.</p>;
  return (
    <ol className="grid gap-x-8 px-5 py-2 sm:grid-cols-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
          <Icon name={KIND_ICON[a.kind].icon} size={15} className={`mt-0.5 ${KIND_ICON[a.kind].cls}`} />
          <div className="min-w-0">
            <Link href={a.href} className="block truncate text-sm text-ink hover:text-brand">{a.text}</Link>
            <p className="text-xs text-ink-faint">{fmtDate(a.ts, true)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
