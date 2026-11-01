import { listBlockers, BLOCKER_TYPES, blockerMeta } from '@/lib/blockers';
import { reportBlockerAction } from '@/lib/actions';
import { grant as grantOf } from '@/lib/guard';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { taskById, taskEvidence, getCase } from '@/lib/cases';
import { userNames, schoolNames, intervention, casePlanForTask } from '@/lib/repo';
import { today, daysAgo } from '@/lib/clock';
import { may } from '@/lib/guard';
import { pick, EVIDENCE_TYPE_LABEL } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Callout, Facts, Field, Mono, fmtDate, shortHash,
} from '@/components/ui';
import {
  TaskStatusPill, EvidenceStatusPill, EvidenceTypeName, RoleName, Pill,
  OverduePill, EscalatedPill, CrossSourcePill,
} from '@/components/labels';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import {
  acknowledgeTaskAction, startTaskAction, submitEvidenceAction, verifyEvidenceAction, reassignTaskAction,
} from '@/lib/actions';
import { reassignView } from '@/lib/plans';
import { EvidenceSummary } from '@/components/EvidenceSummary';
import { involvement, INVOLVEMENT_MESSAGE, type Involvement } from '@/lib/duty';
import { reminderTimeline, reachOf, CHANNEL_NAME, type Step, type StepState } from '@/lib/reminders';
import { LocationField } from '@/components/LocationField';
import { GpsBadge } from '@/components/GpsBadge';
import { SpeakButton, NoteMic } from '@/components/voice';
import { taskSpeech } from '@/lib/voice-text';

/**
 * One task: what it asks for, what proof it needs, and what has been submitted so far.
 * "Listen" reads the task aloud and the proof note can be spoken (src/components/voice.tsx).
 */

/** The three automatic steps, and who each one reaches. */
const STEP_LABEL: Record<Step, { en: string; hi: string }> = {
  reminder: { en: '2 days before', hi: '2 दिन पहले' },
  breach: { en: 'Day after the deadline', hi: 'तिथि निकलने के अगले दिन' },
  escalation: { en: '7 days late', hi: '7 दिन की देरी पर' },
};
const STEP_TONE: Record<StepState, string> = {
  sent: 'text-ink', planned: 'text-ink-soft', pending_run: 'text-warn', not_needed: 'text-good', not_sent: 'text-ink-faint',
};

const INVOLVEMENT_HI: Record<Involvement, string> = {
  submitted: 'यह आपने जमा किया है, अतः आप इसे नहीं जाँच सकते।',
  owner: 'यह काम आपको सौंपा गया है, अतः इसका सबूत कोई और जाँचेगा।',
  former_owner: 'यह काम पहले आपके पास था, अतः इसका सबूत कोई और जाँचेगा।',
  delivered: 'इस काम का सबूत आपने भी जमा किया है, अतः कोई और जाँचेगा।',
};

