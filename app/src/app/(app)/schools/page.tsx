import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { schoolsIn, schoolCount, scopeName, placeNames } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { schoolName } from '@/lib/school-label';
import { Card, CardHead, PageHead, Grid, Stat, Empty, Mono, fmtInt } from '@/components/ui';
import { Pill } from '@/components/labels';
import { Icon } from '@/components/Icon';
import { schoolsNow, THRESHOLDS, type Level, type SchoolNow } from '@/lib/school-now';

/** Schools in scope. A headmaster sees exactly one row here. The page opens with a picture of the
 *  schools' situation (teachers, visits, attendance), and each bar filters the list below. */

const LEVELS: Level[] = ['critical', 'significant', 'moderate', 'stable', 'insufficient'];
const LEVEL_BAR: Record<Level, string> = {
  critical: 'bg-sev-critical', significant: 'bg-sev-significant', moderate: 'bg-sev-moderate', stable: 'bg-sev-improving', insufficient: 'bg-paper-deep',
};
const LEVEL_WORD: Record<Level, [string, string]> = {
  critical: ['Critical', 'गंभीर'], significant: ['Significant', 'उल्लेखनीय'], moderate: ['Moderate', 'मध्यम'], stable: ['Fine', 'ठीक'], insufficient: ['No data', 'डेटा नहीं'],
};
type Need = 'teachers' | 'visits' | 'attendance';
const NEEDS: { key: Need; en: string; hi: string; level: (n: SchoolNow) => Level; rule: string }[] = [
  { key: 'teachers', en: 'Teachers in post', hi: 'पदस्थ शिक्षक', level: (n) => n.teacherLevel, rule: THRESHOLDS.teachers },
  { key: 'visits', en: 'Support visits', hi: 'सहायक भ्रमण', level: (n) => n.visitLevel, rule: THRESHOLDS.visits },
  { key: 'attendance', en: 'Attendance trend', hi: 'उपस्थिति रुझान', level: (n) => n.attendanceLevel, rule: THRESHOLDS.attendance },
];

