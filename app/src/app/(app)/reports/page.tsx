import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listReports, reportTypeCounts } from '@/lib/feed';
import { userNames, scopeName } from '@/lib/repo';
import { may } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { Card, PageHead, Callout, Toolbar, Empty, Mono, fmtDate } from '@/components/ui';
import { Pill, AiDrafted } from '@/components/labels';
import { FilterChips } from '@/components/lists';
import { Icon } from '@/components/Icon';
import { REPORT_TYPES } from '@/lib/reports';
import { REPORT_ICON } from '@/components/ReportsRail';

/** Generated reports: action-taken reports, review packs, escalations and briefs. */

const TYPE_LABEL: Record<string, { en: string; hi: string }> = {
  atr: { en: 'Action-taken report', hi: 'कृत कार्यवाही रिपोर्ट' },
  review_pack: { en: 'Review pack', hi: 'समीक्षा संकलन' },
  district_escalation: { en: 'District escalation', hi: 'ज़िला संदर्भ' },
  overdue_tasks: { en: 'Overdue work', hi: 'विलंबित काम' },
  learning_outcome: { en: 'Learning outcome', hi: 'अधिगम परिणाम' },
  data_quality: { en: 'Data quality', hi: 'डेटा गुणवत्ता' },
  executive_brief: { en: 'Executive brief', hi: 'कार्यकारी सारांश' },
};

export default async function ReportsPage({
  searchParams,
}: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'report.export')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Reports', 'रिपोर्ट')} />
        <Callout tone="warn">{pick(lang, 'Your role does not export reports.', 'आपकी भूमिका रिपोर्ट नहीं निकालती।')}</Callout>
      </div>
    );
  }

  const counts = reportTypeCounts(session);
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const reports = listReports(session, { type: sp.type || undefined, limit: q ? 600 : 120 }).filter((r) => !q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)).slice(0, 120);
  const users = userNames(reports.map((r) => r.generated_by));

  return (
    <div>
      <PageHead
        title={pick(lang, 'Reports', 'रिपोर्ट')}
        sub={pick(
          lang,
          'Built from the case ledger, so a report cannot say something the records do not.',
          'प्रकरण-पंजी से बनी, अतः रिपोर्ट वह नहीं कह सकती जो रिकॉर्ड में नहीं है।',
        )}
        meta={<>{scopeName(session.scope_type, session.scope_id)} · {Object.values(counts).reduce((a, b) => a + b, 0)} saved</>}
        right={<div className="flex gap-2"><Link href="/impact" className="btn-quiet"><Icon name="target" size={15} />Outcome verification</Link><Link href="/reports/new" className="btn-primary"><Icon name="plus" size={15} />New report</Link></div>}
      />
      {/* Make a report: every kind, as a picture you can pick, instead of a menu down the side. */}
      <section aria-label={pick(lang, 'Make a report', 'रिपोर्ट बनाएँ')}>
        <h2 className="label mb-2">{pick(lang, 'Make a report', 'रिपोर्ट बनाएँ')}</h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {REPORT_TYPES.map((r, i) => (
            <li key={r.key}>
              <Link href={`/reports/new?type=${r.key}`} title={r.blurb}
                className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 transition-colors hover:border-brand/40 hover:bg-brand-light/40">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${['bg-brand-light text-brand', 'bg-good-light text-good', 'bg-crit-light text-crit', 'bg-amber-light text-warn'][i % 4]}`}><Icon name={REPORT_ICON[r.key] ?? 'file'} size={19} /></span>
                <span className="mt-3 text-sm font-semibold leading-snug text-ink group-hover:text-brand">{r.label}</span>
                <span className="mt-1 line-clamp-2 text-xs text-ink-faint">{r.blurb}</span>
                {counts[r.key] ? <span className="tnum mt-auto pt-2 text-2xs text-ink-soft">{counts[r.key]} {pick(lang, 'saved', 'सहेजी')}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6">
      <Toolbar>
        <form method="get" action="/reports" className="relative">
          {sp.type ? <input type="hidden" name="type" value={sp.type} /> : null}
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder="Search report titles or ids" aria-label="Search reports" className="input h-9 w-64 pl-9 text-sm" />
        </form>
        <FilterChips
          base="/reports" param="type" current={sp.type} lang={lang}
          options={[
            { value: '', label: pick(lang, 'All', 'सभी'), count: Object.values(counts).reduce((a, b) => a + b, 0) },
            ...Object.entries(counts).map(([t, c]) => ({
              value: t,
              label: pick(lang, TYPE_LABEL[t]?.en ?? REPORT_TYPES.find((x) => x.key === t)?.label ?? t, TYPE_LABEL[t]?.hi ?? t),
              count: c,
            })),
          ]}
        />
      </Toolbar>
      <p className="mb-3 text-sm text-ink-soft"><span className="font-medium text-ink">{pick(lang, 'Saved reports', 'सहेजी रिपोर्ट')}</span> · {reports.length} {pick(lang, 'shown', 'दिखाई')}</p>
      {reports.length === 0 ? <Card><Empty /></Card> : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
              <span className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-paper-sunk text-ink-soft"><Icon name={REPORT_ICON[r.report_type] ?? 'file'} size={14} /></span>
                <span className="truncate">{pick(lang, TYPE_LABEL[r.report_type]?.en ?? REPORT_TYPES.find((x) => x.key === r.report_type)?.label ?? r.report_type, TYPE_LABEL[r.report_type]?.hi ?? r.report_type)}</span>
                <span className="ml-auto font-mono">{r.id}</span>
              </span>
              <Link href={`/reports/${r.id}`} className="mt-2 line-clamp-2 text-md font-semibold leading-snug text-ink hover:text-brand">{r.title}</Link>
              <span className="mt-1 text-xs text-ink-soft">{scopeName(r.scope_type, r.scope_id)} · <span className="tnum">{r.period_start} → {r.period_end}</span></span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Pill>{r.case_ids.length} {pick(lang, 'cases', 'प्रकरण')}</Pill>
                {r.narrative_model ? <AiDrafted lang={lang} model={r.narrative_model} /> : null}
              </span>
              <span className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-xs">
                <span className="min-w-0 truncate text-ink-faint"><span className="tnum">{fmtDate(r.generated_at)}</span> · {users.get(r.generated_by) ?? r.generated_by}</span>
                <a href={`/api/reports/${r.id}/export?format=xlsx`} className="btn-ghost btn-sm ml-auto" title="Download Excel"><Icon name="download" size={14} />XLSX</a>
                <a href={`/api/reports/${r.id}/export?format=csv`} className="btn-ghost btn-sm" title="Download CSV">CSV</a>
              </span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
