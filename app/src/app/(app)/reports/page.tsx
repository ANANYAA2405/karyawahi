import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listReports, reportTypeCounts } from '@/lib/feed';
import { userNames, scopeName } from '@/lib/repo';
import { may } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Toolbar, Empty, Mono, fmtDate } from '@/components/ui';
import { Pill, AiDrafted } from '@/components/labels';
import { FilterChips } from '@/components/lists';
import { Icon } from '@/components/Icon';
import { REPORT_TYPES } from '@/lib/reports';
import { ReportsRail } from '@/components/ReportsRail';

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
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <ReportsRail session={session} />
      <div className="min-w-0">
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
      <Card>
        <CardHead title={pick(lang, 'Generated reports', 'निर्मित रिपोर्ट')} hint={`${reports.length} ${pick(lang, 'shown', 'दिखाई')}`} />
        {reports.length === 0 ? <Empty /> : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="block px-4 py-3">
                  <span className="block text-base font-medium text-ink">{r.title}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint"><span className="font-mono">{r.id}</span> · {fmtDate(r.generated_at)} · {r.case_ids.length} cases</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Report', 'रिपोर्ट')}</th>
                  <th scope="col">{pick(lang, 'Type', 'प्रकार')}</th>
                  <th scope="col">{pick(lang, 'Scope', 'दायरा')}</th>
                  <th scope="col">{pick(lang, 'Period', 'अवधि')}</th>
                  <th scope="col">{pick(lang, 'Cases', 'प्रकरण')}</th>
                  <th scope="col">{pick(lang, 'Generated', 'निर्मित')}</th>
                  <th scope="col"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-sm">
                      <Link href={`/reports/${r.id}`} className="font-medium text-ink hover:text-brand">{r.title}</Link>
                      <p className="text-xs text-ink-faint">
                        <Mono>{r.id}</Mono>
                        {r.narrative_model ? <> · <AiDrafted lang={lang} model={r.narrative_model} /></> : null}
                      </p>
                    </td>
                    <td className="text-sm">
                      <Pill>{pick(lang, TYPE_LABEL[r.report_type]?.en ?? REPORT_TYPES.find((x) => x.key === r.report_type)?.label ?? r.report_type, TYPE_LABEL[r.report_type]?.hi ?? r.report_type)}</Pill>
                    </td>
                    <td className="text-sm">{scopeName(r.scope_type, r.scope_id)}</td>
                    <td className="tnum text-xs">{r.period_start} → {r.period_end}</td>
                    <td className="tnum text-sm">{r.case_ids.length}</td>
                    <td className="text-sm">
                      <span className="tnum">{fmtDate(r.generated_at)}</span>
                      <span className="block whitespace-nowrap text-xs text-ink-faint">{users.get(r.generated_by) ?? r.generated_by}</span>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <a href={`/api/reports/${r.id}/export?format=xlsx`} className="btn-ghost btn-sm" title="Download Excel"><Icon name="download" size={14} />XLSX</a>
                      <a href={`/api/reports/${r.id}/export?format=csv`} className="btn-ghost btn-sm" title="Download CSV">CSV</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      </div>
      </div>
    </div>
  );
}
