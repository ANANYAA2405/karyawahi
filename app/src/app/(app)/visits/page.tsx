import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { visitsBy, schoolNames, userNames, usersByRole } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Empty, Callout, Mono, fmtDate } from '@/components/ui';
import { Pill } from '@/components/labels';

/**
 * Visits logged by the signed-in user.
 *
 * A visit is not proof on its own — proof is attached to a task and checked by someone else —
 * but a long gap between visits to a school is one of the conditions the diagnosis looks for,
 * which is why the log matters.
 */

export default async function VisitsPage() {
  const session = await pageSession();
  const lang = await getLanguage();

  const visits = visitsBy(session, session.user_id, 200);
  const schools = schoolNames(visits.map((v) => v.school_id));
  const byPurpose = visits.reduce<Record<string, number>>((acc, v) => {
    acc[v.purpose] = (acc[v.purpose] ?? 0) + 1;
    return acc;
  }, {});
  const pendingSync = visits.filter((v) => v.sync_status === 'pending_sync').length;
  const gpsOff = visits.filter((v) => v.gps_status === 'outside_radius').length;

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'My visits', 'मेरे भ्रमण')}
        sub={pick(
          lang,
          'Visits you have logged. Routine visits, coaching under a case, spot assessments and independent spot-checks are all recorded here.',
          'आपके दर्ज भ्रमण। नियमित, सहयोग, त्वरित आकलन और स्वतंत्र जाँच — सभी यहाँ दर्ज हैं।',
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Visits logged', 'दर्ज भ्रमण')} value={visits.length} />
        <Stat label={pick(lang, 'Schools reached', 'विद्यालय')} value={new Set(visits.map((v) => v.school_id)).size} />
        <Stat label={pick(lang, 'Waiting to sync', 'सिंक प्रतीक्षित')} value={pendingSync}
          tone={pendingSync > 0 ? 'warn' : 'neutral'}
          sub={pick(lang, 'logged offline', 'ऑफ़लाइन दर्ज')} />
        <Stat label={pick(lang, 'Location did not match', 'स्थान मेल नहीं')} value={gpsOff}
          tone={gpsOff > 0 ? 'warn' : 'neutral'} />
      </Grid>

      {pendingSync > 0 ? (
        <Callout tone="method" title={pick(lang, 'Some visits were logged offline', 'कुछ भ्रमण ऑफ़लाइन दर्ज हुए')}>
          {pick(
            lang,
            'Field work happens where there is no signal. A visit logged offline is kept on the device and marked as waiting to sync, rather than being lost or silently dropped.',
            'क्षेत्र कार्य वहाँ होता है जहाँ नेटवर्क नहीं है। ऑफ़लाइन दर्ज भ्रमण उपकरण में सुरक्षित रहता है और सिंक प्रतीक्षित चिह्नित होता है।',
          )}
        </Callout>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'By purpose', 'उद्देश्य के अनुसार')} />
        <ul className="card-pad flex flex-wrap gap-2">
          {Object.entries(byPurpose).sort((a, b) => b[1] - a[1]).map(([p, c]) => (
            <li key={p}><Pill>{p.replace(/_/g, ' ')} · <span className="tnum">{c}</span></Pill></li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Visit log', 'भ्रमण लॉग')} hint={`${visits.length} ${pick(lang, 'most recent first', 'नवीनतम पहले')}`} />
        {visits.length === 0 ? (
          <Empty>{pick(lang, 'You have not logged any visits.', 'आपने कोई भ्रमण दर्ज नहीं किया।')}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {visits.map((v) => {
              const checklist = (() => { try { return JSON.parse(v.checklist) as { item: string; done: boolean }[]; } catch { return []; } })();
              const done = checklist.filter((c) => c.done).length;
              return (
                <li key={v.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tnum w-24 shrink-0 text-sm text-ink-faint">{fmtDate(v.visit_date)}</span>
                    <Pill>{v.purpose.replace(/_/g, ' ')}</Pill>
                    <Link href={`/schools/${v.school_id}`} className="link text-sm font-medium">
                      {schools.get(v.school_id) ?? v.school_id}
                    </Link>
                    {v.case_id ? (
                      <Link href={`/cases/${v.case_id}`} className="text-xs text-brand hover:underline">
                        <Mono>{v.case_id}</Mono>
                      </Link>
                    ) : null}
                    {checklist.length > 0 ? (
                      <span className="tnum text-xs text-ink-soft">
                        {done}/{checklist.length} {pick(lang, 'checks done', 'जाँच पूरी')}
                      </span>
                    ) : null}
                    {v.gps_status === 'outside_radius' ? <Pill tone="warn">{pick(lang, 'GPS away from the school', 'GPS दूर')}</Pill> : null}
                    {v.gps_status === 'not_captured' ? <Pill>{pick(lang, 'no GPS', 'GPS नहीं')}</Pill> : null}
                    {v.sync_status === 'pending_sync' ? <Pill tone="warn">{pick(lang, 'waiting to sync', 'सिंक प्रतीक्षित')}</Pill> : null}
                  </div>
                  {v.notes ? <p className="mt-1 text-sm text-ink-soft sm:pl-[6.75rem]">{v.notes}</p> : null}
                  {checklist.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs sm:pl-[6.75rem]">
                      {checklist.map((c) => (
                        <li key={c.item} className={c.done ? 'text-good' : 'text-ink-faint'}>
                          <span aria-hidden>{c.done ? '✓' : '○'}</span> {c.item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
