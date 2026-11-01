import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may, moveRefusal } from '@/lib/guard';
import { caseBundle, caseExists } from '@/lib/cases';
import {
  userNames, schoolNames, placeNames, competency, rounds, clusterTrend, intervention, caseVisits,
  type VisitRow,
} from '@/lib/repo';
import { auditFor } from '@/lib/feed';
import { today } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Callout, Facts, Field, Grid, Stat, Mono, Empty,
  fmtDate, fmtPct, shortHash,
} from '@/components/ui';
import { Pill, StatusPill, SeverityPill, OutcomePill, ProvenanceChip } from '@/components/labels';
import {
  FindingPanel, DiagnosisPanel, PlanPanel, WorkPanel, ProofPanel, OutcomePanel, TimelinePanel,
  type Names,
} from '@/components/case-panels';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import {
  decidePlanAction, transitionAction, setConclusionAction, recomputeOutcomeAction, reviewOutcomeAction,
} from '@/lib/actions';
import { TRANSITIONS, STATUS_LABELS, reasonRequired } from '@domain/lifecycle';
import type { CaseStatus } from '@domain/types';
import { matchForCase } from '@/lib/studio';
import { similarCases, lessonsFrom } from '@/lib/memory';
import { listBlockers } from '@/lib/blockers';
import { LifecycleStepper, SectionNav, RecommendationsCard, SimilarCasesCard, CaseBlockersCard, RailCard } from '@/components/case-workspace';
import { Icon } from '@/components/Icon';
import { STAGES, stageIndex, nextAction } from '@/lib/case-stage';
import { COMPOSABLE } from '@/lib/plans';

/**
 * One case, end to end.
 *
 * The page is laid out as the seven questions in order — what was found, what the data shows,
 * what will be done, who owes what, what proof exists, did it work, and what happened when.
 * Actions appear only where the signed-in role may actually take them; anything else the
 * lifecycle permits is listed but shown as out of this role's hands, so the rule is visible
 * rather than mysterious.
 */