export default async function SchoolsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; cluster?: string; block?: string; need?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const total = schoolCount(session);
  const listed = schoolsIn(session, {
    q: sp.q || undefined,
    clusterId: sp.cluster || undefined,
    blockId: sp.block || undefined,
    limit: 300,
  });
  const now = schoolsNow(session, listed.map((x) => x.id));
  const need = NEEDS.find((n) => n.key === sp.need);
  const schools = need ? listed.filter((x) => { const n = now.get(x.id); return n && ['critical', 'significant'].includes(need.level(n)); }) : listed;
  const mix = NEEDS.map((n) => {
    const c = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
    for (const x of listed) { const v = now.get(x.id); if (v) c[n.level(v)]++; }
    return { ...n, c, hot: c.critical + c.significant };
  });
  const link = (q: Record<string, string | undefined>) => {
    const u = new URLSearchParams(Object.entries({ q: sp.q, block: sp.block, cluster: sp.cluster, need: sp.need, ...q }).filter(([, v]) => v) as [string, string][]);
    return `/schools${u.size ? `?${u}` : ''}`;
  };
  const places = placeNames();
  const understaffed = listed.filter((s) => s.teachers_in_position < s.teachers_sanctioned).length;
  const highPtr = listed.filter((s) => s.ptr > 35).length;

  return (
    <div>
      <PageHead
        title={pick(lang, 'Schools', 'विद्यालय')}
        sub={pick(
          lang,
          `Every school your role covers: ${scopeName(session.scope_type, session.scope_id)}.`,
          `आपकी भूमिका के अंतर्गत सभी विद्यालय: ${scopeName(session.scope_type, session.scope_id)}।`,
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Schools in scope', 'दायरे में विद्यालय')} value={fmtInt(total)} />
        <Stat label={pick(lang, 'Short of sanctioned teachers', 'स्वीकृत से कम शिक्षक')} value={fmtInt(understaffed)}
          tone={understaffed > 0 ? 'warn' : 'neutral'} sub={pick(lang, 'among those shown', 'दिखाए गए में')} />
        <Stat label={pick(lang, 'Pupil–teacher ratio above 35', 'अनुपात 35 से अधिक')} value={fmtInt(highPtr)}
          tone={highPtr > 0 ? 'warn' : 'neutral'} sub={pick(lang, 'among those shown', 'दिखाए गए में')} />
        <Stat label={pick(lang, 'Class 1–3 children', 'कक्षा 1–3 बच्चे')}
          value={fmtInt(listed.reduce((t, s) => t + s.enrolment_g1 + s.enrolment_g2 + s.enrolment_g3, 0))}
          sub={pick(lang, 'among those shown', 'दिखाए गए में')} />
      </Grid>

      {/* The situation picture: for each of three needs, how the schools listed spread from fine to critical. */}
      <section className="mt-4 rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label={pick(lang, 'School situation', 'विद्यालयों की स्थिति')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-md font-semibold text-ink">{pick(lang, 'How the schools are doing right now', 'विद्यालय अभी कैसे हैं')}</h2>
          <p className="flex flex-wrap gap-3 text-2xs text-ink-soft">
            {LEVELS.map((l) => <span key={l} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${LEVEL_BAR[l]}`} />{pick(lang, ...LEVEL_WORD[l])}</span>)}
          </p>
        </div>
        <ul className="mt-4 space-y-3">
          {mix.map((m) => {
            const on = need?.key === m.key;
            return (
              <li key={m.key}>
                <Link href={link({ need: on ? undefined : m.key })} aria-current={on ? 'true' : undefined} title={m.rule}
                  className={`grid items-center gap-x-4 gap-y-1 rounded-xl px-2 py-1.5 transition-colors sm:grid-cols-[170px_minmax(0,1fr)_150px] ${on ? 'bg-brand-light' : 'hover:bg-paper-sunk'}`}>
                  <span className={`text-sm ${on ? 'font-semibold text-brand' : 'font-medium text-ink'}`}>{pick(lang, m.en, m.hi)}</span>
                  <span className="flex h-4 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={LEVELS.map((l) => `${m.c[l]} ${LEVEL_WORD[l][0]}`).join(', ')}>
                    {LEVELS.map((l) => m.c[l] ? <span key={l} className={`h-full ${LEVEL_BAR[l]}`} style={{ width: `${(100 * m.c[l]) / Math.max(1, listed.length)}%` }} /> : null)}
                  </span>
                  <span className="text-xs text-ink-soft"><span className={`tnum font-semibold ${m.hot ? 'text-crit' : 'text-ink'}`}>{m.hot}</span> {pick(lang, 'need attention', 'पर ध्यान चाहिए')}{on ? <Icon name="x" size={12} className="ml-1 inline text-brand" /> : null}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-2xs text-ink-faint">{pick(lang, 'Click a bar to list only the schools at critical or significant for it. Hover a bar for the rule.', 'केवल गंभीर/उल्लेखनीय विद्यालय देखने हेतु पट्टी पर क्लिक करें।')}</p>
      </section>

      <div className="mt-4">
        <Card>
          <CardHead
            title={need ? `${pick(lang, 'Schools needing attention', 'ध्यान योग्य विद्यालय')}: ${pick(lang, need.en, need.hi)}` : pick(lang, 'Schools', 'विद्यालय')}
            hint={`${schools.length} ${pick(lang, 'shown', 'दिखाए')}${schools.length < total ? ` ${pick(lang, 'of', 'में से')} ${fmtInt(total)}` : ''}`}
            right={
              <form method="get" action="/schools" className="flex gap-2">
                {need ? <input type="hidden" name="need" value={need.key} /> : null}
                <input
                  type="search" name="q" defaultValue={sp.q ?? ''}
                  placeholder={pick(lang, 'Name, village or id', 'नाम, गाँव या आईडी')}
                  className="input w-56 py-1 text-sm"
                />
                <button type="submit" className="btn-quiet">{pick(lang, 'Search', 'खोजें')}</button>
              </form>
            }
          />
          {schools.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{pick(lang, 'School', 'विद्यालय')}</th>
                    <th scope="col">{pick(lang, 'Cluster', 'संकुल')}</th>
                    <th scope="col">{pick(lang, 'Enrolment', 'नामांकन')}</th>
                    <th scope="col">{pick(lang, 'Class 1–3', 'कक्षा 1–3')}</th>
                    <th scope="col">{pick(lang, 'Teachers', 'शिक्षक')}</th>
                    <th scope="col">{pick(lang, 'PTR', 'अनुपात')}</th>
                    <th scope="col">{pick(lang, 'Situation', 'स्थिति')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/schools/${s.id}`} className="link font-medium">{schoolName(s.name, lang)}</Link>
                        <p className="text-xs text-ink-faint">
                          {s.village} · <Mono>{s.id}</Mono> · {s.category.replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="text-sm">
                        {places.clusters.get(s.cluster_id) ?? s.cluster_id}
                        <span className="block text-xs text-ink-faint">{places.blocks.get(s.block_id) ?? s.block_id}</span>
                      </td>
                      <td className="tnum text-sm">{fmtInt(s.enrolment_total)}</td>
                      <td className="tnum text-sm">{s.enrolment_g1 + s.enrolment_g2 + s.enrolment_g3}</td>
                      <td className="tnum text-sm">
                        {s.teachers_in_position} / {s.teachers_sanctioned}
                        {s.teachers_in_position < s.teachers_sanctioned ? (
                          <span className="ml-1.5"><Pill tone="warn">{pick(lang, 'short', 'कमी')}</Pill></span>
                        ) : null}
                      </td>
                      <td className="tnum text-sm">
                        {s.ptr > 35 ? <span className="font-medium text-warn">{s.ptr}</span> : s.ptr}
                      </td>
                      <td>
                        {now.get(s.id) ? (
                          <span className="flex gap-1">
                            {NEEDS.map((n) => {
                              const l = n.level(now.get(s.id)!);
                              return <span key={n.key} title={`${n.en}: ${LEVEL_WORD[l][0]}`} className={`grid h-5 w-5 place-items-center rounded-md text-[10px] font-semibold ${LEVEL_BAR[l]} ${l === 'stable' || l === 'insufficient' ? 'text-ink-soft' : 'text-white'}`}>{pick(lang, n.en[0], n.hi[0])}</span>;
                            })}
                          </span>
                        ) : <span className="text-ink-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
