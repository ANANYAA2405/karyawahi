import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { buildReport, REPORT_TYPES, type ReportType } from '@/lib/reports';
import { listReports, reportTypeCounts } from '@/lib/feed';
import { today, addDays } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ReportView } from '@/components/ReportView';
import { REPORT_ICON, REPORT_HI } from '@/components/ReportsRail';
import { ReportPicture, ReportTypeChips } from '@/components/ReportPicture';
import { ActionForm } from '@/components/ActionForm';
import { generateReportAction } from '@/lib/actions';

/**
 * Report builder. With no type chosen it opens on a gallery of the report kinds, each with how
 * many are already saved, and the most recent snapshots. With a type it leads with a picture of
 * what the report will say (headline figures and the size of each section), then the settings,
 * then the document preview built from current records. Saving stores a snapshot that will not
 * change when the records do. Options that do not apply to the chosen type are not shown.
 */

type SP = { type?: string; from?: string; to?: string; ev?: string; un?: string; dq?: string; sum?: string };

const OPTIONS: Record<ReportType, ('ev' | 'un' | 'dq' | 'sum')[]> = {
  atr: ['ev', 'un'], learning_impact: [], exceptions: [], review_pack: ['dq'], block_performance: [],
  intervention_effectiveness: [], data_quality: [], executive_summary: ['dq'],
};
const OPT_LABEL = {
  ev: { en: 'Include evidence (proof) status', hi: 'सबूत की स्थिति शामिल करें' },
  un: { en: 'Include unresolved cases', hi: 'अनसुलझे प्रकरण शामिल करें' },
  dq: { en: 'Include data-quality caveats', hi: 'डेटा गुणवत्ता की सावधानियाँ शामिल करें' },
  sum: { en: 'Include executive summary', hi: 'कार्यकारी सारांश शामिल करें' },
};
const TILE = ['bg-brand-light text-brand', 'bg-good-light text-good', 'bg-crit-light text-crit', 'bg-amber-light text-warn'];

