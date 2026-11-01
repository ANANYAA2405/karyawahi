import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listFindings, findingStatusCounts } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { rounds, settingVersions } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Toolbar, Callout } from '@/components/ui';
import { FindingTable, FilterChips } from '@/components/lists';
import type { Finding } from '@/lib/cases';
import type { Language } from '@domain/types';

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

        <DetectionPicture findings={findings} materiality={settings.detection.materiality_pp} z={settings.detection.z_threshold} lang={lang} />

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

const DOT: Record<string, { cls: string; en: string; hi: string }> = {
  case_opened: { cls: 'fill-crit stroke-white', en: 'Case opened', hi: 'प्रकरण खुला' },
  monitoring: { cls: 'fill-amber stroke-white', en: 'Watching', hi: 'निगरानी' },
  rejected_noise: { cls: 'fill-ink-faint/60 stroke-white', en: 'Noise', hi: 'अस्थिरता' },
  rejected_data_quality: { cls: 'fill-white stroke-ink-faint', en: 'Data too thin', hi: 'डेटा अपर्याप्त' },
};

/**
 * The detection rule as a picture: every candidate placed by how far it fell behind the district
 * (across) and how sure the test is (down). A case opens only in the shaded corner, where both
 * thresholds are crossed, so anyone can see why a dot did or did not become a case.
 */
function DetectionPicture({ findings, materiality, z, lang }: { findings: Finding[]; materiality: number; z: number; lang: Language }) {
  if (findings.length === 0) return null;
  const W = 1200, H = 280, L = 44, R = 12, T = 12, B = 34;
  const x0 = Math.min(-25, ...findings.map((f) => f.relative_change_pp)) - 1, x1 = Math.max(8, ...findings.map((f) => f.relative_change_pp)) + 1;
  const y0 = Math.min(-6, ...findings.map((f) => f.z_score)) - 0.3, y1 = Math.max(2, ...findings.map((f) => f.z_score)) + 0.3;
  const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);
  const ticksX = Array.from({ length: Math.floor(x1 / 5) - Math.ceil(x0 / 5) + 1 }, (_, i) => (Math.ceil(x0 / 5) + i) * 5);
  const ticksY = Array.from({ length: Math.floor(y1 / 2) - Math.ceil(y0 / 2) + 1 }, (_, i) => (Math.ceil(y0 / 2) + i) * 2);
  return (
    <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-md font-semibold text-ink">{pick(lang, 'Why a dip became a case — or did not', 'गिरावट प्रकरण क्यों बनी — या नहीं')}</h2>
          <p className="text-xs text-ink-faint">{pick(lang, `Each dot is one cluster, class and skill. A case opens only in the shaded corner: at least ${materiality} pp behind the district and z at or below −${z}.`, `हर बिंदु एक संकुल-कक्षा-दक्षता है। प्रकरण केवल छायांकित कोने में खुलता है।`)}</p>
        </div>
        <p className="flex flex-wrap gap-3 text-2xs text-ink-soft">
          {Object.entries(DOT).map(([k, d]) => (
            <span key={k} className="inline-flex items-center gap-1"><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className={d.cls} strokeWidth={1.5} /></svg>{pick(lang, d.en, d.hi)}</span>
          ))}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={pick(lang, 'Detection candidates by relative drop and test strength', 'सापेक्ष गिरावट और परीक्षण के अनुसार उम्मीदवार')}>
        <rect x={L} y={sy(-z)} width={sx(-materiality) - L} height={H - B - sy(-z)} className="fill-crit-light" />
        {ticksX.map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={T} y2={H - B} className="stroke-line" strokeWidth={t === 0 ? 1.2 : 0.6} /><text x={sx(t)} y={H - B + 14} textAnchor="middle" className="fill-ink-faint text-[10px]">{t > 0 ? `+${t}` : t}</text></g>)}
        {ticksY.map((t) => <g key={`y${t}`}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="stroke-line" strokeWidth={t === 0 ? 1.2 : 0.6} /><text x={L - 6} y={sy(t) + 3} textAnchor="end" className="fill-ink-faint text-[10px]">{t}</text></g>)}
        <line x1={sx(-materiality)} x2={sx(-materiality)} y1={T} y2={H - B} className="stroke-crit" strokeDasharray="4 3" />
        <line x1={L} x2={W - R} y1={sy(-z)} y2={sy(-z)} className="stroke-crit" strokeDasharray="4 3" />
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="fill-ink-soft text-[10px]">{pick(lang, 'Change against the district, percentage points', 'ज़िले की तुलना में बदलाव, प्रतिशत अंक')}</text>
        <text x={12} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`} className="fill-ink-soft text-[10px]">z</text>
        {findings.map((f) => (
          <a key={f.id} href={`/findings/${f.id}`}>
            <circle cx={sx(f.relative_change_pp)} cy={sy(f.z_score)} r={f.status === 'case_opened' ? 5 : 4} strokeWidth={1.5} className={DOT[f.status]?.cls ?? 'fill-ink-faint'}>
              <title>{`${f.id} · ${f.relative_change_pp.toFixed(1)} pp · z ${f.z_score.toFixed(2)} · ${DOT[f.status]?.en ?? f.status}`}</title>
            </circle>
          </a>
        ))}
      </svg>
    </section>
  );
}