export default async function CasePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const { done } = await searchParams;

  const bundle = caseBundle(session, id);
  if (!bundle) {
    if (caseExists(id)) {
      // Say which it is. Pretending the record does not exist would be a worse answer.
      return (
        <div className="mx-auto max-w-2xl">
          <PageHead title={pick(lang, 'Outside your scope', 'आपके दायरे से बाहर')} />
          <Callout tone="warn" title={`${id}`}>
            {pick(
              lang,
              'This case exists but sits outside the block, cluster or school your role covers, and you do not own any task on it. The server refuses the record rather than hiding that it is there.',
              'यह प्रकरण मौजूद है पर आपके दायरे से बाहर है, और इसका कोई काम आपके पास नहीं है।',
            )}
          </Callout>
          <p className="mt-4"><Link href="/cases" className="link">{pick(lang, 'Back to cases', 'प्रकरणों पर वापस')}</Link></p>
        </div>
      );
    }
    notFound();
  }

  const { case: c, finding, diagnosis, plans, currentPlan, approvals, tasks, evidence, outcomes, timeline } = bundle;
  const places = placeNames();
  const comp = competency(c.competency_id);
  const allSchoolIds = [
    ...c.school_ids,
    ...(finding?.driver_schools.map((d) => d.school_id) ?? []),
    ...tasks.map((t) => t.school_id).filter((x): x is string => !!x),
    ...evidence.map((e) => e.school_id).filter((x): x is string => !!x),
    ...outcomes.flatMap((o) => [...o.treated, ...o.comparison].map((r) => r.school_id)),
    ...(currentPlan?.pre_registration?.comparison_school_ids ?? []),
  ];
  const names: Names = {
    users: userNames([
      c.owner_user_id,
      ...tasks.map((t) => t.owner_user_id),
      ...evidence.flatMap((e) => [e.submitted_by, e.verified_by ?? '']),
      ...approvals.flatMap((a) => [a.submitted_by, a.decided_by ?? '']),
      ...timeline.map((e) => e.actor_user_id ?? ''),
      ...outcomes.map((o) => o.reviewed_by ?? ''),
      diagnosis?.human_conclusion_by ?? '',
    ]),
    schools: schoolNames([...new Set(allSchoolIds)]),
    clusters: places.clusters,
    blocks: places.blocks,
    districts: places.districts,
    competency: pick(lang, comp?.name_en ?? c.competency_id, comp?.name_hi ?? c.competency_id),
    roundLabels: new Map(rounds().map((r) => [r.id, `${r.code} · ${r.label}`])),
  };

  const trend = finding
    ? clusterTrend(session, c.cluster_id, c.district_id, c.grade, c.competency_id)
    : [];
  const iv = currentPlan ? intervention(currentPlan.intervention_id) : null;
  const visits = caseVisits(session, c.id);
  const audit = may(session, 'audit.view') ? auditFor(session, 'case', c.id, 60) : [];

  const legalNext = TRANSITIONS[c.status] ?? [];
  const match = matchForCase(session, c.id);
  const similar = similarCases(session, c.id, 4);
  const lessons = lessonsFrom(similar);
  const blockers = listBlockers(session, { caseId: c.id, limit: 20 });
  const overdueTasks = tasks.filter((t) => !t.submitted_at && t.due_date < today()).length;
  const pendingProof = evidence.filter((e) => e.status === 'pending').length;
  const pendingApproval = approvals.find((a) => a.decision === 'pending');
  const eligibleOutcome = outcomes.find((o) => o.closure_eligible);
  const next = nextAction(c.status);
  const lastDecided = approvals.filter((a) => a.decision !== 'pending' && a.decided_at).sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
  const openBlockers = blockers.filter((b) => !b.resolved_at).length;
  const warnings = [
    ...(overdueTasks ? [pick(lang, `${overdueTasks} task${overdueTasks > 1 ? 's' : ''} past due`, `${overdueTasks} काम विलंबित`)] : []),
    ...(pendingProof ? [pick(lang, `${pendingProof} proof item${pendingProof > 1 ? 's' : ''} awaiting verification`, `${pendingProof} सबूत सत्यापन प्रतीक्षित`)] : []),
    ...(openBlockers ? [pick(lang, `${openBlockers} open blocker${openBlockers > 1 ? 's' : ''}`, `${openBlockers} खुली बाधाएँ`)] : []),
    ...(c.reopen_count ? [pick(lang, `Reopened ${c.reopen_count}× — no learning gain yet`, `${c.reopen_count}× फिर खोला`)] : []),
  ];

  /** Which of the legal next moves this role may actually make, and why not otherwise. The
   *  authority answer is the server's own (moveRefusal), so a button shown here is not refused. */
  function gate(to: CaseStatus): { allowed: boolean; why: string } {
    const refusal = moveRefusal(session, c, to, pendingApproval?.submitted_by ?? null);
    if (refusal) {
      const why = {
        lever: pick(
          lang,
          c.lever === 'block'
            ? 'Only the block officer or the DEO decides a block-lever plan.'
            : 'Only the DEO or the state programme team decides a district or PAB plan.',
          c.lever === 'block' ? 'केवल खंड अधिकारी या DEO निर्णय ले सकते हैं।' : 'केवल DEO या राज्य दल निर्णय ले सकते हैं।',
        ),
        role: pick(lang, refusal.message, 'आपकी भूमिका यह कदम नहीं उठा सकती।'),
        area: pick(lang, refusal.message, 'आपकी भूमिका इस प्रकरण के क्षेत्र पर लागू नहीं होती, इसलिए इस पर अधिकार नहीं देती।'),
        own_submission: pick(
          lang,
          'You submitted this plan, so another officer must approve it. You can still send it back.',
          'यह योजना आपने प्रस्तुत की है, इसलिए स्वीकृति कोई अन्य अधिकारी देगा। आप इसे अभी भी लौटा सकते हैं।',
        ),
      }[refusal.code];
      return { allowed: false, why };
    }
    if (to === 'closed') {
      if (!may(session, 'case.close')) return { allowed: false, why: pick(lang, 'Your role cannot close cases.', 'आपकी भूमिका प्रकरण बंद नहीं कर सकती।') };
      if (!eligibleOutcome) {
        return {
          allowed: false,
          why: pick(
            lang,
            'Closing needs an outcome evaluation that clears every closure rule.',
            'बंद करने के लिए सभी नियम पूरे करने वाली परिणाम जाँच आवश्यक।',
          ),
        };
      }
    }
    if (to === 'reopened' && !may(session, 'case.reopen')) {
      return { allowed: false, why: pick(lang, 'Your role cannot reopen cases.', 'आपकी भूमिका प्रकरण फिर से नहीं खोल सकती।') };
    }
    if (to === 'outcome_pending') {
      const unverified = tasks.filter((t) => !t.verified_at).length;
      if (unverified > 0) {
        return {
          allowed: false,
          why: pick(lang, `${unverified} task(s) still have no verified proof.`, `${unverified} काम का सबूत सत्यापित नहीं।`),
        };
      }
      if (!tasks.some((t) => t.cross_source && t.verified_at)) {
        return { allowed: false, why: pick(lang, 'An independent check is required first.', 'पहले स्वतंत्र जाँच आवश्यक।') };
      }
    }
    if (to === 'dismissed' && !may(session, 'case.edit_diagnosis')) {
      return { allowed: false, why: pick(lang, 'Your role cannot dismiss a finding.', 'आपकी भूमिका निष्कर्ष ख़ारिज नहीं कर सकती।') };
    }
    return { allowed: true, why: '' };
  }

  return (
    <article className="space-y-5">
      <header className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">{c.title}</h1>
            <p className="mt-1.5 text-sm text-ink-soft">
              {pick(lang, 'Class', 'कक्षा')} {c.grade} · {names.competency} ·{' '}
              {names.clusters.get(c.cluster_id) ?? c.cluster_id} {pick(lang, 'cluster', 'संकुल')} ·{' '}
              {names.blocks.get(c.block_id) ?? c.block_id} · {names.districts.get(c.district_id) ?? c.district_id}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} lang={lang} />
            <SeverityPill severity={c.severity} lang={lang} />
            {c.closure_type ? <OutcomePill category={c.closure_type} lang={lang} /> : null}
            <ProvenanceChip provenance="synthetic_demo" lang={lang} />
          </div>
        </div>
        <div className="mt-5"><LifecycleStepper status={c.status} reopenCount={c.reopen_count} /></div>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-t border-line pt-4 text-sm">
          <div><dt className="label">{pick(lang, 'Opened', 'खोला गया')}</dt><dd className="mt-0.5 font-medium text-ink">{fmtDate(c.created_at)} <span className="font-normal text-ink-faint">· {c.origin === 'detected' ? pick(lang, 'detector', 'पहचान-तंत्र') : pick(lang, 'officer', 'अधिकारी')}</span></dd></div>
          <div><dt className="label">{pick(lang, 'Tasks', 'काम')}</dt><dd className="mt-0.5 font-medium text-ink">{tasks.filter((t) => t.status === 'verified').length}/{tasks.length} {pick(lang, 'verified', 'सत्यापित')}{overdueTasks ? <span className="ml-1 text-crit">· {overdueTasks} late</span> : null}</dd></div>
          <div><dt className="label">{pick(lang, 'Proof', 'सबूत')}</dt><dd className="mt-0.5 font-medium text-ink">{evidence.filter((e) => e.status === 'verified').length}/{evidence.length} {pick(lang, 'verified', 'सत्यापित')}{pendingProof ? <span className="ml-1 text-warn">· {pendingProof} pending</span> : null}</dd></div>
        </dl>
      </header>

      <SectionNav items={[
        { id: 'finding', label: pick(lang, 'Finding', 'निष्कर्ष') },
        { id: 'diagnosis', label: pick(lang, 'Diagnosis', 'निदान') },
        { id: 'plan', label: pick(lang, 'Plan', 'योजना'), badge: c.status === 'awaiting_approval' ? '!' : undefined, tone: 'warn' },
        { id: 'work', label: pick(lang, 'Work', 'काम'), badge: overdueTasks ? String(overdueTasks) : undefined, tone: 'crit' },
        { id: 'proof', label: pick(lang, 'Proof', 'सबूत'), badge: pendingProof ? String(pendingProof) : undefined, tone: 'warn' },
        { id: 'outcome', label: pick(lang, 'Outcome', 'परिणाम'), badge: outcomes.length ? String(outcomes.length) : undefined },
        { id: 'history', label: pick(lang, 'History', 'इतिहास') },
      ]} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,68fr)_minmax(320px,32fr)]">
      <div className="min-w-0 space-y-5">

      {done ? (
        <Callout tone="good" title={pick(lang, 'Done', 'पूर्ण')}>
          {done}
        </Callout>
      ) : null}

      {c.reopen_count > 0 ? (
        <Callout tone="warn" title={pick(lang, 'This case has been reopened', 'यह प्रकरण फिर से खोला गया')}>
          {pick(
            lang,
            'The work was delivered and verified, but the next assessment round did not show the gain the plan was built to produce. Reopening is the honest outcome: it says the intervention did not work here, rather than closing on activity.',
            'कार्य हुआ और सत्यापित हुआ, पर अगले आकलन में अपेक्षित सुधार नहीं दिखा। इसलिए प्रकरण फिर खोला गया।',
          )}
        </Callout>
      ) : null}

      <div id="finding" className="scroll-mt-36"><FindingPanel finding={finding} trend={trend} names={names} lang={lang} grade={c.grade} /></div>

      <div id="diagnosis" className="scroll-mt-36"><DiagnosisPanel diagnosis={diagnosis} names={names} lang={lang}>
        {may(session, 'case.edit_diagnosis') ? (
          <div className="mt-3">
            <Disclose label={diagnosis?.human_conclusion
              ? pick(lang, 'Revise your conclusion', 'अपना निष्कर्ष बदलें')
              : pick(lang, 'Write your conclusion', 'अपना निष्कर्ष लिखें')}>
              <ActionForm
                action={setConclusionAction}
                hidden={{ case_id: c.id }}
                label={pick(lang, 'Record conclusion', 'निष्कर्ष दर्ज करें')}
              >
                <ReasonBox
                  name="text"
                  required
                  rows={4}
                  label={pick(lang, 'What you concluded, in your own words', 'आपका निष्कर्ष, अपने शब्दों में')}
                  placeholder={pick(lang, 'What you believe is going on, and what you checked yourself.', 'आपके अनुसार क्या हो रहा है, और आपने स्वयं क्या जाँचा।')}
                />
              </ActionForm>
            </Disclose>
          </div>
        ) : null}
      </DiagnosisPanel></div>

      <div id="plan" className="scroll-mt-36"><PlanPanel
        plans={plans} currentPlan={currentPlan} approvals={approvals}
        intervention={iv} names={names} lang={lang}
      >
        {COMPOSABLE.includes(c.status) && gate('awaiting_approval').allowed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand-light p-3">
            <p className="min-w-0 max-w-xl text-sm text-ink">
              {!currentPlan
                ? pick(lang, 'Choose an intervention and the schools, see how success will be judged, and submit it for approval.', 'हस्तक्षेप और विद्यालय चुनें, सफलता की कसौटी देखें, और स्वीकृति हेतु भेजें।')
                : c.status === 'revision_requested'
                  ? pick(lang, 'The approver sent this plan back. Revise it in the composer and submit it again.', 'स्वीकृतकर्ता ने योजना लौटाई है। संशोधित करके फिर भेजें।')
                  : c.status === 'reopened'
                    ? pick(lang, 'The last plan did not produce the gain. Compose the next attempt.', 'पिछली योजना से सुधार नहीं हुआ। अगला प्रयास बनाएँ।')
                    : currentPlan.drafted_by === 'ai_draft'
                      ? pick(lang, 'This plan is an AI draft. Review it in the composer, change what you need, and make it yours before it goes for approval.', 'यह योजना AI का मसौदा है। इसे जाँचें, बदलें और स्वीकृति से पहले अपनी बनाएँ।')
                      : pick(lang, 'Change the plan in the composer, or submit it as it is from Next moves.', 'योजना बदलें, या अगले कदम से इसे भेजें।')}
            </p>
            <Link href={`/cases/${c.id}/plan`} className="btn-primary shrink-0">
              {currentPlan ? pick(lang, 'Open the plan composer', 'योजना संपादक खोलें') : pick(lang, 'Compose a plan', 'योजना बनाएँ')}
            </Link>
          </div>
        ) : null}
        {c.status === 'awaiting_approval' && currentPlan ? (
          <div className="rounded-md border border-brand/30 bg-brand-light p-3">
            <h3 className="mb-2 text-sm font-semibold text-ink">
              {pick(lang, 'Your decision', 'आपका निर्णय')}
            </h3>
            {!gate('revision_requested').allowed ? (
              <Callout tone="warn">
                {gate('revision_requested').why}
                {pendingApproval ? (
                  <p className="mt-1">
                    {pick(lang, 'Waiting on:', 'प्रतीक्षा:')} {pendingApproval.required_role.toUpperCase()}
                  </p>
                ) : null}
              </Callout>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                {gate('approved').allowed ? (
                  <ActionForm
                    action={decidePlanAction}
                    hidden={{ case_id: c.id, plan_id: currentPlan.id, decision: 'approved' }}
                    label={pick(lang, 'Approve the plan', 'योजना स्वीकृत करें')}
                    tone="good"
                    confirm={pick(
                      lang,
                      'Approving locks the comparison schools and the success threshold. The work can then be assigned.',
                      'स्वीकृति से तुलना विद्यालय और सफलता लक्ष्य तय हो जाते हैं। इसके बाद काम सौंपा जा सकता है।',
                    )}
                  />
                ) : (
                  <p className="basis-full text-sm text-ink-soft">{gate('approved').why}</p>
                )}
                <Disclose label={pick(lang, 'Send back for changes', 'बदलाव के लिए लौटाएँ')}>
                  <ActionForm
                    action={decidePlanAction}
                    hidden={{ case_id: c.id, plan_id: currentPlan.id, decision: 'revision_requested' }}
                    label={pick(lang, 'Send back', 'लौटाएँ')}
                    tone="quiet"
                  >
                    <ReasonBox required label={pick(lang, 'What needs changing', 'क्या बदलना है')} />
                  </ActionForm>
                </Disclose>
                <Disclose label={pick(lang, 'Reject the plan', 'योजना अस्वीकार करें')} tone="danger">
                  <ActionForm
                    action={decidePlanAction}
                    hidden={{ case_id: c.id, plan_id: currentPlan.id, decision: 'rejected' }}
                    label={pick(lang, 'Reject', 'अस्वीकार')}
                    tone="danger"
                  >
                    <ReasonBox required label={pick(lang, 'Why this plan is wrong for this case', 'यह योजना क्यों उपयुक्त नहीं')} />
                  </ActionForm>
                </Disclose>
                {(c.lever !== 'block' || may(session, 'plan.approve_district_or_pab')) && gate('referred_pab').allowed ? (
                  <Disclose label={pick(lang, 'Refer to the PAB', 'PAB को भेजें')}>
                    <ActionForm
                      action={decidePlanAction}
                      hidden={{ case_id: c.id, plan_id: currentPlan.id, decision: 'approved_for_pab' }}
                      label={pick(lang, 'Refer to PAB', 'PAB को भेजें')}
                      tone="quiet"
                    >
                      <ReasonBox label={pick(lang, 'Note for the PAB', 'PAB के लिए टिप्पणी')} />
                    </ActionForm>
                  </Disclose>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </PlanPanel></div>

      <div id="work" className="scroll-mt-36 space-y-3">
        {c.status === 'approved' && tasks.filter((t) => t.plan_id === c.current_plan_id).length === 0 ? (
          gate('assigned').allowed && may(session, 'task.assign') ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand-light p-3">
              <p className="min-w-0 max-w-xl text-sm text-ink">
                {pick(lang, 'The plan is approved. Turn it into tasks: check who owns each one and by when, then assign them.', 'योजना स्वीकृत है। इसे कामों में बदलें: उत्तरदायी और तिथि जाँचें, फिर सौंपें।')}
              </p>
              <Link href={`/cases/${c.id}/assign`} className="btn-primary shrink-0">{pick(lang, 'Review and assign the tasks', 'काम जाँचें और सौंपें')}</Link>
            </div>
          ) : (
            <Callout tone="method">{pick(lang, 'The plan is approved. The block or district officer assigns the tasks next.', 'योजना स्वीकृत है। अगला कदम: खंड या ज़िला अधिकारी काम सौंपेंगे।')}</Callout>
          )
        ) : null}
        <WorkPanel tasks={tasks} names={names} lang={lang} today={today()} />
      </div>

      <div className="scroll-mt-36"><ProofPanel evidence={evidence} names={names} lang={lang}>
        {evidence.some((e) => e.status === 'pending') && may(session, 'evidence.verify') ? (
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <p className="text-sm text-ink-soft">
              {pick(lang, 'Proof waiting to be checked is handled from', 'जाँचने योग्य सबूत यहाँ से देखें')}{' '}
              <Link href="/evidence" className="link">{pick(lang, 'the proof queue', 'सबूत कतार')}</Link>
              {pick(lang, ', where the separation-of-duties rule is applied.', ', जहाँ कर्तव्य-पृथक्करण नियम लागू होता है।')}
            </p>
          </div>
        ) : null}
      </ProofPanel></div>

      <div className="scroll-mt-36"><OutcomePanel outcomes={outcomes} names={names} lang={lang}>
        <div className="mt-3 flex flex-wrap gap-3">
          {may(session, 'outcome.recompute') ? (
            <ActionForm
              action={recomputeOutcomeAction}
              hidden={{ case_id: c.id, evaluation_id: outcomes[0]?.id ?? '' }}
              label={pick(lang, 'Re-derive from the raw rows', 'मूल डेटा से फिर निकालें')}
              tone="quiet"
              confirm={pick(
                lang,
                'Reads the two rounds back out of the assessment table and runs the same function the validator uses, on this evaluation\'s own terms.',
                'आकलन तालिका से दोनों दौर पढ़कर वही गणना दोहराता है जो सत्यापक करता है।',
              )}
            />
          ) : null}
          {outcomes[0] && !outcomes[0].reviewed_by && may(session, 'outcome.recompute') ? (
            <ActionForm
              action={reviewOutcomeAction}
              hidden={{ case_id: c.id, outcome_id: outcomes[0].id }}
              label={pick(lang, 'Sign off as read', 'पढ़ा हुआ दर्ज करें')}
              tone="quiet"
            />
          ) : null}
        </div>
      </OutcomePanel></div>

      {visits.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Visits linked to this case', 'इस प्रकरण से जुड़े भ्रमण')}
            hint={pick(lang, 'Coaching, spot assessments and follow-up visits logged against it.', 'सहयोग, त्वरित आकलन और अनुवर्ती भ्रमण।')}
          />
          <ul className="divide-y divide-line">
            {visits.slice(0, 12).map((v: VisitRow) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
                <span className="tnum w-24 shrink-0 text-sm text-ink-faint">{fmtDate(v.visit_date)}</span>
                <Pill>{v.purpose.replace(/_/g, ' ')}</Pill>
                <Link href={`/schools/${v.school_id}`} className="link text-sm">
                  {names.schools.get(v.school_id) ?? v.school_id}
                </Link>
                <span className="text-sm text-ink-soft">{names.users.get(v.visitor_user_id) ?? v.visitor_role}</span>
                {v.notes ? <span className="basis-full text-sm text-ink-soft">{v.notes}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div id="history" className="scroll-mt-36"><TimelinePanel events={timeline} names={names} lang={lang} /></div>

      {audit.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'Audit trail for this case', 'इस प्रकरण का अंकेक्षण')}
            hint={pick(
              lang,
              'Append-only and hash-chained. Refused attempts are recorded too.',
              'केवल जोड़ने योग्य, हैश-श्रृंखलाबद्ध। अस्वीकृत प्रयास भी दर्ज।',
            )}
            right={<Link href={`/audit?entityType=case&entityId=${c.id}`} className="link text-sm">{pick(lang, 'Open in the audit trail', 'अंकेक्षण में खोलें')}</Link>}
          />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'When', 'कब')}</th>
                  <th scope="col">{pick(lang, 'Who', 'कौन')}</th>
                  <th scope="col">{pick(lang, 'Action', 'कार्य')}</th>
                  <th scope="col">{pick(lang, 'Result', 'परिणाम')}</th>
                  <th scope="col">{pick(lang, 'Hash', 'हैश')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="tnum whitespace-nowrap text-sm">{fmtDate(a.ts, true)}</td>
                    <td className="text-sm">
                      {a.actor_user_id ? (names.users.get(a.actor_user_id) ?? a.actor_label) : a.actor_label}
                      <span className="block text-2xs text-ink-faint">{a.actor_role}</span>
                    </td>
                    <td className="text-sm">
                      <Mono>{a.action}</Mono>
                      {a.reason ? <span className="block text-xs text-ink-soft">{a.reason}</span> : null}
                    </td>
                    <td>
                      {a.result === 'success'
                        ? <Pill tone="good">{pick(lang, 'done', 'हुआ')}</Pill>
                        : <Pill tone="critical">{pick(lang, 'refused', 'अस्वीकृत')}</Pill>}
                    </td>
                    <td><Mono>{shortHash(a.hash)}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      </div>

      <aside className="space-y-5 xl:sticky xl:top-[148px] xl:max-h-[calc(100vh-160px)] xl:self-start xl:overflow-y-auto xl:pb-4">
      {/* ---- at a glance ---- */}
      <section className="card overflow-hidden" aria-label={pick(lang, 'Case summary', 'प्रकरण सारांश')}>
        <div className="border-b border-line bg-paper-sunk/60 px-5 py-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'Next action', 'अगला कदम')}</p>
          <p className="mt-0.5 text-md font-semibold text-ink">{pick(lang, next.en, next.hi)}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{pick(lang, 'Stage', 'चरण')} {stageIndex(c.status) + 1}/7 · {pick(lang, STAGES[stageIndex(c.status)].en, STAGES[stageIndex(c.status)].hi)}</p>
        </div>
        <dl className="divide-y divide-line text-sm">
          <div className="flex items-baseline justify-between gap-3 px-5 py-2.5"><dt className="text-ink-faint">{pick(lang, 'Owner', 'उत्तरदायी')}</dt><dd className="text-right font-medium text-ink">{names.users.get(c.owner_user_id) ?? c.owner_user_id}</dd></div>
          <div className="flex items-baseline justify-between gap-3 px-5 py-2.5"><dt className="text-ink-faint">{pick(lang, 'Deadline', 'समय-सीमा')}</dt><dd className={`tnum text-right font-medium ${c.due_date && c.due_date < today() && !c.closed_at ? 'text-crit' : 'text-ink'}`}>{fmtDate(c.due_date)}{c.due_date && c.due_date < today() && !c.closed_at ? <span className="block text-xs font-normal">{pick(lang, 'past due', 'समय-सीमा पार')}</span> : null}</dd></div>
          <div className="flex items-baseline justify-between gap-3 px-5 py-2.5"><dt className="text-ink-faint">{pick(lang, 'Approval', 'स्वीकृति')}</dt><dd className="text-right font-medium text-ink">{
            pendingApproval ? <>{pick(lang, 'Waiting on', 'प्रतीक्षा')} {pendingApproval.required_role.toUpperCase()}<span className="block text-xs font-normal text-ink-faint">{pick(lang, 'since', 'से')} {fmtDate(pendingApproval.submitted_at)}</span></>
            : lastDecided ? <>{lastDecided.decision.replace(/_/g, ' ')}<span className="block text-xs font-normal text-ink-faint">{names.users.get(lastDecided.decided_by ?? '') ?? lastDecided.decided_by} · {fmtDate(lastDecided.decided_at)}</span></>
            : <span className="font-normal text-ink-faint">{pick(lang, 'No plan submitted yet', 'अभी योजना नहीं भेजी')}</span>
          }</dd></div>
          <div className="flex items-baseline justify-between gap-3 px-5 py-2.5"><dt className="text-ink-faint">{pick(lang, 'Authority', 'अधिकार')}</dt><dd className="text-right font-medium text-ink">{c.lever === 'block' ? pick(lang, 'Block · BEO/DEO', 'खंड') : c.lever === 'district' ? pick(lang, 'District · DEO/State', 'ज़िला') : 'PAB · DEO/State'}</dd></div>
        </dl>
        {warnings.length ? (
          <ul className="space-y-1.5 border-t border-line px-5 py-3">
            {warnings.map((w) => <li key={w} className="flex items-start gap-1.5 text-sm text-crit"><Icon name="alert" size={13} className="mt-0.5 shrink-0" />{w}</li>)}
          </ul>
        ) : null}
      </section>

      {/* ---- what can happen next ---- */}
      <Card>
        <CardHead
          title={pick(lang, 'Next moves', 'अगले कदम')}
          hint={pick(
            lang,
            'The only moves the lifecycle allows from here. Anything not listed is refused by the server, not merely hidden.',
            'यहाँ से केवल ये कदम संभव हैं। अन्य कुछ सर्वर द्वारा अस्वीकृत है।',
          )}
        />
        {legalNext.length === 0 ? (
          <Empty>{pick(lang, 'This case is in a final state.', 'यह प्रकरण अंतिम स्थिति में है।')}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {legalNext.map((to) => {
              const g = gate(to);
              const needsReason = reasonRequired(c.status, to);
              const label = pick(lang, STATUS_LABELS[to].en, STATUS_LABELS[to].hi);
              // Plan decisions have their own buttons above, with the reasons they need.
              if (c.status === 'awaiting_approval' && ['approved', 'revision_requested', 'under_investigation', 'referred_pab'].includes(to)) {
                return (
                  <li key={to} className="px-4 py-2.5 text-sm text-ink-soft sm:px-5">
                    <Pill tone={STATUS_LABELS[to].tone}>{label}</Pill>
                    <span className="ml-2">{pick(lang, 'decided in the plan section above', 'ऊपर योजना अनुभाग में')}</span>
                  </li>
                );
              }
              return (
                <li key={to} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Pill tone={STATUS_LABELS[to].tone}>{label}</Pill>
                      <Mono> {to}</Mono>
                      {needsReason ? (
                        <span className="ml-2 text-xs text-warn">{pick(lang, 'needs a written reason', 'लिखित कारण आवश्यक')}</span>
                      ) : null}
                      {!g.allowed ? <p className="mt-1 text-sm text-ink-soft">{g.why}</p> : null}
                    </div>
                    {g.allowed && to === 'assigned' ? (
                      // Work is assigned by turning the plan into tasks, never by moving the status alone.
                      <Link href={`/cases/${c.id}/assign`} className="btn-quiet">{pick(lang, 'Review and assign the tasks', 'काम जाँचें और सौंपें')}</Link>
                    ) : g.allowed ? (
                      needsReason ? (
                        <Disclose label={label} tone={to === 'dismissed' || to === 'reopened' ? 'danger' : 'quiet'}>
                          <ActionForm
                            action={transitionAction}
                            hidden={{ case_id: c.id, to }}
                            label={pick(lang, 'Confirm', 'पुष्टि करें')}
                            tone={to === 'dismissed' ? 'danger' : 'primary'}
                          >
                            <ReasonBox required label={pick(lang, 'Reason', 'कारण')} />
                          </ActionForm>
                        </Disclose>
                      ) : (
                        <ActionForm
                          action={transitionAction}
                          hidden={{ case_id: c.id, to }}
                          label={label}
                          tone={to === 'closed' ? 'good' : 'quiet'}
                        />
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>


        <RailCard title={pick(lang, 'Ask about this case', 'इस प्रकरण के बारे में पूछें')} icon="sparkles">
          <div className="space-y-2 p-4 text-sm text-ink-soft">
            <p>{pick(lang, 'Karyavahi AI can explain the finding, what blocks closure, or how similar cases went — citing the records.', 'AI निष्कर्ष, बंद होने की बाधाएँ या समान प्रकरण समझा सकता है।')}</p>
            <p className="text-xs text-ink-faint">{pick(lang, 'Use “Ask AI” in the header — it already knows you are on', 'हेडर में “Ask AI” उपयोग करें —')} {c.id}.</p>
          </div>
        </RailCard>
        {match ? <RecommendationsCard caseId={c.id} matches={match.matches} /> : null}
        <SimilarCasesCard cases={similar} lessons={lessons} />
        <CaseBlockersCard blockers={blockers} />
      </aside>
      </div>
    </article>
  );
}
