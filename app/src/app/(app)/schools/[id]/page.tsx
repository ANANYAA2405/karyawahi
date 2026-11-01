import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import {
  school, schoolAssessments, schoolAttendance, schoolStaffEvents, schoolVisits,
  competencies, rounds, placeNames, userNames,
} from '@/lib/repo';
import { listCases, listTasks } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { today } from '@/lib/clock';
import { isHeadmaster } from '@/lib/scope';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Grid, Stat, Facts, Field, Callout, Empty, Mono,
  fmtDate, fmtInt, fmtPct,
} from '@/components/ui';
import { Pill, ProvenanceChip } from '@/components/labels';
import { CaseTable, TaskTable } from '@/components/lists';
import { TrendChart } from '@/components/charts';
import { SERIES } from '@/lib/viz';

/** One school: its numbers, its cases, its visits and what moved its staff. */

export default async function SchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;

  const s = school(session, id);
  if (!s) notFound();

  const places = placeNames();
  const assessments = schoolAssessments(session, id);
  const attendance = schoolAttendance(session, id, 18);
  const staff = schoolStaffEvents(session, id);
  const visits = schoolVisits(session, id, 20);
  const cases = listCases(session, { limit: 50 }).filter((c) => c.school_ids.includes(id));
  const tasks = listTasks(session, { limit: 200 }).filter((t) => t.school_id === id);
  const look = lookupsFor(lang, {
    users: [...cases.map((c) => c.owner_user_id), ...tasks.map((t) => t.owner_user_id)],
    schools: [id],
  });
  const visitors = userNames(visits.map((v) => v.visitor_user_id));
  const completed = rounds().filter((r) => r.status === 'completed');
  const comps = competencies();
  const hm = isHeadmaster(session);

  return (
    <div className="space-y-4">
      <PageHead
        breadcrumb={
          <>
            <Link href="/schools" className="link">{pick(lang, 'Schools', 'विद्यालय')}</Link>
            {' › '}<Mono>{s.id}</Mono>
          </>
        }
        title={s.name}
        sub={`${s.village} · ${places.clusters.get(s.cluster_id) ?? s.cluster_id} · ${places.blocks.get(s.block_id) ?? s.block_id} · ${places.districts.get(s.district_id) ?? s.district_id}`}
        right={<ProvenanceChip provenance={s.provenance} lang={lang} />}
      />

      <Grid cols={5}>
        <Stat label={pick(lang, 'Total enrolment', 'कुल नामांकन')} value={fmtInt(s.enrolment_total)} />
        <Stat label={pick(lang, 'Class 1–3', 'कक्षा 1–3')} value={fmtInt(s.enrolment_g1 + s.enrolment_g2 + s.enrolment_g3)}
          sub={`${s.enrolment_g1} · ${s.enrolment_g2} · ${s.enrolment_g3}`} />
        <Stat label={pick(lang, 'Teachers', 'शिक्षक')} value={`${s.teachers_in_position}/${s.teachers_sanctioned}`}
          tone={s.teachers_in_position < s.teachers_sanctioned ? 'warn' : 'neutral'} />
        <Stat label={pick(lang, 'Pupil–teacher ratio', 'छात्र-शिक्षक अनुपात')} value={s.ptr}
          tone={s.ptr > 35 ? 'warn' : 'neutral'} sub={s.ptr > 35 ? pick(lang, 'above the 35 threshold', '35 की सीमा से अधिक') : undefined} />
        <Stat label={pick(lang, 'Cases naming this school', 'इसके प्रकरण')} value={cases.length}
          tone={cases.length > 0 ? 'crit' : 'neutral'} />
      </Grid>

      <Card>
        <CardHead
          title={pick(lang, 'Learning, round by round', 'दौर-दर-दौर सीखना')}
          hint={pick(lang, 'Share of assessed children reaching the grade benchmark. Literacy and numeracy are shown separately — one scale per chart.', 'ग्रेड मानक तक पहुँचने वाले बच्चों का प्रतिशत। भाषा और गणित अलग-अलग।')}
        />
        <div className="card-pad space-y-5">
          {[1, 2, 3].map((grade) => {
            const groups = (['literacy', 'numeracy'] as const).map((domain) => ({
              domain,
              label: domain === 'literacy' ? pick(lang, 'Literacy', 'भाषा') : pick(lang, 'Numeracy', 'गणित'),
              series: comps.filter((c) => c.domain === domain).map((c, i) => ({
                key: `${grade}-${c.id}`,
                label: pick(lang, c.name_en, c.name_hi),
                color: [SERIES.one, SERIES.two, SERIES.three][i % 3],
                points: completed.map((r) => {
                  const row = assessments.find((a) => a.round_id === r.id && a.grade === grade && a.competency_id === c.id);
                  return row ? row.pct_proficient : null;
                }),
              })).filter((x) => x.points.some((p) => p !== null)),
            })).filter((gr) => gr.series.length > 0);
            if (groups.length === 0) return null;
            return (
              <div key={grade}>
                <h3 className="h-section mb-2">{pick(lang, 'Class', 'कक्षा')} {grade}</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {groups.map((gr) => (
                    <div key={gr.domain}>
                      <p className="mb-1 text-sm font-medium text-ink-soft">{gr.label}</p>
                      <TrendChart
                        xLabels={completed.map((r) => r.code)} series={gr.series} height={190}
                        caption={`Class ${grade} ${gr.label} at ${s.name}: percentage of assessed children at the grade benchmark in each round.`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {assessments.length === 0 ? <Empty>{pick(lang, 'No assessment rows for this school.', 'इस विद्यालय का कोई आकलन नहीं।')}</Empty> : null}
        </div>
      </Card>

      {attendance.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Attendance', 'उपस्थिति')} hint={pick(lang, 'Average daily attendance by month.', 'मासिक औसत दैनिक उपस्थिति।')} />
          <div className="card-pad">
            <TrendChart
              xLabels={[...attendance].reverse().map((a) => a.month.slice(2))}
              series={[{ key: 'att', label: pick(lang, 'Attendance', 'उपस्थिति'), color: SERIES.one, points: [...attendance].reverse().map((a) => a.avg_attendance_pct) }]}
              yLabel="% present" height={190}
              caption={`Average daily attendance as a percentage, by month, at ${s.name}.`}
            />
          </div>
        </Card>
      ) : null}

      {cases.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Cases this school is named in', 'इस विद्यालय के प्रकरण')} />
          <CaseTable cases={cases} look={look} lang={lang} />
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Work at this school', 'इस विद्यालय का काम')} />
          <TaskTable tasks={tasks} look={look} lang={lang} today={today()} />
        </Card>
      ) : null}

      {!hm ? (
        staff.length > 0 ? (
          <Card>
            <CardHead
              title={pick(lang, 'Teacher movement', 'शिक्षक आवागमन')}
              hint={pick(lang, 'Transfers out and joinings. A transfer with no replacement is one of the conditions the diagnosis looks for.', 'स्थानांतरण और कार्यभार ग्रहण। प्रतिस्थापन के बिना स्थानांतरण निदान की एक स्थिति है।')}
            />
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Date', 'तिथि')}</th>
                  <th scope="col">{pick(lang, 'Event', 'घटना')}</th>
                  <th scope="col">{pick(lang, 'Teacher reference', 'शिक्षक संदर्भ')}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((e) => (
                  <tr key={e.id}>
                    <td className="tnum whitespace-nowrap text-sm">{fmtDate(e.event_date)}</td>
                    <td>
                      <Pill tone={e.event_type === 'transfer_out' ? 'critical' : 'good'}>
                        {e.event_type === 'transfer_out' ? pick(lang, 'transferred out', 'स्थानांतरित') : pick(lang, 'joined', 'कार्यभार ग्रहण')}
                      </Pill>
                    </td>
                    <td><Mono>{e.teacher_ref}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null
      ) : (
        <Callout tone="method">
          {pick(
            lang,
            'The teacher movement record is not shown to a headmaster role. That is a row-level rule on the server, not a choice made by this page.',
            'शिक्षक आवागमन रिकॉर्ड प्रधानाध्यापक भूमिका को नहीं दिखाया जाता। यह सर्वर का नियम है।',
          )}
        </Callout>
      )}

      {visits.length > 0 ? (
        <Card>
          <CardHead title={pick(lang, 'Visits', 'भ्रमण')} hint={`${visits.length} ${pick(lang, 'most recent', 'नवीनतम')}`} />
          <ul className="divide-y divide-line">
            {visits.map((v) => (
              <li key={v.id} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="tnum w-24 shrink-0 text-sm text-ink-faint">{fmtDate(v.visit_date)}</span>
                  <Pill>{v.purpose.replace(/_/g, ' ')}</Pill>
                  <span className="text-sm text-ink-soft">
                    {visitors.get(v.visitor_user_id) ?? v.visitor_user_id} ({v.visitor_role})
                  </span>
                  {v.case_id ? <Link href={`/cases/${v.case_id}`} className="text-xs text-brand hover:underline">{v.case_id}</Link> : null}
                  {v.gps_status === 'outside_radius' ? <Pill tone="warn">{pick(lang, 'GPS away from the school', 'GPS दूर')}</Pill> : null}
                </div>
                {v.notes ? <p className="mt-0.5 text-sm text-ink-soft sm:pl-[6.75rem]">{v.notes}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'Record details', 'रिकॉर्ड विवरण')} />
        <div className="card-pad">
          <Facts cols={4}>
            <Field label={pick(lang, 'School id', 'विद्यालय आईडी')}><Mono>{s.id}</Mono></Field>
            <Field label={pick(lang, 'Grades served', 'कक्षाएँ')}>
              {(() => { try { return (JSON.parse(s.grades_served) as number[]).join(', '); } catch { return s.grades_served; } })()}
            </Field>
            <Field label={pick(lang, 'Source reference', 'स्रोत संदर्भ')}><Mono>{s.source_ref}</Mono></Field>
            <Field label={pick(lang, 'Provenance', 'स्रोत')}><ProvenanceChip provenance={s.provenance} lang={lang} /></Field>
          </Facts>
        </div>
      </Card>
    </div>
  );
}
