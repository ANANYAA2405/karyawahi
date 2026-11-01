import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listImports, rejectionCodeCounts } from '@/lib/feed';
import { datasets, rounds, userNames } from '@/lib/repo';
import { may } from '@/lib/guard';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Callout, Grid, Stat, Empty, Mono, fmtDate, fmtInt,
} from '@/components/ui';
import { Pill, ProvenanceChip } from '@/components/labels';

/**
 * Data import.
 *
 * The interesting part of an upload is not the happy path but the rows that get refused. The
 * sample files that ship with the seed include one clean file and one carrying seven distinct
 * kinds of error, so the rejection behaviour can be seen rather than described.
 */

const ERROR_EXPLANATION: Record<string, { en: string; hi: string }> = {
  unknown_school_id: {
    en: 'The school id is not in the register. Usually a typo or a school that has since merged.',
    hi: 'विद्यालय आईडी पंजी में नहीं है। आमतौर पर टाइपिंग त्रुटि या विलय।',
  },
  proficient_exceeds_assessed: {
    en: 'More children were recorded as reaching the benchmark than were assessed at all. Arithmetically impossible, so the row is refused rather than clamped.',
    hi: 'मानक तक पहुँचे बच्चों की संख्या आकलित बच्चों से अधिक है। यह असंभव है, अतः पंक्ति ख़ारिज।',
  },
  duplicate_row: {
    en: 'The same school, grade and competency appears twice in one file. Accepting both would double-count.',
    hi: 'एक ही विद्यालय, कक्षा और दक्षता दो बार आई है। दोनों लेने पर दोहरी गिनती होगी।',
  },
  invalid_date: { en: 'The date could not be read.', hi: 'तिथि पढ़ी नहीं जा सकी।' },
  missing_required: { en: 'A required column was blank.', hi: 'आवश्यक स्तंभ रिक्त है।' },
  non_numeric: { en: 'A count column contained something that is not a number.', hi: 'संख्या स्तंभ में अंक नहीं हैं।' },
};

