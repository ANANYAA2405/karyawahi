import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { findingById } from '@/lib/cases';
import { schoolNames, placeNames, competency, rounds, clusterTrend, settingVersion } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Facts, Field, Mono, Delta, fmtPct, fmtInt, fmtDate } from '@/components/ui';
import { Pill, SeverityPill } from '@/components/labels';
import { TrendChart, DivergingBars } from '@/components/charts';
import { SERIES } from '@/lib/viz';
import { FindingCalibrationNote } from '@/components/CalibrationNote';
import { schoolName } from '@/lib/school-label';

/** A finding the detector did not turn into a case, with the gate that stopped it. */

export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const f = findingById(session, id);
  if (!f) notFound();

  const places = placeNames();
  const comp = competency(f.competency_id);
  const compName = pick(lang, comp?.name_en ?? f.competency_id, comp?.name_hi ?? f.competency_id);
  const schools = schoolNames(f.driver_schools.map((d) => d.school_id));
  const roundLabel = new Map(rounds().map((r) => [r.id, `${r.code} · ${r.label}`]));
  const trend = clusterTrend(session, f.cluster_id, f.district_id, f.grade, f.competency_id);
  const settings = settingVersion(f.settings_version_id);
  const failed = f.dq_checks.filter((c) => !c.passed);

  const verdict = {
    case_opened: { tone: 'critical' as const, en: 'A case was opened', hi: 'प्रकरण खोला गया' },
    monitoring: { tone: 'warn' as const, en: 'Being watched, no case', hi: 'निगरानी, प्रकरण नहीं' },
    rejected_noise: { tone: 'neutral' as const, en: 'Rejected as noise', hi: 'अस्थिरता मानकर ख़ारिज' },
    rejected_data_quality: { tone: 'neutral' as const, en: 'Rejected — data too thin', hi: 'डेटा अपर्याप्त' },
    manual: { tone: 'neutral' as const, en: 'Opened by hand', hi: 'स्वयं खोला' },
  }[f.status] ?? { tone: 'neutral' as const, en: f.status, hi: f.status };

  return (
    <div className="space-y-4">
      <PageHead
        breadcrumb={<><Link href="/findings" className="link">{pick(lang, 'Findings', 'निष्कर्ष')}</Link>{' › '}<Mono>{f.id}</Mono></>}
        title={`${pick(lang, 'Class', 'कक्षा')} ${f.grade} ${compName} — ${places.clusters.get(f.cluster_id) ?? f.cluster_id}`}
        sub={`${places.blocks.get(f.block_id) ?? f.block_id} · ${places.districts.get(f.district_id) ?? f.district_id}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={verdict.tone}>{pick(lang, verdict.en, verdict.hi)}</Pill>
            <SeverityPill severity={f.severity} lang={lang} />
          </div>
        }
      />

      {f.case_id ? (
        <Callout tone="note">
          {pick(lang, 'This finding became', 'यह निष्कर्ष बना')}{' '}
          <Link href={`/cases/${f.case_id}`} className="link font-medium">{f.case_id}</Link>
          {pick(lang, ', where the diagnosis, plan and outcome are recorded.', ', जहाँ निदान, योजना और परिणाम दर्ज हैं।')}
        </Callout>
      ) : f.status === 'rejected_noise' ? (
        <Callout tone="method" title={pick(lang, 'Why no case was opened', 'प्रकरण क्यों नहीं खुला')}>
          {pick(
            lang,
            `The drop relative to the district was ${f.relative_change_pp} pp, which is material, but the two-proportion z-test came to ${f.z_score} and the threshold is −${f.thresholds.z_threshold}. On this many children a swing this size is not distinguishable from ordinary variation, so opening a case would send officers after noise.`,
            `ज़िले के सापेक्ष गिरावट ${f.relative_change_pp} pp थी, पर z-परीक्षण ${f.z_score} रहा जबकि सीमा −${f.thresholds.z_threshold} है। इतने बच्चों पर यह अंतर सामान्य उतार-चढ़ाव से अलग नहीं कहा जा सकता।`,
          )}
        </Callout>
      ) : f.status === 'rejected_data_quality' ? (
        <Callout tone="warn" title={pick(lang, 'Not judged — the data was not good enough', 'निर्णय नहीं — डेटा पर्याप्त नहीं')}>
          {pick(
            lang,
            'One or more data-quality gates failed, so the comparison was not trusted either way. This is not a finding of "no problem"; it is a refusal to guess.',
            'एक या अधिक गुणवत्ता जाँच असफल रही, अतः तुलना पर भरोसा नहीं किया गया। इसका अर्थ "कोई समस्या नहीं" नहीं है।',
          )}
          <ul className="mt-1.5 list-disc pl-5">
            {failed.map((c) => (
              <li key={c.check}>
                {c.check.replace(/_/g, ' ')}: {c.value} ({pick(lang, 'needs', 'आवश्यक')} ≥ {c.threshold})
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Callout tone="warn" title={pick(lang, 'Watching, not acting', 'निगरानी, कार्यवाही नहीं')}>
          {pick(
            lang,
            'Material enough to keep an eye on, but it did not clear every gate for opening a case. It will be re-tested on the next round.',
            'ध्यान देने योग्य, पर प्रकरण खोलने की सभी शर्तें पूरी नहीं। अगले दौर में फिर जाँच होगी।',
          )}
        </Callout>
      )}

      <FindingCalibrationNote findingId={f.id} lang={lang} />

      <Card>
        <CardHead title={pick(lang, 'The comparison', 'तुलना')} />
        <div className="card-pad space-y-4">
          <Facts cols={4}>
            <Field label={roundLabel.get(f.prev_round_id) ?? f.prev_round_id}>
              <span className="tnum">{fmtPct(f.prev_value_pct)}</span>
              <span className="ml-1 text-xs text-ink-faint">{fmtInt(f.n_prev)} {pick(lang, 'children', 'बच्चे')}</span>
            </Field>
            <Field label={roundLabel.get(f.round_id) ?? f.round_id}>
              <span className="tnum font-semibold">{fmtPct(f.curr_value_pct)}</span>
              <span className="ml-1 text-xs text-ink-faint">{fmtInt(f.n_curr)} {pick(lang, 'children', 'बच्चे')}</span>
            </Field>
            <Field label={pick(lang, 'Cluster change', 'संकुल बदलाव')}><Delta pp={f.change_pp} /></Field>
            <Field label={pick(lang, 'Beyond the district', 'ज़िले से अधिक')} hint={`${pick(lang, 'district', 'ज़िला')} ${f.district_change_pp} pp`}>
              <Delta pp={f.relative_change_pp} />
            </Field>
            <Field label="z"><span className="tnum">{f.z_score}</span></Field>
            <Field label={pick(lang, 'Schools reporting', 'रिपोर्ट करने वाले')}>
              <span className="tnum">{f.schools_reporting} / {f.schools_total}</span>
            </Field>
            <Field label={pick(lang, 'Participation', 'भागीदारी')}>
              <span className="tnum">{Math.round(f.participation_rate * 100)}%</span>
            </Field>
            <Field label={pick(lang, 'Settings', 'सेटिंग')}>
              <Mono>{f.settings_version_id}</Mono>
              {settings ? <span className="ml-1 text-xs text-ink-faint">v{settings.version}</span> : null}
            </Field>
          </Facts>

          <TrendChart
            xLabels={trend.map((t) => t.code)}
            series={[
              { key: 'cluster', label: pick(lang, 'This cluster', 'यह संकुल'), color: SERIES.one, points: trend.map((t) => t.cluster_pct) },
              { key: 'district', label: pick(lang, 'District', 'ज़िला'), color: SERIES.two, points: trend.map((t) => t.district_pct) },
            ]}
            caption={`Class ${f.grade} ${compName}: percentage at the grade benchmark, this cluster against its district, across every completed round.`}
          />
        </div>
      </Card>

      {f.driver_schools.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Schools behind the change', 'बदलाव के पीछे विद्यालय')}
            hint={pick(lang, 'Weighted by children assessed.', 'आकलित बच्चों के अनुसार।')}
          />
          <div className="card-pad">
            <DivergingBars
              caption="Change in percentage points per school between the two rounds."
              data={f.driver_schools.map((d) => ({
                key: d.school_id,
                label: schoolName(schools.get(d.school_id), lang) || d.school_id,
                value: d.change_pp,
                note: `${fmtPct(d.prev_pct)} → ${fmtPct(d.curr_pct)}`,
              }))}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'Data-quality gates', 'डेटा गुणवत्ता जाँच')} />
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{pick(lang, 'Check', 'जाँच')}</th>
              <th scope="col">{pick(lang, 'Value', 'मान')}</th>
              <th scope="col">{pick(lang, 'Needs', 'आवश्यक')}</th>
              <th scope="col">{pick(lang, 'Result', 'परिणाम')}</th>
            </tr>
          </thead>
          <tbody>
            {f.dq_checks.map((c) => (
              <tr key={c.check}>
                <td>{c.check.replace(/_/g, ' ')}</td>
                <td className="tnum">{c.value}</td>
                <td className="tnum text-ink-soft">≥ {c.threshold}</td>
                <td>{c.passed ? <Pill tone="good">{pick(lang, 'Passed', 'उत्तीर्ण')}</Pill> : <Pill tone="critical">{pick(lang, 'Failed', 'अनुत्तीर्ण')}</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-ink-faint sm:px-5">
          {f.detection_method} · {pick(lang, 'detected', 'पहचान')} {fmtDate(f.detected_at, true)} ·{' '}
          {pick(lang, 'windows', 'अवधि')} {f.measured_prev_window_end} → {f.measured_curr_window_end}
        </p>
      </Card>
    </div>
  );
}
