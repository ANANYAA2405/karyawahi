import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { headline, blockRollup, outcomeMix, detectionHealth, timeToClose } from '@/lib/dash';
import { listCases, listTasks, approvalQueue, outcomesToReview } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { scopeName, blockCompetencySnapshot, competencies, rounds } from '@/lib/repo';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Callout, fmtDate, Mono } from '@/components/ui';
import { CaseTable, TaskTable } from '@/components/lists';
import { HeadlineStats, RollupTable, OutcomeMix, DetectionHealth, CompetencyGrid } from '@/components/dash';
import { OutcomePill } from '@/components/labels';

/** The district officer's view: where blocks are stuck, and what has escalated to them. */

export default async function DistrictHome() {
  const session = await pageSession();
  const lang = await getLanguage();
  const districtId = session.roles.find((r) => r.scope_type === 'district')?.scope_id;

  const h = headline(session);
  const blocks = blockRollup(session, districtId);
  const escalated = listTasks(session, { escalated: true, limit: 15 });
  const queue = approvalQueue(session, { limit: 10 });
  const critical = listCases(session, { severity: ['critical'], open: true, limit: 10 });
  const reviews = outcomesToReview(session, { limit: 8 });
  const snapshot = blockCompetencySnapshot(session, { districtId });
  const lastRound = rounds().filter((r) => r.status === 'completed').at(-1);
  const tt = timeToClose(session);

  const look = lookupsFor(lang, {
    users: [...escalated.map((t) => t.owner_user_id), ...critical.map((c) => c.owner_user_id), ...queue.map((q) => q.case.owner_user_id)],
    schools: escalated.map((t) => t.school_id ?? ''),
  });
  const compNames = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  return (
    <div className="space-y-4">
      <PageHead
        title={`${pick(lang, 'District office', 'ज़िला कार्यालय')} — ${scopeName('district', districtId ?? session.scope_id)}`}
        sub={pick(
          lang,
          'Blocks ranked by what is stuck, not by what looks good. Escalations arrive here automatically when a task is seven days past its deadline.',
          'खंडों का क्रम इस आधार पर कि कहाँ काम रुका है। सात दिन विलंब पर काम स्वतः यहाँ आता है।',
        )}
      />

      <HeadlineStats h={h} lang={lang} />

      <RollupTable
        rows={blocks} lang={lang}
        title={pick(lang, 'Blocks in your district', 'आपके ज़िले के खंड')}
        hint={pick(lang, 'Worst first. Overdue tasks and pending proof are where attention is actually needed.', 'सबसे चिंताजनक पहले।')}
        label={pick(lang, 'Block', 'खंड')}
      />

      {escalated.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Escalated to you', 'आपको भेजे गए')}
            hint={pick(lang, 'Seven or more days past the deadline with no proof submitted.', 'सात या अधिक दिन विलंब, सबूत जमा नहीं।')}
          />
          <TaskTable tasks={escalated} look={look} lang={lang} today={today()} />
        </Card>
      ) : null}

      {queue.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'District and PAB plans waiting on you', 'ज़िला/PAB योजनाएँ प्रतीक्षित')}
            right={<Link href="/approvals" className="btn-primary">{pick(lang, 'Decide them', 'निर्णय लें')}</Link>}
          />
          <CaseTable cases={queue.map((q) => q.case)} look={look} lang={lang} />
        </Card>
      ) : null}

      {critical.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Critical and still open', 'अति गंभीर और खुले')} />
          <CaseTable cases={critical} look={look} lang={lang} />
        </Card>
      ) : null}

      {reviews.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Outcome checks nobody has read yet', 'अपठित परिणाम जाँच')}
            hint={pick(lang, 'Including the ones that found no improvement.', 'उन सहित जिनमें सुधार नहीं मिला।')}
          />
          <ul className="divide-y divide-line">
            {reviews.map(({ outcome: o, case: c }) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                <OutcomePill category={o.category} lang={lang} />
                <Link href={`/cases/${o.case_id}#outcome`} className="link text-sm">
                  {c?.title ?? o.case_id}
                </Link>
                <span className="tnum text-sm text-ink-soft">
                  {o.did_pp === null ? '—' : `${o.did_pp > 0 ? '+' : ''}${o.did_pp} pp`}
                </span>
                <span className="text-xs text-ink-faint">{fmtDate(o.evaluated_at)}</span>
                <Mono>{o.id}</Mono>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <OutcomeMix rows={outcomeMix(session)} lang={lang} />
        <DetectionHealth rows={detectionHealth(session)} lang={lang} />
      </div>

      <Grid cols={3}>
        <Stat label={pick(lang, 'Closed on proof', 'सबूत पर बंद')} value={tt.closed} tone="good" />
        <Stat
          label={pick(lang, 'Typical time to close', 'औसत समय')}
          value={tt.medianDays === null ? '—' : `${tt.medianDays}d`}
          sub={pick(lang, 'median across closed cases', 'बंद प्रकरणों का मध्यमान')}
        />
        <Stat
          label={pick(lang, 'Reopened', 'फिर खोले')} value={h.reopened}
          tone={h.reopened > 0 ? 'warn' : 'neutral'}
          sub={pick(lang, 'delivered without a measured gain', 'कार्य हुआ, सुधार नहीं')}
        />
      </Grid>

      {snapshot.length > 0 && lastRound ? (
        <CompetencyGrid rows={snapshot} competencyNames={compNames} lang={lang} roundLabel={`${lastRound.code} · ${lastRound.label}`} />
      ) : null}

      {h.open_cases === 0 ? (
        <Callout tone="good">{pick(lang, 'Nothing open in your district.', 'आपके ज़िले में कुछ खुला नहीं।')}</Callout>
      ) : null}
    </div>
  );
}
