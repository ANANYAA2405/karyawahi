'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { previewImportAction, commitImportAction } from '@/lib/actions-import';
import type { ImportPreview, CommitResult } from '@/lib/write-import';
import { Callout, Grid, Stat, Mono, fmtInt } from '@/components/ui';
import { Pill } from '@/components/labels';
import type { Language } from '@domain/types';

/**
 * The round-import wizard: choose a CSV → check it (nothing is saved) → commit → see what the
 * detection run found.
 *
 * The browser only reads the file and shows what the server says. Both steps send the file
 * text to the server, which re-runs every check; the commit also carries the fingerprint of
 * the previewed file so a different file cannot slip in between the two clicks.
 */

const t = (lang: Language, en: string, hi: string) => (lang === 'hi' ? hi : en);

export function RoundImport({ lang }: { lang: Language }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function choose(f: File | undefined) {
    setPreview(null); setResult(null); setError(null);
    if (!f) { setFile(null); return; }
    setFile({ name: f.name, text: await f.text() });
  }

  function check() {
    if (!file) return;
    setError(null); setResult(null);
    start(async () => {
      const r = await previewImportAction(file.name, file.text);
      if (r.error) { setError(r.error); setPreview(null); } else setPreview(r.preview ?? null);
    });
  }

  function commit() {
    if (!file || !preview) return;
    setError(null);
    start(async () => {
      const r = await commitImportAction(file.name, file.text, preview.fingerprint);
      if (r.error) setError(r.error); else { setResult(r.result ?? null); setPreview(null); }
    });
  }

  return (
    <div className="space-y-3" data-testid="round-import">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t(lang, 'Assessment results file (CSV)', 'आकलन परिणाम फ़ाइल (CSV)')}</span>
          <input
            type="file" accept=".csv,text/csv" className="input mt-1 block"
            aria-label={t(lang, 'Choose a CSV file', 'CSV फ़ाइल चुनें')}
            onChange={(e) => { void choose(e.target.files?.[0]); }}
          />
        </label>
        <button type="button" className="btn-primary" disabled={!file || pending} onClick={check}>
          {pending && !preview ? t(lang, 'Checking…', 'जाँच हो रही है…') : t(lang, 'Check the file', 'फ़ाइल जाँचें')}
        </button>
      </div>
      <p className="text-[12.5px] leading-snug text-ink-faint">
        {t(
          lang,
          'Columns: round_code, school_id, grade, competency_code, enrolled, n_assessed, n_proficient, assessment_date. Checking saves nothing.',
          'स्तंभ: round_code, school_id, grade, competency_code, enrolled, n_assessed, n_proficient, assessment_date। जाँच में कुछ सहेजा नहीं जाता।',
        )}
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-[13px] leading-relaxed text-crit">
          <span className="font-semibold">{t(lang, 'Refused. ', 'अस्वीकृत। ')}</span>{error}
        </p>
      ) : null}

      {preview ? <PreviewPanel p={preview} lang={lang} pending={pending} onCommit={commit} /> : null}
      {result ? <ResultPanel r={result} lang={lang} /> : null}
    </div>
  );
}

