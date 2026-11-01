import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { schoolsIn, schoolCount, scopeName, placeNames } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Empty, Mono, fmtInt } from '@/components/ui';
import { Pill } from '@/components/labels';

/** Schools in scope. A headmaster sees exactly one row here. */

export default async function SchoolsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; cluster?: string; block?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const total = schoolCount(session);
  const schools = schoolsIn(session, {
    q: sp.q || undefined,
    clusterId: sp.cluster || undefined,
    blockId: sp.block || undefined,
    limit: 300,
  });
  const places = placeNames();
  const understaffed = schools.filter((s) => s.teachers_in_position < s.teachers_sanctioned).length;
  const highPtr = schools.filter((s) => s.ptr > 35).length;

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
          value={fmtInt(schools.reduce((t, s) => t + s.enrolment_g1 + s.enrolment_g2 + s.enrolment_g3, 0))}
          sub={pick(lang, 'among those shown', 'दिखाए गए में')} />
      </Grid>

      <div className="mt-4">
        <Card>
          <CardHead
            title={pick(lang, 'Schools', 'विद्यालय')}
            hint={`${schools.length} ${pick(lang, 'shown', 'दिखाए')}${schools.length < total ? ` ${pick(lang, 'of', 'में से')} ${fmtInt(total)}` : ''}`}
            right={
              <form method="get" action="/schools" className="flex gap-2">
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
                  </tr>
                </thead>
                <tbody>
                  {schools.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/schools/${s.id}`} className="link font-medium">{s.name}</Link>
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
