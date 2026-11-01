import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { headline, districtRollup, outcomeMix, detectionHealth, timeToClose } from '@/lib/dash';
import { listCases, listFindings } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { settingVersions, rounds, competencies, blockCompetencySnapshot, datasets, stateRow } from '@/lib/repo';
import { listJobs, listImports, rejectionCodeCounts } from '@/lib/feed';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Callout, Facts, Field, Mono, fmtDate, fmtInt } from '@/components/ui';
import { CaseTable, FindingTable } from '@/components/lists';
import { HeadlineStats, RollupTable, OutcomeMix, DetectionHealth, CompetencyGrid } from '@/components/dash';
import { Pill, ProvenanceChip } from '@/components/labels';

/**
 * The state programme team's view. They do not work cases; they decide the thresholds everyone
 * else is judged by, so this page puts the current configuration and the detector's behaviour
 * next to the outcomes it produced.
 */

export default async function StateHome() {
  const session = await pageSession();
  const lang = await getLanguage();

  const h = headline(session);
  const districts = districtRollup(session);
  const settings = settingVersions();
  const current = settings.at(-1)!;
  const critical = listCases(session, { severity: ['critical'], open: true, limit: 10 });
  const worst = listFindings(session, { status: ['case_opened'], limit: 8 });
  const snapshot = blockCompetencySnapshot(session, {});
  const lastRound = rounds().filter((r) => r.status === 'completed').at(-1);
  const nextRound = rounds().find((r) => r.status === 'scheduled');
  const tt = timeToClose(session);
  const jobs = listJobs(session, { limit: 8 });
  const imports = listImports(session, { limit: 6 });
  const rejections = rejectionCodeCounts(session);

  const look = lookupsFor(lang, { users: critical.map((c) => c.owner_user_id) });
  const compNames = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  return (
    <div className="space-y-4">
      <PageHead
        title={`${pick(lang, 'State programme team', 'राज्य कार्यक्रम दल')} — ${stateRow()?.name ?? ''}`}
        sub={pick(
          lang,
          'The thresholds on this page decide what becomes a case and what counts as success. Changing them changes everybody\'s workload, so each version is kept with the reason it was changed.',
          'इस पृष्ठ की सीमाएँ तय करती हैं कि क्या प्रकरण बनेगा और क्या सफलता मानी जाएगी। हर संस्करण कारण सहित सुरक्षित है।',
        )}
      />

      <HeadlineStats h={h} lang={lang} />

      <RollupTable
        rows={districts} lang={lang}
        title={pick(lang, 'Districts', 'ज़िले')}
        label={pick(lang, 'District', 'ज़िला')}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <OutcomeMix rows={outcomeMix(session)} lang={lang} />
        <DetectionHealth rows={detectionHealth(session)} lang={lang} />
      </div>

      <Grid cols={4}>
        <Stat label={pick(lang, 'Closed on proof', 'सबूत पर बंद')} value={tt.closed} tone="good" />
        <Stat label={pick(lang, 'Typical time to close', 'औसत समय')} value={tt.medianDays === null ? '—' : `${tt.medianDays}d`} />
        <Stat label={pick(lang, 'Reopened', 'फिर खोले')} value={h.reopened} tone={h.reopened > 0 ? 'warn' : 'neutral'} />
        <Stat
          label={pick(lang, 'Next round', 'अगला दौर')}
          value={<span className="text-md">{nextRound ? nextRound.code : '—'}</span>}
          sub={nextRound ? `${nextRound.window_start} → ${nextRound.window_end}` : undefined}
        />
      </Grid>

      <Card>
        <CardHead
          title={pick(lang, 'Current configuration', 'वर्तमान सेटिंग')}
          hint={`v${current.version} · ${pick(lang, 'in force since', 'प्रभावी')} ${fmtDate(current.effective_from)}`}
          right={<Link href="/settings" className="link text-sm">{pick(lang, 'All versions', 'सभी संस्करण')}</Link>}
        />
        <div className="card-pad space-y-3">
          <Facts cols={4}>
            <Field label={pick(lang, 'Materiality', 'न्यूनतम अंतर')} hint={pick(lang, 'relative to the district', 'ज़िले के सापेक्ष')}>
              <span className="tnum">{current.detection.materiality_pp} pp</span>
            </Field>
            <Field label={pick(lang, 'z threshold', 'z सीमा')}>
              <span className="tnum">−{current.detection.z_threshold}</span>
            </Field>
            <Field label={pick(lang, 'Minimum children per cluster', 'प्रति संकुल न्यूनतम बच्चे')}>
              <span className="tnum">{current.detection.min_cluster_assessed}</span>
            </Field>
            <Field label={pick(lang, 'Minimum participation', 'न्यूनतम भागीदारी')}>
              <span className="tnum">{Math.round(current.detection.min_participation * 100)}%</span>
            </Field>
            <Field label={pick(lang, 'Success threshold', 'सफलता लक्ष्य')}>
              <span className="tnum">+{current.outcome.success_threshold_pp} pp</span>
            </Field>
            <Field label={pick(lang, 'Participation floor', 'भागीदारी न्यूनतम')}>
              <span className="tnum">{Math.round(current.outcome.participation_floor_ratio * 100)}%</span>
            </Field>
            <Field label={pick(lang, 'Comparison schools per treated school', 'प्रति विद्यालय तुलना विद्यालय')}>
              <span className="tnum">{current.outcome.comparison_schools_per_treated}</span>
            </Field>
            <Field label={pick(lang, 'Reminder / escalation', 'स्मरण / उच्चाधिकारी')}>
              <span className="tnum">T−{current.reminders.reminder_days_before_due} / +{current.reminders.escalation_days_overdue}d</span>
            </Field>
          </Facts>
          <Callout tone="method" title={pick(lang, 'Why this version', 'यह संस्करण क्यों')}>
            {current.change_note}
          </Callout>
          <div>
            <h3 className="h-section mb-1">{pick(lang, 'A case may only close when', 'प्रकरण तभी बंद हो सकता है जब')}</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
              {current.closure_rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      </Card>

      {snapshot.length > 0 && lastRound ? (
        <CompetencyGrid rows={snapshot} competencyNames={compNames} lang={lang} roundLabel={`${lastRound.code} · ${lastRound.label}`} />
      ) : null}

      <Card>
        <CardHead
          title={pick(lang, 'Where the data comes from', 'डेटा का स्रोत')}
          hint={pick(lang, 'Every dataset is labelled with its provenance. Nothing here is a live government feed.', 'हर डेटासेट का स्रोत अंकित है। कोई वास्तविक सरकारी फ़ीड नहीं।')}
        />
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{pick(lang, 'Dataset', 'डेटासेट')}</th>
                <th scope="col">{pick(lang, 'Provenance', 'स्रोत')}</th>
                <th scope="col">{pick(lang, 'Refresh', 'अद्यतन')}</th>
                <th scope="col">{pick(lang, 'Last updated', 'अंतिम अद्यतन')}</th>
              </tr>
            </thead>
            <tbody>
              {datasets().map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="font-medium">{d.name}</span>
                    <p className="text-xs text-ink-soft">{d.description}</p>
                    <p className="text-xs text-ink-faint">{d.source_note}</p>
                  </td>
                  <td><ProvenanceChip provenance={d.provenance} lang={lang} /></td>
                  <td className="text-sm">{d.refresh_cadence}</td>
                  <td className="tnum text-sm">{fmtDate(d.last_updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rejections.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Why uploaded rows get rejected', 'अपलोड पंक्तियाँ क्यों ख़ारिज होती हैं')}
            hint={pick(lang, 'Across every import. A pattern here is a data-collection problem, not a user error.', 'सभी आयातों में। यहाँ कोई प्रवृत्ति डेटा संग्रह की समस्या है।')}
            right={<Link href="/import" className="link text-sm">{pick(lang, 'Imports', 'आयात')}</Link>}
          />
          <ul className="card-pad flex flex-wrap gap-2">
            {rejections.map((r) => (
              <li key={r.error_code}>
                <Pill tone="warn">{r.error_code.replace(/_/g, ' ')} · <span className="tnum">{r.c}</span></Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {imports.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Recent imports', 'हाल के आयात')} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'File', 'फ़ाइल')}</th>
                  <th scope="col">{pick(lang, 'Scope', 'दायरा')}</th>
                  <th scope="col">{pick(lang, 'Rows', 'पंक्तियाँ')}</th>
                  <th scope="col">{pick(lang, 'Rejected', 'ख़ारिज')}</th>
                  <th scope="col">{pick(lang, 'When', 'कब')}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/import/${b.id}`} className="link">{b.file_name}</Link></td>
                    <td className="text-sm">{b.scope_type} {b.scope_id}</td>
                    <td className="tnum">{fmtInt(b.accepted_rows)} / {fmtInt(b.total_rows)}</td>
                    <td className="tnum">
                      {b.rejected_rows > 0 ? <span className="text-warn">{b.rejected_rows}</span> : <span className="text-ink-faint">0</span>}
                    </td>
                    <td className="tnum text-sm">{fmtDate(b.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {critical.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Critical and open, statewide', 'राज्यभर में अति गंभीर')} />
          <CaseTable cases={critical} look={look} lang={lang} />
        </Card>
      ) : null}

      {worst.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Largest drops this round', 'इस दौर की सबसे बड़ी गिरावट')} />
          <FindingTable findings={worst} look={look} lang={lang} />
        </Card>
      ) : null}

      {jobs.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Background jobs', 'पृष्ठभूमि कार्य')}
            right={<Link href="/admin/jobs" className="link text-sm">{pick(lang, 'All jobs', 'सभी कार्य')}</Link>}
          />
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm sm:px-5">
                <Mono>{j.job_type}</Mono>
                <Pill tone={j.status === 'succeeded' ? 'good' : j.status === 'failed' ? 'critical' : 'neutral'}>{j.status}</Pill>
                <span className="tnum text-xs text-ink-faint">{fmtDate(j.started_at, true)}</span>
                <span className="text-xs text-ink-soft">
                  {Object.entries(j.summary).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
