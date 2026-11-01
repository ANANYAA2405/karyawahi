import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { headline, clusterRollup, outcomeMix, detectionHealth, timeToClose } from '@/lib/dash';
import { listCases, listTasks, approvalQueue, evidenceToCheck, listFindings } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { scopeName, blockCompetencySnapshot, competencies, rounds } from '@/lib/repo';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Stat, Grid } from '@/components/ui';
import { CaseTable, TaskTable, FindingTable } from '@/components/lists';
import { HeadlineStats, RollupTable, OutcomeMix, DetectionHealth, CompetencyGrid } from '@/components/dash';

/**
 * The block officer's desk. This is the role the whole product is built around: they decide the
 * plans, assign the work, verify the proof and close the cases, so the page leads with what is
 * waiting on them rather than with a summary of how the block is doing.
 */

export default async function BeoHome() {
  const session = await pageSession();
  const lang = await getLanguage();
  const blockId = session.roles.find((r) => r.scope_type === 'block')?.scope_id;

  const h = headline(session);
  const queue = approvalQueue(session, { limit: 10 });
  const overdue = listTasks(session, { overdue: true, limit: 12 });
  const proof = evidenceToCheck(session, { limit: 8 });
  const pendingOutcome = listCases(session, { status: ['outcome_pending'], limit: 8, order: 'due' });
  const active = listCases(session, { status: ['in_progress', 'assigned', 'awaiting_verification'], limit: 10 });
  const fresh = listFindings(session, { status: ['case_opened', 'monitoring'], limit: 8, order: 'recent' });
  const clusters = clusterRollup(session, blockId);
  const snapshot = blockCompetencySnapshot(session, { blockId });
  const lastRound = rounds().filter((r) => r.status === 'completed').at(-1);
  const tt = timeToClose(session);

  const look = lookupsFor(lang, {
    users: [...queue.map((q) => q.case.owner_user_id), ...overdue.map((t) => t.owner_user_id), ...active.map((c) => c.owner_user_id), ...pendingOutcome.map((c) => c.owner_user_id)],
    schools: [...overdue.map((t) => t.school_id ?? ''), ...proof.map((e) => e.school_id ?? '')],
  });
  const compNames = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  return (
    <div className="space-y-4">
      <PageHead
        title={`${pick(lang, 'Block office', 'खंड कार्यालय')} — ${scopeName('block', blockId ?? session.scope_id)}`}
        sub={pick(
          lang,
          'What is waiting on you, in the order it matters. Nothing here closes on activity: a case closes only when the next assessment round shows the gain its plan was built to produce.',
          'जो आपकी प्रतीक्षा में है, महत्व के क्रम में। कोई प्रकरण केवल गतिविधि पर बंद नहीं होता — अगले आकलन में सुधार दिखना आवश्यक है।',
        )}
      />

      <HeadlineStats h={h} lang={lang} />

      {queue.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Plans waiting on your decision', 'आपके निर्णय की प्रतीक्षा में योजनाएँ')}
            hint={pick(lang, 'Approving locks what will count as success.', 'स्वीकृति से सफलता की परिभाषा तय हो जाती है।')}
            right={<Link href="/approvals" className="btn-primary">{pick(lang, 'Decide them', 'निर्णय लें')}</Link>}
          />
          <CaseTable cases={queue.map((q) => q.case)} look={look} lang={lang} showBlock={false} />
        </Card>
      ) : null}

      {h.evidence_pending > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Proof waiting to be checked', 'जाँचने योग्य सबूत')}
            hint={`${h.evidence_pending} ${pick(lang, 'pieces, none of them yours', 'सबूत, कोई आपका नहीं')}`}
            right={<Link href="/evidence" className="btn-quiet">{pick(lang, 'Open the queue', 'कतार खोलें')}</Link>}
          />
          <ul className="divide-y divide-line">
            {proof.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm sm:px-5">
                <Link href={`/cases/${e.case_id}`} className="link">{e.case_id}</Link>
                <span className="text-ink">{e.evidence_type.replace(/_/g, ' ')}</span>
                <span className="text-ink-soft">{look.users.get(e.submitted_by) ?? e.submitted_by}</span>
                {e.school_id ? <span className="text-ink-faint">{look.schools.get(e.school_id)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {overdue.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Overdue work in your block', 'आपके खंड में विलंबित काम')}
            hint={pick(lang, 'Reminders go out two days before the deadline; anything seven days past it escalates to the district.', 'नियत तिथि से दो दिन पहले स्मरण; सात दिन बाद ज़िले को सूचना।')}
          />
          <TaskTable tasks={overdue} look={look} lang={lang} today={today()} />
        </Card>
      ) : null}

      {pendingOutcome.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Delivered, waiting for the next round', 'कार्य पूरा, अगले दौर की प्रतीक्षा')}
            hint={pick(
              lang,
              'The work is verified. Whether it worked is decided by the next assessment, not by the fact that it was done.',
              'काम सत्यापित है। यह काम आया या नहीं, अगला आकलन तय करेगा।',
            )}
          />
          <CaseTable cases={pendingOutcome} look={look} lang={lang} showBlock={false} />
        </Card>
      ) : null}

      {active.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Work under way', 'काम जारी')} />
          <CaseTable cases={active} look={look} lang={lang} showBlock={false} />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <OutcomeMix rows={outcomeMix(session)} lang={lang} />
        <DetectionHealth rows={detectionHealth(session)} lang={lang} />
      </div>

      {tt.closed > 0 ? (
        <Grid cols={3}>
          <Stat
            label={pick(lang, 'Cases closed on proof', 'सबूत पर बंद प्रकरण')} value={tt.closed} tone="good"
          />
          <Stat
            label={pick(lang, 'Typical time to close', 'बंद होने में औसत समय')}
            value={tt.medianDays === null ? '—' : `${tt.medianDays}d`}
            sub={pick(lang, 'median, detection to closure', 'मध्यमान, पहचान से बंद होने तक')}
          />
          <Stat
            label={pick(lang, 'Reopened at least once', 'कम से कम एक बार फिर खोले')} value={h.reopened}
            tone={h.reopened > 0 ? 'warn' : 'neutral'}
            sub={pick(lang, 'work was done, the gain was not there', 'काम हुआ, सुधार नहीं मिला')}
          />
        </Grid>
      ) : null}

      {snapshot.length > 0 && lastRound ? (
        <CompetencyGrid
          rows={snapshot} competencyNames={compNames} lang={lang}
          roundLabel={`${lastRound.code} · ${lastRound.label}`}
        />
      ) : null}

      <RollupTable
        rows={clusters} lang={lang}
        title={pick(lang, 'Clusters in your block', 'आपके खंड के संकुल')}
        hint={pick(lang, 'Sorted by critical cases, then open cases.', 'अति गंभीर प्रकरणों के क्रम में।')}
        label={pick(lang, 'Cluster', 'संकुल')}
      />

      {fresh.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Most recent findings', 'नवीनतम निष्कर्ष')}
            right={<Link href="/findings" className="link text-sm">{pick(lang, 'All findings', 'सभी निष्कर्ष')}</Link>}
          />
          <FindingTable findings={fresh} look={look} lang={lang} />
        </Card>
      ) : null}

      {h.open_cases === 0 ? (
        <Callout tone="good">
          {pick(lang, 'Nothing is open in your block right now.', 'आपके खंड में अभी कोई प्रकरण खुला नहीं है।')}
        </Callout>
      ) : null}
    </div>
  );
}
