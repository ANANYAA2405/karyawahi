import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listJobs } from '@/lib/feed';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Toolbar, Empty, Mono, fmtDate } from '@/components/ui';
import { Pill } from '@/components/labels';
import { FilterChips } from '@/components/lists';
import { hasRole } from '@/lib/scope';

/** The scheduled work: detection runs, outcome runs, reminder sweeps, imports, dispatches. */

export default async function JobsPage({
  searchParams,
}: { searchParams: Promise<{ type?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!hasRole(session, 'state_admin', 'demo_admin')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'System jobs', 'सिस्टम कार्य')} />
        <Callout tone="warn">{pick(lang, 'Only the state team and the demo administrator can see the job log.', 'केवल राज्य दल और डेमो प्रशासक कार्य लॉग देख सकते हैं।')}</Callout>
      </div>
    );
  }

  const all = listJobs(session, { limit: 400 });
  const types = [...new Set(all.map((j) => j.job_type))];
  const jobs = sp.type ? all.filter((j) => j.job_type === sp.type) : all;

  return (
    <div>
      <PageHead
        title={pick(lang, 'System jobs', 'सिस्टम कार्य')}
        sub={pick(
          lang,
          'Everything the system did on its own: detection runs after an import, outcome checks when a round lands, the nightly reminder sweep, channel dispatches.',
          'वह सब जो सिस्टम ने स्वयं किया: आयात के बाद पहचान, दौर आने पर परिणाम जाँच, रात्रि स्मरण, संदेश प्रेषण।',
        )}
      />
      <Toolbar>
        <FilterChips
          base="/admin/jobs" param="type" current={sp.type} lang={lang}
          options={[
            { value: '', label: pick(lang, 'All', 'सभी'), count: all.length },
            ...types.map((t) => ({ value: t, label: t.replace(/_/g, ' '), count: all.filter((j) => j.job_type === t).length })),
          ]}
        />
      </Toolbar>
      <Card>
        <CardHead title={pick(lang, 'Runs', 'निष्पादन')} hint={`${jobs.length} ${pick(lang, 'shown', 'दिखाए')}`} />
        {jobs.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Job', 'कार्य')}</th>
                  <th scope="col">{pick(lang, 'Started', 'आरंभ')}</th>
                  <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
                  <th scope="col">{pick(lang, 'What it did', 'क्या किया')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td><Mono>{j.job_type}</Mono></td>
                    <td className="tnum whitespace-nowrap text-sm">{fmtDate(j.started_at, true)}</td>
                    <td>
                      <Pill tone={j.status === 'succeeded' ? 'good' : j.status === 'failed' ? 'critical' : 'neutral'}>
                        {j.status}
                      </Pill>
                    </td>
                    <td className="text-sm">
                      {Object.entries(j.summary).map(([k, v]) => (
                        <span key={k} className="mr-3 inline-block">
                          <span className="text-ink-faint">{k.replace(/_/g, ' ')}:</span>{' '}
                          <span className="tnum">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                        </span>
                      ))}
                      {j.error ? <p className="mt-1 text-crit">{j.error}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
