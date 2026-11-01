import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, countTasks } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Toolbar, Callout } from '@/components/ui';
import { TaskTable, FilterChips } from '@/components/lists';
import type { TaskStatus } from '@domain/types';

/** My work. For a headmaster or a coordinator this is the whole application. */

export default async function TasksPage({
  searchParams,
}: { searchParams: Promise<{ filter?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const mine = { ownerUserId: session.user_id };
  const todo: TaskStatus[] = ['assigned', 'acknowledged', 'in_progress', 'sent_back'];
  const counts = {
    todo: countTasks(session, { ...mine, status: todo }),
    overdue: countTasks(session, { ...mine, overdue: true }),
    submitted: countTasks(session, { ...mine, status: ['submitted'] }),
    verified: countTasks(session, { ...mine, status: ['verified'] }),
    sentBack: countTasks(session, { ...mine, status: ['sent_back'] }),
  };

  const f = sp.filter ?? 'todo';
  const filter =
    f === 'overdue' ? { ...mine, overdue: true }
    : f === 'submitted' ? { ...mine, status: ['submitted'] as TaskStatus[] }
    : f === 'verified' ? { ...mine, status: ['verified'] as TaskStatus[] }
    : f === 'sent_back' ? { ...mine, status: ['sent_back'] as TaskStatus[] }
    : f === 'all' ? mine
    : { ...mine, status: todo };

  const tasks = listTasks(session, { ...filter, limit: 200 });
  const look = lookupsFor(lang, {
    users: tasks.map((t) => t.owner_user_id),
    schools: tasks.map((t) => t.school_id ?? ''),
  });

  return (
    <div>
      <PageHead
        title={pick(lang, 'My tasks', 'मेरे काम')}
        sub={pick(
          lang,
          'Each task names the proof it has to produce. Submitting proof is not the same as finishing: somebody else has to check it.',
          'हर काम बताता है कि कौन सा सबूत चाहिए। सबूत जमा करना पूरा होना नहीं है — कोई और उसे जाँचेगा।',
        )}
      />

      <Grid cols={5}>
        <Stat label={pick(lang, 'To do', 'करना है')} value={counts.todo} tone="brand" href="/tasks?filter=todo" />
        <Stat label={pick(lang, 'Overdue', 'विलंबित')} value={counts.overdue} tone="crit" href="/tasks?filter=overdue" />
        <Stat label={pick(lang, 'Sent back to me', 'मुझे लौटाया')} value={counts.sentBack} tone="warn" href="/tasks?filter=sent_back" />
        <Stat label={pick(lang, 'Proof submitted', 'सबूत जमा')} value={counts.submitted} tone="pend" href="/tasks?filter=submitted"
          sub={pick(lang, 'waiting on a checker', 'जाँच की प्रतीक्षा')} />
        <Stat label={pick(lang, 'Verified', 'सत्यापित')} value={counts.verified} tone="good" href="/tasks?filter=verified" />
      </Grid>

      {counts.sentBack > 0 ? (
        <div className="mt-4">
          <Callout tone="warn" title={pick(lang, 'Some proof came back', 'कुछ सबूत लौटाए गए')}>
            {pick(
              lang,
              'A checker sent proof back with a reason. Open the task to read it and submit again.',
              'जाँचकर्ता ने कारण के साथ सबूत लौटाया है। काम खोलकर पढ़ें और फिर जमा करें।',
            )}
          </Callout>
        </div>
      ) : null}

      <div className="mt-4">
        <Toolbar>
          <FilterChips
            base="/tasks" param="filter" current={f} lang={lang}
            options={[
              { value: 'todo', label: pick(lang, 'To do', 'करना है'), count: counts.todo },
              { value: 'overdue', label: pick(lang, 'Overdue', 'विलंबित'), count: counts.overdue },
              { value: 'sent_back', label: pick(lang, 'Sent back', 'लौटाए'), count: counts.sentBack },
              { value: 'submitted', label: pick(lang, 'Submitted', 'जमा'), count: counts.submitted },
              { value: 'verified', label: pick(lang, 'Verified', 'सत्यापित'), count: counts.verified },
              { value: 'all', label: pick(lang, 'Everything', 'सभी') },
            ]}
          />
        </Toolbar>
        <Card>
          <CardHead title={pick(lang, 'Tasks', 'काम')} hint={`${tasks.length} ${pick(lang, 'shown, soonest due first', 'दिखाए गए')}`} />
          <TaskTable
            tasks={tasks} look={look} lang={lang} today={today()}
            emptyText={pick(lang, 'Nothing here.', 'कुछ नहीं।')}
          />
        </Card>
      </div>
    </div>
  );
}