export default async function ReportBuilder({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'report.export')) {
    return <div className="mx-auto max-w-2xl"><PageHead title={pick(lang, 'Reports', 'रिपोर्ट')} /><Callout tone="warn">{pick(lang, 'Your role cannot generate reports.', 'आपकी भूमिका रिपोर्ट नहीं बना सकती।')}</Callout></div>;
  }

  const type = (REPORT_TYPES.some((r) => r.key === sp.type) ? sp.type : null) as ReportType | null;
  const meta = REPORT_TYPES.find((r) => r.key === type);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -365);
  const opt = (k: 'ev' | 'un' | 'dq' | 'sum') => sp[k] !== '0';
  const preview = type ? buildReport(session, { type, from, to, includeEvidence: opt('ev'), includeUnresolved: opt('un'), includeDataQuality: opt('dq'), includeSummary: opt('sum') }) : null;
  const label = (k: string, en: string) => pick(lang, en, REPORT_HI[k]?.label ?? en);
  const blurb = (k: string, en: string) => pick(lang, en, REPORT_HI[k]?.blurb ?? en);

  // Only needed for the gallery, when no type is chosen.
  const counts = type ? {} : reportTypeCounts(session);
  const recent = type ? [] : listReports(session, { limit: 6 });

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/reports" className="link">{pick(lang, 'Reports', 'रिपोर्ट')}</Link>}
        title={meta ? label(meta.key, meta.label) : pick(lang, 'New report', 'नई रिपोर्ट')}
        sub={meta ? blurb(meta.key, meta.blurb) : pick(lang, 'Every report is derived from the current case ledger. Pick a kind, preview it, then save a snapshot.', 'हर रिपोर्ट वर्तमान प्रकरण-पंजी से बनती है। प्रकार चुनें, पूर्वावलोकन देखें, फिर सहेजें।')}
        meta={preview ? <>{preview.scope} · {from} → {to}</> : undefined}
        right={type && preview ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/reports" className="btn-quiet"><Icon name="file" size={15} />{pick(lang, 'Saved reports', 'सहेजी रिपोर्ट')}</Link>
            <ActionForm
              action={generateReportAction}
              hidden={{ type, from, to, include_evidence: opt('ev') ? '1' : '0', include_unresolved: opt('un') ? '1' : '0', include_dq: opt('dq') ? '1' : '0', include_summary: opt('sum') ? '1' : '0' }}
              label={pick(lang, 'Generate & save snapshot', 'बनाएँ और सहेजें')}
              lang={lang}
            />
          </div>
        ) : <Link href="/reports" className="btn-quiet"><Icon name="file" size={15} />{pick(lang, 'Saved reports', 'सहेजी रिपोर्ट')}</Link>}
      />

      {type && preview ? (
        <>
          <ReportTypeChips active={type} lang={lang} />

          <ReportPicture r={preview} lang={lang} />

          <form method="get" className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-white p-4" aria-label={pick(lang, 'Report settings', 'रिपोर्ट विकल्प')}>
            <input type="hidden" name="type" value={type} />
            <label><span className="label">{pick(lang, 'From', 'से')}</span><input type="date" name="from" defaultValue={from} max={to} className="input mt-1 h-9 w-44 text-sm" /></label>
            <label><span className="label">{pick(lang, 'To', 'तक')}</span><input type="date" name="to" defaultValue={to} className="input mt-1 h-9 w-44 text-sm" /></label>
            <div className="text-sm">
              <span className="label">{pick(lang, 'Scope', 'दायरा')}</span>
              <p className="mt-1 flex h-9 items-center rounded-lg border border-line bg-paper-sunk px-3 text-ink-soft">{preview.scope} <span className="ml-1 text-xs text-ink-faint">({pick(lang, 'your authorised scope', 'आपका अधिकृत दायरा')})</span></p>
            </div>
            {OPTIONS[type].map((k) => (
              <label key={k} className="flex h-9 items-center gap-2 text-sm text-ink">
                <input type="hidden" name={k} value="0" />
                <input type="checkbox" name={k} value="1" defaultChecked={opt(k)} className="h-4 w-4 accent-brand" />{pick(lang, OPT_LABEL[k].en, OPT_LABEL[k].hi)}
              </label>
            ))}
            <button type="submit" className="btn-quiet h-9"><Icon name="refresh" size={14} />{pick(lang, 'Update preview', 'पूर्वावलोकन बदलें')}</button>
          </form>

          <div className="rounded-2xl bg-paper-deep/60 p-3 sm:p-6">
            <ReportView r={preview} />
          </div>
        </>
      ) : (
        <>
          {/* The gallery: every kind of report as a picture to pick, with how many are already saved. */}
          <section aria-label={pick(lang, 'Choose a report', 'रिपोर्ट चुनें')}>
            <h2 className="label mb-2">{pick(lang, 'Choose a report', 'रिपोर्ट चुनें')}</h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {REPORT_TYPES.map((r, i) => (
                <li key={r.key}>
                  <Link href={`/reports/new?type=${r.key}`}
                    className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 transition-colors hover:border-brand/40 hover:bg-brand-light/40">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`grid h-11 w-11 place-items-center rounded-xl ${TILE[i % TILE.length]}`}><Icon name={REPORT_ICON[r.key] ?? 'file'} size={20} /></span>
                      <Icon name="arrow-right" size={15} className="text-ink-faint group-hover:text-brand" />
                    </span>
                    <span className="mt-3 text-base font-semibold leading-snug text-ink group-hover:text-brand">{label(r.key, r.label)}</span>
                    <span className="mt-1 text-sm leading-snug text-ink-soft">{blurb(r.key, r.blurb)}</span>
                    <span className="tnum mt-auto pt-3 text-2xs text-ink-faint">
                      {counts[r.key] ? `${counts[r.key]} ${pick(lang, 'saved', 'सहेजी')}` : pick(lang, 'none saved yet', 'अभी कोई नहीं')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={pick(lang, 'Recently saved', 'हाल में सहेजी')}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="label">{pick(lang, 'Recently saved', 'हाल में सहेजी')}</h2>
              <Link href="/reports" className="text-xs text-brand hover:text-brand-dark">{pick(lang, 'All saved reports', 'सभी सहेजी रिपोर्ट')}</Link>
            </div>
            {recent.length === 0 ? <p className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-8 text-center text-sm text-ink-faint">{pick(lang, 'None saved yet.', 'अभी कोई सहेजी नहीं।')}</p> : (
              <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper-sunk text-ink-soft"><Icon name={REPORT_ICON[r.report_type] ?? 'file'} size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <Link href={`/reports/${r.id}`} className="block truncate text-sm font-medium text-ink hover:text-brand">{r.title}</Link>
                      <span className="block text-xs text-ink-faint"><span className="font-mono">{r.id}</span> · <span className="tnum">{fmtDate(r.generated_at, false, lang)}</span></span>
                    </span>
                    <a href={`/api/reports/${r.id}/export?format=xlsx`} className="btn-ghost btn-sm shrink-0" title={pick(lang, 'Download Excel', 'एक्सेल डाउनलोड')}><Icon name="download" size={14} />XLSX</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
