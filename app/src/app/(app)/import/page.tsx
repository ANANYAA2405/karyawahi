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
import { ActionForm } from '@/components/ActionForm';
import { RoundImport } from '@/components/RoundImport';
import { setClockAction } from '@/lib/actions';
import { roundIsOpen } from '@/lib/write-import';
import { hasRole } from '@/lib/scope';

/**
 * Data import.
 *
 * The interesting part of an upload is not the happy path but the rows that get refused. The
 * sample files that ship with the seed include one clean file and one carrying seven distinct
 * kinds of error, so the rejection behaviour can be seen rather than described.
 */

const ERROR_EXPLANATION: Record<string, { en: string; hi: string }> = {
  unknown_school_id: {
    en: 'The school id is not in the register, or not in the uploader\'s own area. Usually a typo, a merged school, or a file sent to the wrong officer.',
    hi: 'विद्यालय आईडी पंजी में नहीं है। आमतौर पर टाइपिंग त्रुटि या विलय।',
  },
  proficient_exceeds_assessed: {
    en: 'More children were recorded as reaching the benchmark than were assessed at all. Arithmetically impossible, so the row is refused rather than clamped.',
    hi: 'मानक तक पहुँचे बच्चों की संख्या आकलित बच्चों से अधिक है। यह असंभव है, अतः पंक्ति ख़ारिज।',
  },
  duplicate_row: {
    en: 'The same school, grade and competency appears twice in one file, or is already on record for the round. Accepting both would double-count.',
    hi: 'एक ही विद्यालय, कक्षा और दक्षता दो बार आई है। दोनों लेने पर दोहरी गिनती होगी।',
  },
  invalid_date: { en: 'The date could not be read, falls outside the round\'s assessment window, or is after today on the demo clock.', hi: 'तिथि पढ़ी नहीं जा सकी, या दौर की अवधि से बाहर है।' },
  missing_required: {
    en: 'A required value was blank, or was not one the register recognises (the round being imported, grade 1–3, competency L1–L3 or N1–N3).',
    hi: 'आवश्यक मान रिक्त है, या पंजी में मान्य नहीं (दौर, कक्षा 1–3, दक्षता)।',
  },
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
  const canMoveClock = hasRole(session, 'demo_admin', 'state_admin');
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

          {nextRound && !roundIsOpen(nextRound) ? (
            <Callout tone="note" title={pick(lang, `${nextRound.code} has not opened yet`, `${nextRound.code} अभी खुला नहीं`)}>
              {pick(
                lang,
                `${nextRound.code} (${nextRound.label}) has no data yet. Results can be imported once its assessment window opens on ${nextRound.window_start}; the demo clock is currently ${today()}. Cases sitting at "waiting for the next assessment" are waiting on exactly this. The demo administrator moves the clock forward (20 Nov 2026 is a good day: the window is open and every sample row is dated on or before it).`,
                `${nextRound.code} का कोई डेटा नहीं — आकलन अवधि ${nextRound.window_start} से खुलती है, और डेमो घड़ी ${today()} पर है। डेमो प्रशासक घड़ी आगे बढ़ा सकते हैं।`,
              )}
              {canMoveClock ? (
                <div className="mt-2">
                  <ActionForm action={setClockAction} hidden={{ date: '2026-11-20' }} label={pick(lang, 'Move the demo clock to 20 Nov 2026', 'डेमो घड़ी 20 नवंबर 2026 पर करें')} />
                </div>
              ) : null}
            </Callout>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Import an assessment round', 'आकलन दौर आयात करें')}
          hint={pick(
            lang,
            'Check a file first (nothing is saved), then commit it. Detection then runs on the new round and opens cases for new hotspots.',
            'पहले फ़ाइल जाँचें (कुछ सहेजा नहीं जाता), फिर दर्ज करें। उसके बाद नए दौर पर विश्लेषण चलता है।',
          )}
        />
        <div className="card-pad space-y-3">
          <Callout tone="method" title={pick(lang, 'Sample files', 'नमूना फ़ाइलें')}>
            {pick(
              lang,
              'In the project folder: app/samples/R4_midline_BLK-01_with_errors.csv (Rampur Sadar block, with one row of each kind of mistake) and app/samples/R4_midline_BLK-01.csv (the same rows, clean). Make a file for another district or the whole state with: npm run gen:r4 -- --scope DST-01 (or --scope all). A block officer can import only their own block\'s schools; a DEO their district; the state team the whole state.',
              'प्रोजेक्ट फ़ोल्डर में: app/samples/R4_midline_BLK-01_with_errors.csv और app/samples/R4_midline_BLK-01.csv। खंड अधिकारी केवल अपने खंड के विद्यालय आयात कर सकते हैं।',
            )}
          </Callout>
          <RoundImport lang={lang} />
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
