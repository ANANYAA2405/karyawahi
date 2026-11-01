import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listTasks, countTasks } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import {
  school, schoolAssessments, schoolAttendance, schoolVisits, competencies, rounds,
} from '@/lib/repo';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { schoolName } from '@/lib/school-label';
import { Card, CardHead, PageHead, Grid, Stat, Callout, Facts, Field, Empty, Mono, fmtDate, fmtPct, fmtInt } from '@/components/ui';
import { ComplaintsPanel, MapPanel } from '@/components/role-panels';
import { TaskTable } from '@/components/lists';
import { Pill } from '@/components/labels';
import { TrendChart } from '@/components/charts';
import { SERIES } from '@/lib/viz';

/**
 * The headmaster's view: their own school and their own tasks, and nothing else.
 *
 * Deliberately narrow. A headmaster cannot see other schools, other people's tasks, the staff
 * movement table or the audit log — the row-level rules refuse all of it — so the page shows
 * what they are accountable for and the numbers behind it.
 */

export default async function SchoolHome() {
  const session = await pageSession();
  const lang = await getLanguage();
  const schoolId = session.roles.find((r) => r.scope_type === 'school')?.scope_id;

  if (!schoolId) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'My school', 'मेरा विद्यालय')} />
        <Callout tone="warn">
          {pick(lang, 'Your account is not attached to a school.', 'आपका खाता किसी विद्यालय से जुड़ा नहीं है।')}
        </Callout>
      </div>
    );
  }

  const s = school(session, schoolId);
  const mine = { ownerUserId: session.user_id };
  const todo = listTasks(session, { ...mine, status: ['assigned', 'acknowledged', 'in_progress', 'sent_back'], limit: 40 });
  const counts = {
    overdue: countTasks(session, { ...mine, overdue: true }),
    submitted: countTasks(session, { ...mine, status: ['submitted'] }),
    verified: countTasks(session, { ...mine, status: ['verified'] }),
  };
  const assessments = schoolAssessments(session, schoolId);
  const attendance = schoolAttendance(session, schoolId, 14);
  const visits = schoolVisits(session, schoolId, 10);
  const look = lookupsFor(lang, { users: todo.map((t) => t.owner_user_id), schools: [schoolId] });

  const completed = rounds().filter((r) => r.status === 'completed');
  const CATEGORY: Record<string, [string, string]> = { primary: ['Primary', 'प्राथमिक'], upper_primary: ['Upper primary', 'उच्च प्राथमिक'], composite: ['Composite', 'संयुक्त'] };
  const PURPOSE: Record<string, [string, string]> = { routine: ['Routine', 'नियमित'], spot_assessment: ['Spot assessment', 'त्वरित आकलन'], coaching: ['Coaching', 'सहयोग'], spot_check: ['Spot check', 'जाँच'] };
  const comps = competencies();

  return (
    <div className="space-y-4">
      <PageHead
        title={s?.name ? schoolName(s.name, lang) : schoolId}
        sub={s ? `${s.village} · ${pick(lang, 'Class 1–3 enrolment', 'कक्षा 1–3 नामांकन')} ${fmtInt(s.enrolment_g1 + s.enrolment_g2 + s.enrolment_g3)}` : undefined}
        right={<Mono>{schoolId}</Mono>}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Tasks to do', 'करने वाले काम')} value={todo.length} tone="brand" href="/tasks" />
        <Stat label={pick(lang, 'Overdue', 'विलंबित')} value={counts.overdue} tone={counts.overdue > 0 ? 'crit' : 'neutral'} />
        <Stat label={pick(lang, 'Waiting to be checked', 'जाँच प्रतीक्षित')} value={counts.submitted} tone="pend" />
        <Stat label={pick(lang, 'Verified', 'सत्यापित')} value={counts.verified} tone="good" />
      </Grid>

      <Card>
        <CardHead
          title={pick(lang, 'What you have been asked to do', 'आपसे क्या अपेक्षित है')}
          hint={pick(lang, 'Each task says what proof it needs. Someone else checks it.', 'हर काम बताता है कौन सा सबूत चाहिए। कोई और उसे जाँचेगा।')}
        />
        <TaskTable
          tasks={todo} look={look} lang={lang} today={today()} showCase={false}
          emptyText={pick(lang, 'Nothing assigned to you right now.', 'अभी आपको कुछ नहीं सौंपा गया।')}
        />
      </Card>

      {s ? (
        <Card>
          <CardHead title={pick(lang, 'Your school', 'आपका विद्यालय')} />
          <div className="card-pad">
            <Facts cols={4}>
              <Field label={pick(lang, 'Village', 'गाँव')}>{s.village}</Field>
              <Field label={pick(lang, 'Category', 'श्रेणी')}>{CATEGORY[s.category] ? pick(lang, ...CATEGORY[s.category]) : s.category.replace(/_/g, ' ')}</Field>
              <Field label={pick(lang, 'Total enrolment', 'कुल नामांकन')}><span className="tnum">{fmtInt(s.enrolment_total)}</span></Field>
              <Field label={pick(lang, 'Teachers in position', 'कार्यरत शिक्षक')}>
                <span className="tnum">{s.teachers_in_position} / {s.teachers_sanctioned}</span>
                {s.teachers_in_position < s.teachers_sanctioned ? (
                  <span className="ml-1.5"><Pill tone="warn">{pick(lang, 'short', 'कमी')}</Pill></span>
                ) : null}
              </Field>
              <Field label={pick(lang, 'Class 1', 'कक्षा 1')}><span className="tnum">{s.enrolment_g1}</span></Field>
              <Field label={pick(lang, 'Class 2', 'कक्षा 2')}><span className="tnum">{s.enrolment_g2}</span></Field>
              <Field label={pick(lang, 'Class 3', 'कक्षा 3')}><span className="tnum">{s.enrolment_g3}</span></Field>
              <Field label={pick(lang, 'Pupil–teacher ratio', 'छात्र-शिक्षक अनुपात')}>
                <span className="tnum">{s.ptr}</span>
                {s.ptr > 35 ? <span className="ml-1.5"><Pill tone="warn">{pick(lang, 'above 35', '35 से अधिक')}</Pill></span> : null}
              </Field>
            </Facts>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ComplaintsPanel s={session} mode="mine" lang={lang} />
        <MapPanel title={pick(lang, 'Your school', 'आपका विद्यालय')} height={260} lang={lang} />
      </div>

      <Card>
      <CardHead
          title={pick(lang, 'How your children are doing', 'आपके बच्चों की प्रगति')}
          hint={pick(lang, 'Share reaching the grade benchmark in each round.', 'प्रत्येक दौर में ग्रेड मानक तक पहुँचने वाले बच्चों का प्रतिशत।')}
        />
        <div className="card-pad space-y-5">
          {[1, 2, 3].map((grade) => {
            const series = comps.map((c, i) => ({
              key: `${grade}-${c.id}`,
              label: pick(lang, c.name_en, c.name_hi),
              color: [SERIES.one, SERIES.two, SERIES.three][i % 3],
              points: completed.map((r) => {
                const row = assessments.find((a) => a.round_id === r.id && a.grade === grade && a.competency_id === c.id);
                return row ? row.pct_proficient : null;
              }),
            })).filter((s) => s.points.some((p) => p !== null));
            if (series.length === 0) return null;
            // Literacy and numeracy are two charts, not one with two axes.
            const lit = series.filter((_, i) => comps[i]?.domain === 'literacy');
            const num = series.filter((_, i) => comps[i]?.domain === 'numeracy');
            return (
              <div key={grade}>
                <h3 className="h-section mb-2">{pick(lang, 'Class', 'कक्षा')} {grade}</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[{ rows: lit, label: pick(lang, 'Literacy', 'भाषा') }, { rows: num, label: pick(lang, 'Numeracy', 'गणित') }]
                    .filter((g) => g.rows.length > 0)
                    .map((g) => (
                      <div key={g.label}>
                        <p className="mb-1 text-sm font-medium text-ink-soft">{g.label}</p>
                        <TrendChart
                          xLabels={completed.map((r) => r.code)}
                          series={g.rows}
                          height={190}
                          lang={lang}
                          caption={pick(lang,
                            `Class ${grade} ${g.label}: percentage of assessed children at the grade benchmark in each round at this school.`,
                            `कक्षा ${grade} ${g.label}: इस विद्यालय में प्रत्येक दौर में ग्रेड मानक तक पहुँचे आकलित बच्चों का प्रतिशत।`)}
                        />
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {attendance.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Attendance, month by month', 'मासिक उपस्थिति')} />
          <div className="card-pad">
            <TrendChart
              xLabels={[...attendance].reverse().map((a) => a.month.slice(2))}
              series={[{
                key: 'att', label: pick(lang, 'Average attendance', 'औसत उपस्थिति'),
                color: SERIES.one, points: [...attendance].reverse().map((a) => a.avg_attendance_pct),
              }]}
              yLabel="% present"
              height={190}
              lang={lang}
              caption={pick(lang, 'Average daily attendance as a percentage, by month, at this school.', 'इस विद्यालय में माह के अनुसार औसत दैनिक उपस्थिति, प्रतिशत में।')}
            />
          </div>
        </Card>
      ) : null}

      {visits.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Visits to your school', 'आपके विद्यालय में भ्रमण')} />
          <ul className="divide-y divide-line">
            {visits.map((v) => (
              <li key={v.id} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="tnum w-24 shrink-0 text-sm text-ink-faint">{fmtDate(v.visit_date, false, lang)}</span>
                  <Pill>{PURPOSE[v.purpose] ? pick(lang, ...PURPOSE[v.purpose]) : v.purpose.replace(/_/g, ' ')}</Pill>
                  <span className="text-sm text-ink-soft">{v.visitor_role.toUpperCase()}</span>
                </div>
                {v.notes ? <p className="mt-0.5 pl-[6.75rem] text-sm text-ink-soft">{v.notes}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Callout tone="method">
        {pick(
          lang,
          'You see your own school and your own tasks. Other schools, other people\'s work, the staff movement record and the audit log are refused to this role by the server, not merely hidden from this page.',
          'आप अपना विद्यालय और अपने काम देखते हैं। अन्य विद्यालय, दूसरों के काम, शिक्षक स्थानांतरण और अंकेक्षण लॉग इस भूमिका के लिए सर्वर द्वारा अस्वीकृत हैं।',
        )}
      </Callout>
    </div>
  );
}
