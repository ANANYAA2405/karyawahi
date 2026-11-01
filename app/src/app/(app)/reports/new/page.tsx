import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { buildReport, REPORT_TYPES, type ReportType } from '@/lib/reports';
import { today, addDays } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, Callout } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ReportView } from '@/components/ReportView';
import { ReportsRail } from '@/components/ReportsRail';
import { ActionForm } from '@/components/ActionForm';
import { generateReportAction } from '@/lib/actions';

/**
 * Report workspace. Left: report types, saved reports, recent exports. Main: configuration,
 * then a document preview built from current records; saving stores a snapshot that will not
 * change when the records do. Options that do not apply to the chosen type are not shown.
 */

type SP = { type?: string; from?: string; to?: string; ev?: string; un?: string; dq?: string; sum?: string };

const OPTIONS: Record<ReportType, ('ev' | 'un' | 'dq' | 'sum')[]> = {
  atr: ['ev', 'un'], learning_impact: [], exceptions: [], review_pack: ['dq'], block_performance: [],
  intervention_effectiveness: [], data_quality: [], executive_summary: ['dq'],
};
const OPT_LABEL = { ev: 'Include evidence (proof) status', un: 'Include unresolved cases', dq: 'Include data-quality caveats', sum: 'Include executive summary' };

export default async function ReportBuilder({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'report.export')) {
    return <div className="mx-auto max-w-2xl"><PageHead title="Reports" /><Callout tone="warn">Your role cannot generate reports.</Callout></div>;
  }

  const type = (REPORT_TYPES.some((r) => r.key === sp.type) ? sp.type : null) as ReportType | null;
  const meta = REPORT_TYPES.find((r) => r.key === type);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -365);
  const opt = (k: 'ev' | 'un' | 'dq' | 'sum') => sp[k] !== '0';
  const preview = type ? buildReport(session, { type, from, to, includeEvidence: opt('ev'), includeUnresolved: opt('un'), includeDataQuality: opt('dq'), includeSummary: opt('sum') }) : null;

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/reports" className="link">{pick(lang, 'Reports', 'रिपोर्ट')}</Link>}
        title={meta ? meta.label : pick(lang, 'New report', 'नई रिपोर्ट')}
        sub={meta ? meta.blurb : pick(lang, 'Every report is derived from the current case ledger. Preview it, then save a snapshot.', 'हर रिपोर्ट वर्तमान प्रकरण-पंजी से बनती है।')}
        meta={preview ? <>{preview.scope} · {from} → {to}</> : undefined}
        right={type && preview ? (
          <ActionForm
            action={generateReportAction}
            hidden={{ type, from, to, include_evidence: opt('ev') ? '1' : '0', include_unresolved: opt('un') ? '1' : '0', include_dq: opt('dq') ? '1' : '0', include_summary: opt('sum') ? '1' : '0' }}
            label="Generate & save snapshot"
          />
        ) : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <ReportsRail session={session} active={type} />

        <div className="min-w-0 space-y-5">
          {type && preview ? (
            <>
              <form method="get" className="card flex flex-wrap items-end gap-4 p-4" aria-label="Report configuration">
                <input type="hidden" name="type" value={type} />
                <label><span className="label">From</span><input type="date" name="from" defaultValue={from} max={to} className="input mt-1 h-9 w-44 text-sm" /></label>
                <label><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input mt-1 h-9 w-44 text-sm" /></label>
                <div className="text-sm">
                  <span className="label">Scope</span>
                  <p className="mt-1 flex h-9 items-center rounded-lg border border-line bg-paper-sunk px-3 text-ink-soft">{preview.scope} <span className="ml-1 text-xs text-ink-faint">(your authorised scope)</span></p>
                </div>
                {OPTIONS[type].map((k) => (
                  <label key={k} className="flex h-9 items-center gap-2 text-sm text-ink">
                    <input type="hidden" name={k} value="0" />
                    <input type="checkbox" name={k} value="1" defaultChecked={opt(k)} className="h-4 w-4 accent-brand" />{OPT_LABEL[k]}
                  </label>
                ))}
                <button type="submit" className="btn-quiet h-9"><Icon name="refresh" size={14} />Update preview</button>
              </form>
              <div className="rounded-xl bg-paper-deep/60 p-3 sm:p-6">
                <ReportView r={preview} />
              </div>
            </>
          ) : (
            <section aria-label="Choose a report">
              <ul className="grid gap-3 sm:grid-cols-2">
                {REPORT_TYPES.map((r) => (
                  <li key={r.key}>
                    <Link href={`/reports/new?type=${r.key}`} className="group block h-full rounded-xl border border-line bg-white p-4 transition-colors hover:border-brand/50">
                      <span className="flex items-center justify-between text-base font-semibold text-ink">{r.label}<Icon name="arrow-right" size={15} className="text-ink-faint group-hover:text-brand" /></span>
                      <span className="mt-1 block text-sm leading-snug text-ink-soft">{r.blurb}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
