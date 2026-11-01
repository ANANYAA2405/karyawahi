import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { getReport } from '@/lib/feed';
import { userNames, scopeName } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Facts, Field, Mono, fmtDate } from '@/components/ui';
import { Pill, AiDrafted } from '@/components/labels';
import { DISCLAIMER } from '@domain/catalog';
import { ReportView } from '@/components/ReportView';
import { ReportsRail } from '@/components/ReportsRail';
import { PrintButton } from '@/components/PrintButton';
import { Icon } from '@/components/Icon';
import type { BuiltReport } from '@/lib/reports';

function ExportBar({ id, type, snapshot }: { id: string; type: string; snapshot: boolean }) {
  const regen = ['atr', 'learning_impact', 'exceptions', 'review_pack', 'block_performance', 'intervention_effectiveness', 'data_quality', 'executive_summary'].includes(type)
    ? type : type === 'learning_outcome' ? 'learning_impact' : type === 'overdue_tasks' || type === 'district_escalation' ? 'exceptions' : type === 'executive_brief' ? 'executive_summary' : 'atr';
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <a href={`/api/reports/${id}/export?format=xlsx`} className="btn-quiet btn-sm"><Icon name="download" size={14} />Excel</a>
      <a href={`/api/reports/${id}/export?format=csv`} className="btn-quiet btn-sm"><Icon name="download" size={14} />CSV</a>
      <PrintButton />
      <Link href={`/reports/new?type=${regen}`} className="btn-primary btn-sm" title={snapshot ? 'This page is a frozen snapshot; regenerate to use current records' : undefined}><Icon name="refresh" size={14} />Regenerate from current records</Link>
    </div>
  );
}

/** One report, laid out to be read on screen or printed for a meeting. */

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-ink-faint">—</span>;
  if (typeof v === 'boolean') return <>{v ? 'yes' : 'no'}</>;
  if (typeof v === 'number') return <span className="tnum">{v.toLocaleString('en-IN')}</span>;
  if (typeof v === 'string') return <>{v}</>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-ink-faint">—</span>;
    if (v.every((x) => typeof x !== 'object')) {
      return <>{v.map((x) => String(x)).join(', ')}</>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {Object.keys(v[0] as Record<string, unknown>).map((k) => (
                <th key={k} scope="col">{k.replace(/_/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(v as Record<string, unknown>[]).map((row, i) => (
              <tr key={i}>
                {Object.keys(v[0] as Record<string, unknown>).map((k) => (
                  <td key={k} className="text-sm"><Value v={row[k]} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <dl className="space-y-1">
      {Object.entries(v as Record<string, unknown>).map(([k, val]) => (
        <div key={k} className="flex flex-wrap gap-2">
          <dt className="text-xs text-ink-faint">{k.replace(/_/g, ' ')}:</dt>
          <dd className="text-sm text-ink"><Value v={val} /></dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ generated?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const r = getReport(session, id);
  if (!r) notFound();
  const users = userNames([r.generated_by]);
  const { generated } = await searchParams;

  if ((r.content as { builder?: string }).builder === 'v2') {
    const built = r.content as unknown as BuiltReport;
    return (
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="no-print"><ReportsRail session={session} activeReport={r.id} /></div>
        <article className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <p className="text-sm text-ink-faint">Snapshot <Mono>{r.id}</Mono> · {fmtDate(r.generated_at, true)} · {users.get(r.generated_by) ?? r.generated_by} · figures frozen at that moment</p>
            <ExportBar id={r.id} type={r.report_type} snapshot />
          </div>
          {generated ? <Callout tone="good" title="Report generated">Saved as snapshot {r.id} and recorded in the audit trail. It will not change when the records do.</Callout> : null}
          <div className="rounded-xl bg-paper-deep/60 p-3 sm:p-6 print:bg-white print:p-0">
            <ReportView r={built} snapshotId={r.id} />
          </div>
        </article>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-4xl space-y-4">
      <PageHead
        breadcrumb={<><Link href="/reports" className="link">{pick(lang, 'Reports', 'रिपोर्ट')}</Link>{' › '}<Mono>{r.id}</Mono></>}
        title={r.title}
        sub={`${scopeName(r.scope_type, r.scope_id)} · ${r.period_start} → ${r.period_end}`}
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill>{r.report_type.replace(/_/g, ' ')}</Pill>
            <ExportBar id={r.id} type={r.report_type} snapshot />
            {r.narrative_model ? <AiDrafted lang={lang} model={r.narrative_model} /> : null}
          </div>
        }
      />

      {r.demo_disclaimer ? (
        <Callout tone="warn" title={pick(lang, 'Read this first', 'पहले यह पढ़ें')}>
          {DISCLAIMER}
          {pick(
            lang,
            ' Every figure below is generated for the demo. Nothing in it may be quoted as a government statistic.',
            ' नीचे का हर आँकड़ा डेमो के लिए बनाया गया है।',
          )}
        </Callout>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'About this report', 'इस रिपोर्ट के बारे में')} />
        <div className="card-pad">
          <Facts cols={3}>
            <Field label={pick(lang, 'Generated', 'निर्मित')}>
              <span className="tnum">{fmtDate(r.generated_at, true)}</span>
            </Field>
            <Field label={pick(lang, 'By', 'द्वारा')}>{users.get(r.generated_by) ?? r.generated_by}</Field>
            <Field label={pick(lang, 'Formats offered', 'उपलब्ध प्रारूप')}>{r.formats.join(', ').toUpperCase()}</Field>
            <Field label={pick(lang, 'Cases covered', 'सम्मिलित प्रकरण')}>
              <span className="tnum">{r.case_ids.length}</span>
            </Field>
            {r.narrative_model ? (
              <Field label={pick(lang, 'Narrative drafted by', 'विवरण तैयार')}><Mono>{r.narrative_model}</Mono></Field>
            ) : null}
          </Facts>
        </div>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Contents', 'सामग्री')} />
        <div className="card-pad space-y-4">
          {Object.entries(r.content).map(([k, v]) => (
            <section key={k}>
              <h3 className="h-section mb-1.5">{k.replace(/_/g, ' ')}</h3>
              <div className="text-sm leading-relaxed text-ink"><Value v={v} /></div>
            </section>
          ))}
          {Object.keys(r.content).length === 0 ? (
            <p className="text-base text-ink-faint">{pick(lang, 'This report has no stored content.', 'इस रिपोर्ट में कोई सामग्री नहीं।')}</p>
          ) : null}
        </div>
      </Card>

      {r.case_ids.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Cases in this report', 'इस रिपोर्ट के प्रकरण')} />
          <ul className="card-pad flex flex-wrap gap-2">
            {r.case_ids.map((cid) => (
              <li key={cid}>
                <Link href={`/cases/${cid}`} className="chip border-line-strong bg-white text-ink-soft hover:bg-paper-sunk">
                  <Mono>{cid}</Mono>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </article>
  );
}