function PreviewPanel({ p, lang, pending, onCommit }: { p: ImportPreview; lang: Language; pending: boolean; onCommit: () => void }) {
  const canCommit = !p.fatal && !p.duplicateOf && p.accepted > 0;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-paper-sunk p-3" data-testid="import-preview">
      <p className="text-[13.5px] font-semibold text-ink">
        {t(lang, 'Preview', 'पूर्वावलोकन')}: <Mono>{p.fileName}</Mono> → {p.round.code} · {p.round.label}
        <span className="ml-2 font-normal text-ink-soft">{t(lang, 'for', 'क्षेत्र')} {p.area}</span>
      </p>

      {p.fatal ? <Callout tone="crit" title={t(lang, 'This file cannot be imported', 'यह फ़ाइल आयात नहीं हो सकती')}>{p.fatal}</Callout> : null}
      {p.duplicateOf ? (
        <Callout tone="warn" title={t(lang, 'Already imported', 'पहले ही आयात हो चुकी')}>
          {t(lang, 'This exact file was committed as ', 'यही फ़ाइल ')}
          <Link className="link" href={`/import/${p.duplicateOf.batchId}`}>{p.duplicateOf.batchId}</Link>
          {t(lang, ` on ${p.duplicateOf.at.slice(0, 10)}. Committing it again would add nothing.`, ` के रूप में ${p.duplicateOf.at.slice(0, 10)} को दर्ज हुई। दोबारा दर्ज करने से कुछ नहीं जुड़ेगा।`)}
        </Callout>
      ) : null}

      {!p.fatal ? (
        <Grid cols={4}>
          <Stat label={t(lang, 'Rows in the file', 'फ़ाइल में पंक्तियाँ')} value={fmtInt(p.totalRows)} />
          <Stat label={t(lang, 'Will be accepted', 'स्वीकार होंगी')} value={fmtInt(p.accepted)} tone="good" sub={`${p.schools} ${t(lang, 'schools', 'विद्यालय')} · ${p.clusters} ${t(lang, 'clusters', 'संकुल')}`} />
          <Stat label={t(lang, 'Will be refused', 'ख़ारिज होंगी')} value={fmtInt(p.rejected)} tone={p.rejected > 0 ? 'warn' : 'neutral'} />
          <Stat label={t(lang, 'Warnings (kept, flagged)', 'चेतावनी (रखी, चिह्नित)')} value={fmtInt(p.warnings)} tone={p.warnings > 0 ? 'warn' : 'neutral'} />
        </Grid>
      ) : null}

      {p.byCode.length > 0 ? (
        <div>
          <p className="label mb-1">{t(lang, 'Refused rows by reason', 'कारण अनुसार ख़ारिज पंक्तियाँ')}</p>
          <ul className="flex flex-wrap gap-2">
            {p.byCode.map((b) => (
              <li key={b.code}><Pill tone="warn" title={b.example}>{b.code.replace(/_/g, ' ')} · {b.count}</Pill></li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.sampleRejected.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t(lang, 'Row', 'पंक्ति')}</th>
                <th scope="col">{t(lang, 'Reason', 'कारण')}</th>
                <th scope="col">{t(lang, 'What was in the row', 'पंक्ति में क्या था')}</th>
              </tr>
            </thead>
            <tbody>
              {p.sampleRejected.map((r) => (
                <tr key={r.row_number}>
                  <td className="tnum text-[12.5px]">{r.row_number}</td>
                  <td className="text-[12.5px]"><Pill tone="warn">{r.error_code.replace(/_/g, ' ')}</Pill><span className="mt-0.5 block text-ink-soft">{r.message}</span></td>
                  <td className="font-mono text-[11.5px] text-ink-soft">{Object.values(r.raw).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.rejected > p.sampleRejected.length ? (
            <p className="mt-1 text-[12px] text-ink-faint">{t(lang, `Showing the first ${p.sampleRejected.length} of ${p.rejected}. All are kept with the batch after committing.`, `${p.rejected} में से पहली ${p.sampleRejected.length}।`)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={!canCommit || pending} onClick={onCommit}>
          {pending ? t(lang, 'Committing and running detection…', 'दर्ज और विश्लेषण हो रहा है…')
            : t(lang, `Commit ${fmtInt(p.accepted)} rows and run detection`, `${fmtInt(p.accepted)} पंक्तियाँ दर्ज करें और विश्लेषण चलाएँ`)}
        </button>
        {canCommit ? (
          <span className="text-[12.5px] text-ink-soft">
            {t(lang, 'Refused rows are stored with the batch so they can be corrected and resent.', 'ख़ारिज पंक्तियाँ बैच के साथ रखी जाती हैं।')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ResultPanel({ r, lang }: { r: CommitResult; lang: Language }) {
  if (r.status === 'duplicate') {
    return (
      <Callout tone="warn" title={t(lang, 'Nothing added', 'कुछ नहीं जुड़ा')}>
        {t(lang, 'This exact file was already committed as ', 'यही फ़ाइल पहले ')}
        <Link className="link" href={`/import/${r.duplicateOf!.batchId}`}>{r.duplicateOf!.batchId}</Link>.
      </Callout>
    );
  }
  const d = r.detection;
  return (
    <div className="space-y-3" data-testid="import-result">
      <Callout tone={r.status === 'failed' ? 'crit' : 'good'} title={r.status === 'failed' ? t(lang, 'Nothing was committed', 'कुछ दर्ज नहीं हुआ') : t(lang, 'Import committed', 'आयात दर्ज')}>
        <Link className="link font-medium" href={`/import/${r.batchId}`}>{r.batchId}</Link>
        {': '}{fmtInt(r.accepted)} {t(lang, 'rows accepted', 'पंक्तियाँ स्वीकृत')}, {fmtInt(r.rejected)} {t(lang, 'refused', 'ख़ारिज')}.
      </Callout>
      {d ? (
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="text-[13.5px] font-semibold text-ink">
            {t(lang, `Detection run: ${d.round} compared with ${d.prevRound}`, `विश्लेषण: ${d.round} बनाम ${d.prevRound}`)}
            <span className="ml-2 font-normal text-ink-soft">{t(lang, `settings ${d.settings}, ${d.schoolsReporting} schools reporting so far`, `सेटिंग ${d.settings}, ${d.schoolsReporting} विद्यालय`)}</span>
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {t(
              lang,
              `${d.candidates} candidate drops: ${d.flagged} passed every gate, ${d.rejectedNoise} rejected as noise, ${d.rejectedDataQuality} rejected for data quality${d.alreadyKnown ? `, ${d.alreadyKnown} already on record` : ''}.`,
              `${d.candidates} संभावित गिरावट: ${d.flagged} ने सभी जाँच पार कीं, ${d.rejectedNoise} शोर, ${d.rejectedDataQuality} डेटा गुणवत्ता।`,
            )}
          </p>
          {d.casesOpened.length > 0 ? (
            <ul className="mt-2 divide-y divide-line">
              {d.casesOpened.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Pill tone={c.severity === 'critical' ? 'critical' : c.severity === 'high' ? 'warn' : 'neutral'}>{c.severity}</Pill>
                  <Link className="link text-[13px] font-medium" href={`/cases/${c.id}`}>{c.id}</Link>
                  <span className="text-[13px] text-ink">{c.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-soft">{t(lang, 'No new case was opened.', 'कोई नया प्रकरण नहीं खुला।')}</p>
          )}
          {d.monitoring.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-faint">
              {t(lang, `${d.monitoring.length} more flagged drop(s) are being monitored on a case that is already open.`, `${d.monitoring.length} गिरावट पहले से खुले प्रकरण पर निगरानी में।`)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