export default async function ImportPage() {
  const session = await pageSession();
  const lang = await getLanguage();

  if (!may(session, 'data.import')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Data import', 'डेटा आयात')} />
        <Callout tone="warn">
          {pick(lang, 'Block officers, DEOs and the state team import data.', 'खंड अधिकारी, DEO और राज्य दल डेटा आयात करते हैं।')}
        </Callout>
      </div>
    );
  }

  const batches = listImports(session, { limit: 80 });
  const rejections = rejectionCodeCounts(session);
  const users = userNames(batches.map((b) => b.uploaded_by));
  const nextRound = rounds().find((r) => r.status === 'scheduled');
  const totalRows = batches.reduce((t, b) => t + b.total_rows, 0);
  const totalRejected = batches.reduce((t, b) => t + b.rejected_rows, 0);

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'Data import', 'डेटा आयात')}
        sub={pick(
          lang,
          'Assessment rounds, attendance and staff movement arrive as uploads. A file is validated row by row, and the rows that fail are kept with the reason rather than quietly dropped.',
          'आकलन, उपस्थिति और शिक्षक आवागमन अपलोड से आते हैं। हर पंक्ति जाँची जाती है, और असफल पंक्तियाँ कारण सहित रखी जाती हैं।',
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Batches', 'बैच')} value={batches.length} />
        <Stat label={pick(lang, 'Rows accepted', 'स्वीकृत पंक्तियाँ')} value={fmtInt(totalRows - totalRejected)} tone="good" />
        <Stat label={pick(lang, 'Rows refused', 'ख़ारिज पंक्तियाँ')} value={fmtInt(totalRejected)} tone={totalRejected > 0 ? 'warn' : 'neutral'} />
        <Stat label={pick(lang, 'Next round', 'अगला दौर')} value={<span className="text-md">{nextRound?.code ?? '—'}</span>}
          sub={nextRound ? `${nextRound.window_start} → ${nextRound.window_end}` : undefined} />
      </Grid>

      <Card>
        <CardHead
          title={pick(lang, 'Uploading a round', 'दौर अपलोड करना')}
          hint={pick(lang, 'How the wizard behaves, and what to try it with.', 'यह कैसे काम करता है, और किससे आज़माएँ।')}
        />
        <div className="card-pad space-y-3">
          <Callout tone="method" title={pick(lang, 'What happens to a file', 'फ़ाइल के साथ क्या होता है')}>
            {pick(
              lang,
              'Each row is checked against the school register and for internal consistency. Valid rows are committed as a batch with its own id and provenance; invalid rows are stored against that batch with an error code, so the person who collected the data can be told exactly which rows to fix. A batch with some bad rows commits the good ones and is marked "committed with rejections" — refusing the whole file would lose good data over somebody else\'s typo. Once committed, detection re-runs on the new round.',
              'हर पंक्ति विद्यालय पंजी और आंतरिक संगति के विरुद्ध जाँची जाती है। वैध पंक्तियाँ बैच के रूप में दर्ज होती हैं; अवैध पंक्तियाँ त्रुटि कोड सहित रखी जाती हैं। कुछ पंक्तियाँ ख़राब होने पर शेष स्वीकार होती हैं।',
            )}
          </Callout>

          <Callout tone="warn" title={pick(lang, 'Uploading is not wired up in this demo', 'इस डेमो में अपलोड सक्रिय नहीं है')}>
            {pick(
              lang,
              'This build does not accept a file: the import batches below are the ones the seed generated, with their real rejected rows. The sample files are in the project under samples/ — assessment_upload_valid.csv, assessment_upload_with_errors.csv (seven kinds of error), and assessment_R4_midline_BLK-01_SIMULATED.csv for the November round. Wiring the upload to the same validator the seed used is the obvious next step, and it is deliberately not faked here.',
              'यह संस्करण फ़ाइल स्वीकार नहीं करता: नीचे के बैच बीज द्वारा बनाए गए हैं, उनकी वास्तविक ख़ारिज पंक्तियों सहित। नमूना फ़ाइलें samples/ में हैं।',
            )}
          </Callout>

          {nextRound ? (
            <Callout tone="note" title={pick(lang, 'The November round', 'नवंबर दौर')}>
              {pick(
                lang,
                `${nextRound.code} (${nextRound.label}) has no data yet — it opens on ${nextRound.window_start}, and the demo clock is currently ${today()}. Cases sitting at "waiting for the next assessment" are waiting on exactly this. Move the clock forward from the demo admin page to see what happens next.`,
                `${nextRound.code} का कोई डेटा नहीं — यह ${nextRound.window_start} से शुरू होता है, और डेमो घड़ी ${today()} पर है।`,
              )}
            </Callout>
          ) : null}
        </div>
      </Card>

      {rejections.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Why rows get refused', 'पंक्तियाँ क्यों ख़ारिज होती हैं')}
            hint={pick(lang, 'Across every import in the data.', 'सभी आयातों में।')}
          />
          <ul className="divide-y divide-line">
            {rejections.map((r) => (
              <li key={r.error_code} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="warn">{r.error_code.replace(/_/g, ' ')}</Pill>
                  <span className="tnum text-sm font-medium text-ink">{r.c}</span>
                </div>
                {ERROR_EXPLANATION[r.error_code] ? (
                  <p className="mt-0.5 text-sm leading-snug text-ink-soft">
                    {pick(lang, ERROR_EXPLANATION[r.error_code].en, ERROR_EXPLANATION[r.error_code].hi)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'Import history', 'आयात इतिहास')} hint={`${batches.length} ${pick(lang, 'batches', 'बैच')}`} />
        {batches.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'File', 'फ़ाइल')}</th>
                  <th scope="col">{pick(lang, 'Scope', 'दायरा')}</th>
                  <th scope="col">{pick(lang, 'Rows', 'पंक्तियाँ')}</th>
                  <th scope="col">{pick(lang, 'Refused', 'ख़ारिज')}</th>
                  <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
                  <th scope="col">{pick(lang, 'Uploaded', 'अपलोड')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-xs">
                      <Link href={`/import/${b.id}`} className="link">{b.file_name}</Link>
                      <p className="text-xs text-ink-faint"><Mono>{b.id}</Mono> · {b.dataset_id}</p>
                    </td>
                    <td className="text-sm">{b.scope_type} {b.scope_id}</td>
                    <td className="tnum text-sm">{fmtInt(b.accepted_rows)} / {fmtInt(b.total_rows)}</td>
                    <td className="tnum text-sm">
                      {b.rejected_rows > 0 ? <span className="font-medium text-warn">{b.rejected_rows}</span> : <span className="text-ink-faint">0</span>}
                    </td>
                    <td>
                      <Pill tone={b.status === 'committed' ? 'good' : b.status === 'failed' ? 'critical' : 'warn'}>
                        {b.status.replace(/_/g, ' ')}
                      </Pill>
                    </td>
                    <td className="text-sm">
                      <span className="tnum">{fmtDate(b.uploaded_at)}</span>
                      <span className="block text-xs text-ink-faint">{users.get(b.uploaded_by) ?? b.uploaded_by}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Datasets', 'डेटासेट')} />
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{pick(lang, 'Dataset', 'डेटासेट')}</th>
                <th scope="col">{pick(lang, 'Provenance', 'स्रोत')}</th>
                <th scope="col">{pick(lang, 'Owner', 'स्वामी')}</th>
                <th scope="col">{pick(lang, 'Refresh', 'अद्यतन')}</th>
              </tr>
            </thead>
            <tbody>
              {datasets().map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="font-medium">{d.name}</span>
                    <p className="text-xs text-ink-soft">{d.description}</p>
                  </td>
                  <td><ProvenanceChip provenance={d.provenance} lang={lang} /></td>
                  <td className="text-sm">{d.owner_role}</td>
                  <td className="text-sm">{d.refresh_cadence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
