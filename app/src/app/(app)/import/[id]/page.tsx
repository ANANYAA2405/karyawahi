import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { getImport, importRejections } from '@/lib/feed';
import { userNames, round } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Grid, Stat, Facts, Field, Empty, Mono, fmtDate, fmtInt } from '@/components/ui';
import { Pill, ProvenanceChip } from '@/components/labels';

/** One import batch, with every row it refused and the reason. */

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;

  const b = getImport(session, id);
  if (!b) notFound();
  const rejected = importRejections(session, id);
  const users = userNames([b.uploaded_by]);
  const r = b.round_id ? round(b.round_id) : null;
  const columns = rejected.length > 0 ? Object.keys(rejected[0].raw) : [];

  return (
    <div className="space-y-4">
      <PageHead
        breadcrumb={<><Link href="/import" className="link">{pick(lang, 'Data import', 'डेटा आयात')}</Link>{' › '}<Mono>{b.id}</Mono></>}
        title={b.file_name}
        sub={r ? `${r.code} · ${r.label}` : `${b.scope_type} ${b.scope_id}`}
        right={
          <div className="flex items-center gap-2">
            <Pill tone={b.status === 'committed' ? 'good' : b.status === 'failed' ? 'critical' : 'warn'}>
              {b.status.replace(/_/g, ' ')}
            </Pill>
            <ProvenanceChip provenance={b.provenance} lang={lang} />
          </div>
        }
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Rows in the file', 'फ़ाइल में पंक्तियाँ')} value={fmtInt(b.total_rows)} />
        <Stat label={pick(lang, 'Accepted', 'स्वीकृत')} value={fmtInt(b.accepted_rows)} tone="good" />
        <Stat label={pick(lang, 'Refused', 'ख़ारिज')} value={fmtInt(b.rejected_rows)} tone={b.rejected_rows > 0 ? 'warn' : 'neutral'} />
        <Stat label={pick(lang, 'Warnings', 'चेतावनियाँ')} value={fmtInt(b.warnings)} tone={b.warnings > 0 ? 'warn' : 'neutral'} />
      </Grid>

      {b.error_summary ? (
        <Callout tone="warn" title={pick(lang, 'What went wrong', 'क्या गड़बड़ी हुई')}>{b.error_summary}</Callout>
      ) : null}

      {b.status === 'committed_with_rejections' ? (
        <Callout tone="method" title={pick(lang, 'Why the good rows were kept', 'अच्छी पंक्तियाँ क्यों रखी गईं')}>
          {pick(
            lang,
            'Refusing the whole file because of a handful of bad rows would throw away valid data over somebody else\'s typo. The accepted rows are committed, the refused ones are listed below, and whoever collected the data can be told exactly which lines to correct and resubmit.',
            'कुछ ख़राब पंक्तियों के कारण पूरी फ़ाइल ख़ारिज करने से वैध डेटा नष्ट होता। स्वीकृत पंक्तियाँ दर्ज हुईं, ख़ारिज नीचे सूचीबद्ध हैं।',
          )}
        </Callout>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'Batch details', 'बैच विवरण')} />
        <div className="card-pad">
          <Facts cols={4}>
            <Field label={pick(lang, 'Batch id', 'बैच आईडी')}><Mono>{b.id}</Mono></Field>
            <Field label={pick(lang, 'Dataset', 'डेटासेट')}><Mono>{b.dataset_id}</Mono></Field>
            <Field label={pick(lang, 'Scope', 'दायरा')}>{b.scope_type} {b.scope_id}</Field>
            <Field label={pick(lang, 'Round', 'दौर')}>{r ? `${r.code} · ${r.label}` : '—'}</Field>
            <Field label={pick(lang, 'Uploaded by', 'अपलोड किया')}>{users.get(b.uploaded_by) ?? b.uploaded_by}</Field>
            <Field label={pick(lang, 'Uploaded at', 'अपलोड समय')}><span className="tnum">{fmtDate(b.uploaded_at, true)}</span></Field>
            <Field label={pick(lang, 'Committed at', 'दर्ज समय')}><span className="tnum">{fmtDate(b.committed_at, true)}</span></Field>
            <Field label={pick(lang, 'Provenance', 'स्रोत')}><ProvenanceChip provenance={b.provenance} lang={lang} /></Field>
          </Facts>
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Rows that were refused', 'ख़ारिज पंक्तियाँ')}
          hint={pick(
            lang,
            'Kept exactly as submitted, so the original can be corrected and sent again.',
            'जैसी जमा हुई वैसी रखी गईं, ताकि सुधार कर फिर भेजी जा सकें।',
          )}
        />
        {rejected.length === 0 ? (
          <Empty>{pick(lang, 'Every row in this file was accepted.', 'इस फ़ाइल की सभी पंक्तियाँ स्वीकृत हुईं।')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Line', 'पंक्ति')}</th>
                  <th scope="col">{pick(lang, 'Problem', 'समस्या')}</th>
                  {columns.map((c) => <th key={c} scope="col">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rejected.map((row) => (
                  <tr key={row.id}>
                    <td className="tnum">{row.row_number}</td>
                    <td className="max-w-xs">
                      <Pill tone="warn">{row.error_code.replace(/_/g, ' ')}</Pill>
                      <p className="mt-0.5 text-xs text-ink-soft">{row.message}</p>
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="tnum whitespace-nowrap text-sm">{row.raw[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
