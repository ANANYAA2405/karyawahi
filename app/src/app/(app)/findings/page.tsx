import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listFindings, findingStatusCounts } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { rounds, settingVersions } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Toolbar, Callout } from '@/components/ui';
import { FindingTable, FilterChips } from '@/components/lists';

/**
 * The detection queue, including what the detector chose NOT to open.
 *
 * Showing the rejections is the point. A tool that only displays its hits looks infallible;
 * this one shows the candidates it dropped as statistical noise and the ones it would not judge
 * because the data was too thin, so the thresholds can be argued with.
 */

export default async function FindingsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; round?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const counts = findingStatusCounts(session, { roundId: sp.round });
  const findings = listFindings(session, {
    status: sp.status ? [sp.status] : undefined,
    roundId: sp.round || undefined,
    limit: 300,
  });
  const look = lookupsFor(lang);
  const settings = settingVersions().at(-1)!;
  const completedRounds = rounds().filter((r) => r.status === 'completed');

  const options = [
    { value: '', label: pick(lang, 'All candidates', 'सभी'), count: Object.values(counts).reduce((a, b) => a + b, 0) },
    { value: 'case_opened', label: pick(lang, 'Case opened', 'प्रकरण खुला'), count: counts.case_opened ?? 0 },
    { value: 'monitoring', label: pick(lang, 'Watching', 'निगरानी'), count: counts.monitoring ?? 0 },
    { value: 'rejected_noise', label: pick(lang, 'Rejected as noise', 'अस्थिरता मानकर ख़ारिज'), count: counts.rejected_noise ?? 0 },
    { value: 'rejected_data_quality', label: pick(lang, 'Rejected — data quality', 'डेटा गुणवत्ता से ख़ारिज'), count: counts.rejected_data_quality ?? 0 },
  ];

  return (
    <div>
      <PageHead
        title={pick(lang, 'Findings', 'निष्कर्ष')}
        sub={pick(
          lang,
          'Every cluster-grade-competency comparison the detector looked at, and what it decided. Rejections are listed alongside the hits.',
          'पहचान-तंत्र ने जिन तुलनाओं को देखा और जो निर्णय लिया। ख़ारिज किए गए भी यहाँ हैं।',
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Opened as cases', 'प्रकरण बने')} value={counts.case_opened ?? 0} tone="crit" />
        <Stat label={pick(lang, 'Being watched', 'निगरानी में')} value={counts.monitoring ?? 0} tone="warn"
          sub={pick(lang, 'material but not yet significant', 'महत्वपूर्ण पर सांख्यिकीय रूप से नहीं')} />
        <Stat label={pick(lang, 'Rejected as noise', 'अस्थिरता')} value={counts.rejected_noise ?? 0}
          sub={pick(lang, 'did not pass the z-test', 'z-परीक्षण पास नहीं')} />
        <Stat label={pick(lang, 'Too thin to judge', 'डेटा अपर्याप्त')} value={counts.rejected_data_quality ?? 0} tone="warn"
          sub={pick(lang, 'failed a data-quality gate', 'गुणवत्ता जाँच असफल')} />
      </Grid>

      <div className="mt-4 space-y-4">
        <Callout tone="method" title={pick(lang, 'The rule, in full', 'पूरा नियम')}>
          {pick(
            lang,
            `For each cluster, grade and competency: compare the share of assessed children at the grade benchmark between two rounds, then subtract the district's change over the same rounds. A case opens only when that relative drop is at least ${settings.detection.materiality_pp} pp, a two-proportion z-test reaches −${settings.detection.z_threshold}, at least ${settings.detection.min_cluster_assessed} children were assessed in each round, at least ${Math.round(settings.detection.min_school_reporting_share * 100)}% of the cluster's schools reported, and participation was at least ${Math.round(settings.detection.min_participation * 100)}%. No model beyond that.`,
            `हर संकुल, कक्षा और दक्षता के लिए: दो दौरों के बीच बदलाव से ज़िले का बदलाव घटाया जाता है। प्रकरण तभी खुलता है जब सापेक्ष गिरावट ${settings.detection.materiality_pp} pp से अधिक हो, z-परीक्षण −${settings.detection.z_threshold} तक पहुँचे, हर दौर में कम से कम ${settings.detection.min_cluster_assessed} बच्चे आकलित हों, ${Math.round(settings.detection.min_school_reporting_share * 100)}% विद्यालय रिपोर्ट करें, और भागीदारी ${Math.round(settings.detection.min_participation * 100)}% से अधिक हो।`,
          )}
        </Callout>

        <Toolbar>
          <FilterChips base="/findings" param="status" options={options} current={sp.status} lang={lang} />
        </Toolbar>

        <Card>
          <CardHead
            title={pick(lang, 'Detection candidates', 'पहचान उम्मीदवार')}
            hint={`${findings.length} ${pick(lang, 'shown, worst relative drop first', 'दिखाए गए, सबसे बड़ी गिरावट पहले')}`}
          />
          <FindingTable findings={findings} look={look} lang={lang} />
        </Card>

        <Card>
          <CardHead title={pick(lang, 'Assessment rounds', 'आकलन दौर')} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Round', 'दौर')}</th>
                  <th scope="col">{pick(lang, 'Year', 'वर्ष')}</th>
                  <th scope="col">{pick(lang, 'Window', 'अवधि')}</th>
                  <th scope="col">{pick(lang, 'Imported', 'आयात')}</th>
                  <th scope="col">{pick(lang, 'Instrument', 'उपकरण')}</th>
                </tr>
              </thead>
              <tbody>
                {rounds().map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.code} · {r.label}</td>
                    <td>{r.academic_year}</td>
                    <td className="tnum text-sm">{r.window_start} → {r.window_end}</td>
                    <td className="tnum text-sm">
                      {r.import_date ?? <span className="text-ink-faint">{pick(lang, 'not yet', 'अभी नहीं')}</span>}
                    </td>
                    <td className="text-sm text-ink-soft">{r.instrument_note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