export default async function TaskPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const { done } = await searchParams;

  const t = taskById(session, id);
  if (!t) notFound();
  const c = getCase(session, t.case_id);
  const evidence = taskEvidence(session, t.id);
  const users = userNames([t.owner_user_id, ...evidence.flatMap((e) => [e.submitted_by, e.verified_by ?? ''])]);
  const schools = schoolNames([t.school_id ?? '', ...evidence.map((e) => e.school_id ?? '')]);
  const plan = casePlanForTask(session, t.plan_id);
  const iv = plan ? intervention(plan.intervention_id) : null;

  const isMine = t.owner_user_id === session.user_id;
  const verifiedCount = evidence.filter((e) => e.status === 'verified').length;
  const overdueDays = t.is_overdue ? daysAgo(t.due_date) : 0;
  const canVerifyHere = may(session, 'evidence.verify');
  // The same separation-of-duties rule verifyEvidence() enforces, so no button is offered that would be refused.
  const tooClose = new Map(evidence.map((e) => [e.id, involvement(session.user_id, e)]));
  const reassign = reassignView(session, t.id);
  const reassignable = reassign && !reassign.refusal;
  const choosable = reassign?.options.filter((o) => !o.blocked) ?? [];
  const prevOwner = t.reassigned_from ? userNames([t.reassigned_from]).get(t.reassigned_from) ?? t.reassigned_from : null;
  const timeline = reminderTimeline(t, today());
  const ownerReach = reachOf(t.owner_user_id);
  const ownerChannel = pick(lang, CHANNEL_NAME[ownerReach.channel].en, CHANNEL_NAME[ownerReach.channel].hi);
  const spokenText = taskSpeech(lang, {
    title: pick(lang, t.title_en, t.title_hi),
    school: t.school_id ? schools.get(t.school_id) ?? t.school_id : null,
    dueIn: -daysAgo(t.due_date), dueDate: fmtDate(t.due_date, false, lang),
    pieces: evidence.filter((e) => e.status !== 'rejected').length, proofCount: t.proof_count,
    proofLabel: pick(lang, EVIDENCE_TYPE_LABEL[t.proof_type]?.en ?? t.proof_type, EVIDENCE_TYPE_LABEL[t.proof_type]?.hi ?? t.proof_type),
    rejection: t.status === 'sent_back' ? evidence.find((e) => e.status === 'rejected')?.rejection_reason ?? null : null,
    waiting: t.status === 'submitted', crossSource: !!t.cross_source,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHead
        breadcrumb={
          <>
            <Link href="/tasks" className="link">{pick(lang, 'My tasks', 'मेरे काम')}</Link>
            {' › '}
            {c ? <Link href={`/cases/${c.id}`} className="link"><Mono>{c.id}</Mono></Link> : <Mono>{t.case_id}</Mono>}
            {' › '}<Mono>{t.id}</Mono>
          </>
        }
        title={pick(lang, t.title_en, t.title_hi)}
        sub={c?.title}
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TaskStatusPill status={t.status} lang={lang} />
            {t.is_overdue ? <OverduePill lang={lang} days={overdueDays} /> : null}
            {t.escalated_at ? <EscalatedPill lang={lang} /> : null}
            {t.cross_source ? <CrossSourcePill lang={lang} /> : null}
            <SpeakButton text={spokenText} lang={lang} subject={pick(lang, t.title_en, t.title_hi)} />
          </div>
        }
      />

      {done ? <Callout tone="good" title={pick(lang, 'Done', 'पूर्ण')}>{done}</Callout> : null}

      <Card>
        <CardHead title={pick(lang, 'What is being asked', 'क्या करना है')} />
        <div className="card-pad space-y-3">
          <Facts cols={3}>
            <Field label={pick(lang, 'Owner', 'ज़िम्मेदार')}>
              {users.get(t.owner_user_id) ?? t.owner_user_id}
              <span className="block text-xs text-ink-faint"><RoleName role={t.owner_role} lang={lang} /></span>
            </Field>
            <Field label={pick(lang, 'School', 'विद्यालय')}>
              {t.school_id
                ? <Link href={`/schools/${t.school_id}`} className="link">{schools.get(t.school_id) ?? t.school_id}</Link>
                : pick(lang, 'all driver schools', 'सभी चिन्हित विद्यालय')}
            </Field>
            <Field label={pick(lang, 'Due', 'नियत तिथि')} hint={
              t.original_due_date !== t.due_date
                ? `${pick(lang, 'originally', 'मूल रूप से')} ${fmtDate(t.original_due_date, false, lang)}`
                : undefined
            }>
              <span className="tnum">{fmtDate(t.due_date, false, lang)}</span>
            </Field>
            <Field label={pick(lang, 'Proof required', 'आवश्यक सबूत')}>
              {t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />
            </Field>
            <Field label={pick(lang, 'Submitted so far', 'अब तक जमा')}>
              <span className="tnum">{evidence.length}</span>
              {verifiedCount > 0 ? (
                <span className="text-xs text-good"> ({verifiedCount} {pick(lang, 'verified', 'सत्यापित')})</span>
              ) : null}
            </Field>
            <Field label={pick(lang, 'Assigned', 'सौंपा गया')}>
              <span className="tnum">{fmtDate(t.assigned_at, false, lang)}</span>
            </Field>
          </Facts>

          {t.cross_source ? (
            <Callout tone="note" title={pick(lang, 'This is the independent check', 'यह स्वतंत्र जाँच है')}>
              {pick(
                lang,
                'The case cannot reach its outcome check until this task is verified. It exists so that at least one piece of proof comes from someone who did not deliver the work.',
                'इस काम के सत्यापित होने तक प्रकरण परिणाम जाँच तक नहीं पहुँच सकता। यह सुनिश्चित करता है कि कम से कम एक सबूत उस व्यक्ति से आए जिसने काम नहीं किया।',
              )}
            </Callout>
          ) : null}

          {t.deadline_change_reason ? (
            <Callout tone="warn" title={pick(lang, 'The deadline was moved', 'समय-सीमा बदली गई')}>
              {t.deadline_change_reason}
            </Callout>
          ) : null}
          {t.reassign_reason ? (
            <Callout tone="warn" title={pick(lang, 'This task was reassigned', 'यह काम पुनः सौंपा गया')}>
              {prevOwner ? <>{pick(lang, 'From', 'पहले')} {prevOwner}: </> : null}{t.reassign_reason}
            </Callout>
          ) : null}

          {iv ? (
            <div>
              <h3 className="h-section mb-1">{pick(lang, 'How to do it', 'कैसे करें')}</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {iv.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              {iv.resources.length > 0 ? (
                <p className="mt-2 text-sm text-ink-soft">
                  {pick(lang, 'You will need:', 'आवश्यक सामग्री:')} {iv.resources.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Reminders', 'स्मरण-सूचनाएँ')}
          hint={pick(
            lang,
            'Sent automatically, once each. Dates follow the demo clock.',
            'अपने आप भेजे जाते हैं, हर एक केवल एक बार। तिथियाँ डेमो घड़ी के अनुसार।',
          )}
        />
        <ol className="divide-y divide-line sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {timeline.map((st) => (
            <li key={st.step} className="px-4 py-3 sm:px-5">
              <p className="label">{pick(lang, STEP_LABEL[st.step].en, STEP_LABEL[st.step].hi)}</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                {st.step === 'reminder'
                  ? pick(lang, `To the owner, on ${ownerChannel}`, `ज़िम्मेदार व्यक्ति को, ${ownerChannel} पर`)
                  : st.step === 'breach'
                    ? pick(lang, `To the owner (${ownerChannel}) and the BEO`, `ज़िम्मेदार व्यक्ति (${ownerChannel}) और BEO को`)
                    : pick(lang, 'To the DEO', 'DEO को')}
              </p>
              <p className={`mt-1 text-sm font-medium ${STEP_TONE[st.state]}`}>
                {st.state === 'sent'
                  ? <>{pick(lang, 'Sent', 'भेजा गया')} <span className="tnum">{fmtDate(st.at, true, lang)}</span></>
                  : st.state === 'planned'
                    ? <>{pick(lang, 'Goes out', 'जाएगा')} <span className="tnum">{fmtDate(st.at, false, lang)}</span></>
                    : st.state === 'pending_run'
                      ? pick(lang, 'Due now: goes out on the next sweep', 'समय हो गया: अगली जाँच में जाएगा')
                      : st.state === 'not_needed'
                        ? pick(lang, 'Not needed: proof came in', 'ज़रूरत नहीं: सबूत आ गया')
                        : pick(lang, 'Not sent', 'नहीं भेजा गया')}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {reassignable ? (
        <Card>
          <CardHead
            title={pick(lang, 'Give this task to someone else', 'यह काम किसी और को सौंपें')}
            hint={pick(
              lang,
              'For when the owner cannot do it: leave, transfer, another duty. The new owner must cover the same school, and the reason stays on the record.',
              'जब ज़िम्मेदार व्यक्ति यह न कर सके: छुट्टी, स्थानांतरण, अन्य ड्यूटी। नया व्यक्ति उसी विद्यालय को देखता हो, और कारण दर्ज रहेगा।',
            )}
          />
          <div className="card-pad">
            {choosable.length === 0 ? (
              <p className="text-sm text-ink-soft">
                {pick(lang, 'Nobody else holds this role for this school', 'इस विद्यालय के लिए यह पद किसी और के पास नहीं है')}
                {reassign!.options.length ? pick(lang, ' without breaking the independent check.', ' जो स्वतंत्र जाँच न तोड़े।') : '.'}
              </p>
            ) : (
              <Disclose label={pick(lang, 'Reassign', 'पुनः सौंपें')}>
                <ActionForm lang={lang}
                  action={reassignTaskAction}
                  hidden={{ task_id: t.id, task_version: String(reassign!.task.version) }}
                  label={pick(lang, 'Reassign the task', 'काम पुनः सौंपें')}
                  confirm={['acknowledged', 'in_progress'].includes(t.status)
                    ? pick(lang, 'The task goes back to "assigned" so the new owner can acknowledge it. Proof already submitted stays with the task.', 'काम फिर "सौंपा गया" होगा ताकि नया व्यक्ति उसे देखे। जमा सबूत बने रहेंगे।')
                    : undefined}
                >
                  <label className="mb-2 block">
                    <span className="label">{pick(lang, 'New owner', 'नया ज़िम्मेदार')} <span className="text-crit">*</span></span>
                    <select name="owner" required className="input mt-1" defaultValue="">
                      <option value="" disabled>{pick(lang, 'Choose a person', 'व्यक्ति चुनें')}</option>
                      {reassign!.options.map((o) => (
                        <option key={o.id} value={o.id} disabled={!!o.blocked}>
                          {o.name} — {o.blocked ? pick(lang, `not allowed: ${o.blocked}`, `अनुमति नहीं: ${o.blocked}`) : o.note}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ReasonBox lang={lang} required label={pick(lang, 'Why it is moving', 'क्यों बदला जा रहा है')} placeholder={pick(lang, 'For example: CRC on medical leave until the 20th.', 'उदाहरण: CRC 20 तारीख तक चिकित्सा अवकाश पर।')} />
                </ActionForm>
              </Disclose>
            )}
          </div>
        </Card>
      ) : reassign?.refusal?.code === 'wrong_status' && reassign.options.length > 0 && t.status !== 'verified' ? (
        <p className="text-sm text-ink-soft">{reassign.refusal.message}</p>
      ) : null}

      {isMine ? (
        <Card>
          <CardHead
            title={pick(lang, 'Your actions', 'आपकी कार्यवाही')}
            hint={pick(lang, 'Only the person this task belongs to can do these.', 'केवल ज़िम्मेदार व्यक्ति ये कर सकता है।')}
          />
          <div className="card-pad flex flex-wrap items-start gap-3">
            {t.status === 'assigned' ? (
              <ActionForm lang={lang} action={acknowledgeTaskAction} hidden={{ task_id: t.id }}
                label={pick(lang, 'Mark as seen', 'देखा गया')} tone="quiet" />
            ) : null}
            {['assigned', 'acknowledged', 'sent_back'].includes(t.status) ? (
              <ActionForm lang={lang} action={startTaskAction} hidden={{ task_id: t.id }}
                label={pick(lang, 'Mark as started', 'शुरू किया')} tone="quiet" />
            ) : null}
            {t.status !== 'verified' && t.status !== 'cancelled' ? (
              <Disclose label={pick(lang, 'Submit proof', 'सबूत जमा करें')}>
                <ActionForm lang={lang}
                  action={submitEvidenceAction}
                  hidden={{ task_id: t.id, school_id: t.school_id ?? '' }}
                  label={pick(lang, 'Submit', 'जमा करें')}
                  confirm={pick(
                    lang,
                    `This task needs ${t.proof_count} piece(s) of proof of type "${pick(lang, EVIDENCE_TYPE_LABEL[t.proof_type]?.en ?? t.proof_type, EVIDENCE_TYPE_LABEL[t.proof_type]?.hi ?? t.proof_type)}". Somebody other than you will check it.`,
                    `इस काम के लिए ${t.proof_count} सबूत चाहिए। कोई और उसे जाँचेगा।`,
                  )}
                >
                  <ReasonBox lang={lang}
                    name="note" required rows={4}
                    label={pick(lang, 'What the proof shows', 'सबूत क्या दिखाता है')}
                    placeholder={pick(lang, 'Describe what was done, where and when.', 'क्या किया, कहाँ और कब — लिखें।')}
                  />
                  <NoteMic field="note" lang={lang} />
                  <LocationField lang={lang} />
                  <p className="text-xs leading-snug text-ink-faint">
                    {pick(
                      lang,
                      'This demo records the proof row an upload would produce, with a hash over what you declared. No file is stored.',
                      'यह डेमो अपलोड जैसी पंक्ति दर्ज करता है, आपके विवरण का हैश सहित। कोई फ़ाइल संग्रहीत नहीं होती।',
                    )}
                  </p>
                </ActionForm>
              </Disclose>
            ) : null}
            {t.status === 'verified' ? (
              <p className="text-sm text-good">
                {pick(lang, 'Verified. Nothing further is needed from you.', 'सत्यापित। आपसे कुछ और आवश्यक नहीं।')}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHead
          title={pick(lang, 'Proof on this task', 'इस काम का सबूत')}
          hint={`${verifiedCount} / ${t.proof_count} ${pick(lang, 'verified', 'सत्यापित')}`}
        />
        {evidence.length === 0 ? (
          <p className="px-4 py-6 text-center text-base text-ink-faint sm:px-5">
            {pick(lang, 'Nothing submitted yet.', 'अभी कुछ जमा नहीं।')}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {evidence.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EvidenceStatusPill status={e.status} lang={lang} />
                      {e.verification_method && e.verification_method !== 'desk_review' ? (
                        <Pill tone="active">{e.verification_method === 'spot_check_visit' ? pick(lang, 'checked on a visit', 'भ्रमण में जाँचा') : e.verification_method === 'cross_source_assessment' ? pick(lang, 'checked by an independent assessment', 'स्वतंत्र आकलन से जाँचा') : e.verification_method.replace(/_/g, ' ')}</Pill>
                      ) : null}
                      <GpsBadge status={e.gps_status} distance={e.gps_distance_m} accuracy={e.gps_accuracy_m} lang={lang} />
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {users.get(e.submitted_by) ?? e.submitted_by} · {fmtDate(e.submitted_at, true, lang)}
                      {e.sha256 ? <> · sha256 <Mono>{shortHash(e.sha256)}</Mono></> : null}
                    </p>
                    <EvidenceSummary id={e.id} summary={e.summary} lang={lang} />
                    {e.rejection_reason ? (
                      <p className="mt-1 border-l-2 border-crit/40 pl-2 text-sm text-crit">{e.rejection_reason}</p>
                    ) : null}
                  </div>
                  {canVerifyHere && e.status === 'pending' && !tooClose.get(e.id) ? (
                    <div className="flex shrink-0 flex-col items-end gap-2 no-print">
                      <ActionForm lang={lang}
                        action={verifyEvidenceAction}
                        hidden={{ evidence_id: e.id, case_id: e.case_id, accept: 'yes', method: t.cross_source ? 'cross_source_assessment' : 'desk_review' }}
                        label={pick(lang, 'Accept', 'स्वीकारें')} tone="good"
                      />
                      <Disclose label={pick(lang, 'Send back', 'लौटाएँ')} tone="danger">
                        <ActionForm lang={lang}
                          action={verifyEvidenceAction}
                          hidden={{ evidence_id: e.id, case_id: e.case_id, accept: 'no' }}
                          label={pick(lang, 'Send back', 'लौटाएँ')} tone="danger"
                        >
                          <ReasonBox lang={lang} required label={pick(lang, 'Why', 'कारण')} />
                        </ActionForm>
                      </Disclose>
                    </div>
                  ) : e.status === 'pending' && tooClose.get(e.id) && (canVerifyHere || tooClose.get(e.id) === 'submitted') ? (
                    <p className="max-w-[14rem] shrink-0 text-right text-xs text-ink-faint">
                      {pick(lang, INVOLVEMENT_MESSAGE[tooClose.get(e.id)!], INVOLVEMENT_HI[tooClose.get(e.id)!])}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(() => {
        const bl = listBlockers(session, { limit: 50 }).filter((b) => b.task_ids.includes(t.id));
        const canReport = t.owner_user_id === session.user_id || grantOf(session, 'task.assign') === 'yes';
        return (
          <Card>
            <CardHead
              title={pick(lang, 'Blockers', 'बाधाएँ')}
              hint={pick(lang, 'What is stopping this task, recorded so the pattern is visible and the right level can act.', 'इस काम को क्या रोक रहा है — ताकि सही स्तर कार्रवाई कर सके।')}
            />
            {bl.length > 0 ? (
              <ul className="divide-y divide-line">
                {bl.map((b) => (
                  <li key={b.id} className="px-4 py-2.5 text-sm sm:px-5">
                    <span className={`chip mr-2 ${b.status === 'resolved' ? 'border-good/30 bg-good-light text-good' : 'border-warn/30 bg-warn-light text-warn'}`}>{b.status === 'resolved' ? pick(lang, 'resolved', 'हल हुई') : b.status === 'escalated' ? pick(lang, 'escalated', 'आगे भेजी') : pick(lang, b.status, 'खुली')}</span>
                    <span className="font-medium text-ink">{pick(lang, blockerMeta(b.blocker_type).label, blockerMeta(b.blocker_type).hi)}</span>
                    <span className="text-ink-soft"> — {b.description}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-3 text-sm text-ink-faint sm:px-5">{pick(lang, 'No blocker reported on this task.', 'कोई बाधा दर्ज नहीं।')}</p>}
            {canReport && !t.submitted_at ? (
              <div className="border-t border-line px-4 py-3 sm:px-5">
                <Disclose label={pick(lang, 'Report a blocker…', 'बाधा दर्ज करें…')}>
                  <ActionForm lang={lang} action={reportBlockerAction} hidden={{ task_id: t.id }} label={pick(lang, 'Record blocker', 'दर्ज करें')}>
                    <div className="mb-2 grid gap-2 sm:grid-cols-2">
                      <label className="block"><span className="label">{pick(lang, 'Type', 'प्रकार')}</span>
                        <select name="type" required className="input mt-1">
                          {BLOCKER_TYPES.map((b) => <option key={b.key} value={b.key}>{pick(lang, b.label, b.hi)}</option>)}
                        </select>
                      </label>
                      <label className="block"><span className="label">{pick(lang, 'Severity', 'गंभीरता')}</span>
                        <select name="severity" defaultValue="medium" className="input mt-1">
                          <option value="high">{pick(lang, 'High — work cannot proceed', 'अधिक — काम रुका है')}</option>
                          <option value="medium">{pick(lang, 'Medium — work is slowed', 'मध्यम — काम धीमा है')}</option>
                          <option value="low">{pick(lang, 'Low — minor', 'कम — मामूली')}</option>
                        </select>
                      </label>
                    </div>
                    <ReasonBox lang={lang} name="description" required label={pick(lang, 'What is happening', 'क्या हो रहा है')} placeholder={pick(lang, 'e.g. Activity cards not delivered to 3 of 5 schools', 'उदा. 5 में से 3 विद्यालयों को कार्ड नहीं मिले')} />
                  </ActionForm>
                </Disclose>
              </div>
            ) : null}
          </Card>
        );
      })()}
    </div>
  );
}
