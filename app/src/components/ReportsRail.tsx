import Link from 'next/link';
import type { Session } from '@/lib/session';
import { listReports } from '@/lib/feed';
import { REPORT_TYPES } from '@/lib/reports';
import { fmtDate } from './ui';
import { Icon } from './Icon';

/**
 * Left rail of the reports workspace: report types, recently saved snapshots, and quick
 * re-exports. Saved reports come from listReports, which is already scope-filtered.
 */

const ICON: Record<string, string> = {
  atr: 'clipboard', learning_impact: 'target', exceptions: 'alert', review_pack: 'briefcase',
  block_performance: 'map', intervention_effectiveness: 'flask', data_quality: 'database', executive_summary: 'file',
};

export function ReportsRail({ session, active, activeReport }: { session: Session; active?: string | null; activeReport?: string }) {
  const saved = listReports(session, { limit: 8 });
  return (
    <aside className="space-y-5 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:self-start lg:overflow-y-auto lg:pb-4" aria-label="Reports navigation">
      <section>
        <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Report types</p>
        <ul className="space-y-0.5">
          {REPORT_TYPES.map((r) => {
            const on = r.key === active;
            return (
              <li key={r.key}>
                <Link href={`/reports/new?type=${r.key}`} aria-current={on ? 'page' : undefined} title={r.blurb}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${on ? 'bg-white font-semibold text-ink shadow-[inset_3px_0_0_rgb(var(--c-brand))] ring-1 ring-line' : 'text-ink-soft hover:bg-white hover:text-ink'}`}>
                  <Icon name={ICON[r.key] ?? 'file'} size={15} className={on ? 'text-brand' : 'text-ink-faint'} />
                  <span className="truncate">{r.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between px-2">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Saved reports</p>
          <Link href="/reports" className="text-xs text-brand hover:text-brand-dark">All</Link>
        </div>
        {saved.length === 0 ? <p className="px-2 text-sm text-ink-faint">None saved yet.</p> : (
          <ul className="space-y-0.5">
            {saved.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} aria-current={r.id === activeReport ? 'page' : undefined}
                  className={`block rounded-lg px-2 py-1.5 ${r.id === activeReport ? 'bg-white ring-1 ring-line' : 'hover:bg-white'}`}>
                  <span className="block truncate text-sm text-ink">{r.title}</span>
                  <span className="block text-xs text-ink-faint"><span className="font-mono">{r.id}</span> · {fmtDate(r.generated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {saved.length ? (
        <section>
          <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Recent exports</p>
          <ul className="space-y-1 px-2">
            {saved.slice(0, 4).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-ink-soft">{r.id}</span>
                <span className="flex shrink-0 gap-1">
                  <a href={`/api/reports/${r.id}/export?format=xlsx`} className="rounded border border-line bg-white px-1.5 py-0.5 text-2xs text-ink-soft hover:text-ink">XLSX</a>
                  <a href={`/api/reports/${r.id}/export?format=csv`} className="rounded border border-line bg-white px-1.5 py-0.5 text-2xs text-ink-soft hover:text-ink">CSV</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
