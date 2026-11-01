import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { caseExists } from '@/lib/cases';
import { composerView, previewPlan, fillTemplate } from '@/lib/plans';
import { authorityFor } from '@/lib/studio';
import { schoolNames, competency } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { composePlanAction } from '@/lib/actions';
import { Card, CardHead, PageHead, Callout, Facts, Field, Mono, fmtInr, fmtPct } from '@/components/ui';
import { Pill, StatusPill, RoleName, EvidenceTypeName, CrossSourcePill } from '@/components/labels';
import { ReasonBox } from '@/components/ActionForm';
import { ComposeForm } from '@/components/plan-composer';
import { ROUNDS } from '@domain/catalog';
import { CostSource, costNote, unitLabel } from '@/components/cost';

/**
 * The Plan Composer: choose an intervention from the ranked matches, choose the schools, see
 * exactly what the plan will say — the comparison schools and the bar the outcome check will
 * hold it to — and save it, or save and submit it for approval.
 *
 * The first two steps are an ordinary GET form, so the preview is a page the server renders from
 * the URL: nothing is saved until the officer presses a save button, and the same functions that
 * draw the preview compute what is stored.
 */

const asList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(',')).filter(Boolean);

export default async function ComposePlanPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ iv?: string; s?: string | string[] }>;
}) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const sp = await searchParams;

  const view = composerView(session, id);
  if (!view) {
    if (caseExists(id)) {
      return (
        <div className="mx-auto max-w-2xl">
          <PageHead title={pick(lang, 'Outside your scope', 'आपके दायरे से बाहर')} />
          <Callout tone="warn" title={id}>
            {pick(lang, 'This case sits outside the area your role covers, so you cannot plan for it.', 'यह प्रकरण आपके क्षेत्र से बाहर है, इसलिए आप इसकी योजना नहीं बना सकते।')}
          </Callout>
        </div>
      );
    }
    notFound();
  }

  const c = view.case;
  const back = (
    <Link href={`/cases/${c.id}#plan`} className="link text-sm">
      ← {pick(lang, 'Back to', 'वापस')} {c.id}
    </Link>
  );
  const head = (
    <PageHead
      breadcrumb={back}
      title={pick(lang, 'Compose a plan', 'योजना बनाएँ')}
      sub={<>{c.id} · {c.title}</>}
      meta={<><StatusPill status={c.status} lang={lang} /><span>{pick(lang, 'Class', 'कक्षा')} {c.grade} · {pick(lang, competency(c.competency_id)?.name_en ?? c.competency_id, competency(c.competency_id)?.name_hi ?? c.competency_id)}</span></>}
      right={<span className="hidden lg:inline">{back}</span>}
    />
  );

  if (view.refusal) {
    return (
      <div className="mx-auto max-w-3xl">
        {head}
        <Callout tone="warn" title={pick(lang, 'You cannot compose a plan for this case', 'आप इस प्रकरण की योजना नहीं बना सकते')}>
          {view.refusal.message}
        </Callout>
      </div>
    );
  }

  const eligible = view.matches.filter((m) => m.eligible);
  const excluded = view.matches.filter((m) => !m.eligible);
  const startIv = view.current && eligible.some((m) => m.intervention.id === view.current!.intervention_id)
    ? view.current.intervention_id
    : eligible[0]?.intervention.id;
  const ivId = sp.iv ?? startIv;
  const chosen = sp.s !== undefined
    ? asList(sp.s)
    : view.current?.school_ids.length ? view.current.school_ids : view.schools.map((x) => x.id);
  const previewing = sp.iv !== undefined;
  const chosenMatch = view.matches.find((m) => m.intervention.id === ivId);
  const preview = previewing && ivId ? previewPlan(c, view.matches, ivId, chosen) : null;
  const comparisonNames = schoolNames(preview?.preRegistration?.comparison_school_ids ?? []);
  const roundLabel = (rid: string) => {
    const r = ROUNDS.find((x) => x.id === rid);
    return r ? `${r.code} · ${r.label}` : rid;
  };
  const approver = chosenMatch ? authorityFor(session, chosenMatch.intervention.lever) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {head}

      {view.current ? (
        <Callout tone="method">
          {view.current.drafted_by === 'ai_draft'
            ? pick(lang, `The current plan (${view.current.intervention_id}) is an AI draft. It is the starting point below; change anything, and the plan you save is yours.`, `वर्तमान योजना (${view.current.intervention_id}) AI का मसौदा है। नीचे से शुरू करें; आप जो सहेजेंगे वह आपकी योजना होगी।`)
            : pick(lang, `The current plan (${view.current.intervention_id}, ${view.current.status.replace(/_/g, ' ')}) is the starting point below. Saving creates a new version; the old one stays in the history.`, `वर्तमान योजना (${view.current.intervention_id}) नीचे शुरुआती बिंदु है। सहेजने पर नया संस्करण बनेगा।`)}
        </Callout>
      ) : null}

      {/* ---- steps 1 and 2: a GET form, so the preview is just this page with a query ---- */}
      <form method="get" action={`/cases/${c.id}/plan#preview`} className="space-y-5">
        {/* Always sent, so that unticking every school previews as "no schools" rather than
            falling back to the current plan's list. */}
        <input type="hidden" name="s" value="" />
        <Card>
          <CardHead
            title={pick(lang, '1 · Choose the intervention', '1 · हस्तक्षेप चुनें')}
            hint={pick(lang, 'Ranked by fit to this case. Every point is listed with the rule that gave it. Points are not a predicted effect.', 'इस प्रकरण से मेल के क्रम में। हर अंक का नियम दिखाया गया है। अंक अनुमानित प्रभाव नहीं हैं।')}
          />
          {eligible.length === 0 ? (
            <div className="card-pad"><Callout tone="warn">{pick(lang, 'No intervention in the library fits this class and competency.', 'पुस्तकालय में कोई हस्तक्षेप इस कक्षा और दक्षता के लिए उपयुक्त नहीं।')}</Callout></div>
          ) : (
            <fieldset>
              <legend className="sr-only">{pick(lang, 'Intervention', 'हस्तक्षेप')}</legend>
              <ul className="divide-y divide-line">
                {eligible.map((m, i) => {
                  const iv = m.intervention;
                  return (
                    <li key={iv.id}>
                      <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 hover:bg-paper-sunk/60 has-[:checked]:bg-brand-light/50 sm:px-5">
                        <input type="radio" name="iv" value={iv.id} defaultChecked={iv.id === ivId} className="mt-1 accent-brand" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-ink-faint">{iv.id}</span>
                            <span className="font-medium text-ink">{iv.name}</span>
                            {i === 0 ? <Pill tone="active">{pick(lang, 'best fit', 'सर्वोत्तम मेल')}</Pill> : null}
                            {m.isCurrentPlan ? <Pill tone="pending">{pick(lang, 'current plan', 'वर्तमान योजना')}</Pill> : null}
                            <span className="tnum ml-auto rounded-md bg-navy-100 px-1.5 py-0.5 text-2xs font-semibold text-navy-700">{m.points} {pick(lang, 'pts', 'अंक')}</span>
                          </span>
                          <span className="mt-1 block text-sm text-ink-soft">
                            {iv.duration_weeks > 0 ? `${iv.duration_weeks} ${pick(lang, 'weeks', 'सप्ताह')}` : pick(lang, 'PAB proposal', 'PAB प्रस्ताव')}
                            {' · '}{fmtInr(iv.cost_basis.amount_inr)} {unitLabel(iv.cost_basis.unit, lang)}
                            {' · '}{pick(lang, 'approved by', 'स्वीकृति')} {m.authority.who}
                          </span>
                          <span className="mt-1.5 block space-y-0.5 text-sm text-ink-soft">
                            {m.reasons.map((r) => <span key={r.text} className="block"><span className="tnum text-ink-faint">+{r.points}</span> {r.text}</span>)}
                            {m.risks.map((r) => <span key={r.text} className={`block ${r.level === 'crit' ? 'text-crit' : 'text-warn'}`}>{pick(lang, 'Risk:', 'जोखिम:')} {r.text}</span>)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          {excluded.length > 0 ? (
            <details className="border-t border-line px-4 py-3 text-sm sm:px-5">
              <summary className="cursor-pointer text-ink-soft">
                {pick(lang, `${excluded.length} interventions do not fit this case, and why`, `${excluded.length} हस्तक्षेप उपयुक्त नहीं, और क्यों`)}
              </summary>
              <ul className="mt-2 space-y-1 text-ink-soft">
                {excluded.map((m) => <li key={m.intervention.id}><Mono>{m.intervention.id}</Mono> {m.intervention.name} — {m.excludedBecause}</li>)}
              </ul>
            </details>
          ) : null}
        </Card>

        <Card>
          <CardHead
            title={pick(lang, '2 · Choose the schools', '2 · विद्यालय चुनें')}
            hint={pick(lang, 'The schools that drove the drop, largest share first. Leave out a school only for a reason you can state.', 'गिरावट वाले विद्यालय, सबसे बड़े हिस्से वाले पहले। किसी विद्यालय को केवल स्पष्ट कारण से हटाएँ।')}
          />
          <fieldset>
            <legend className="sr-only">{pick(lang, 'Schools', 'विद्यालय')}</legend>
            <ul className="divide-y divide-line">
              {view.schools.map((sc) => (
                <li key={sc.id}>
                  <label className="flex cursor-pointer items-baseline gap-3 px-4 py-2.5 hover:bg-paper-sunk/60 sm:px-5">
                    <input type="checkbox" name="s" value={sc.id} defaultChecked={chosen.includes(sc.id)} className="accent-brand" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium text-ink">{sc.name}</span> <Mono>{sc.id}</Mono>
                    </span>
                    {sc.driver ? (
                      <span className="tnum shrink-0 text-sm text-ink-soft">
                        <span className="text-crit">{sc.change_pp! > 0 ? '+' : ''}{sc.change_pp!.toFixed(1)} pp</span>
                        {' · '}{fmtPct((sc.share ?? 0) * 100, 0)} {pick(lang, 'of the drop', 'गिरावट का')}
                      </span>
                    ) : <span className="shrink-0 text-sm text-ink-faint">{pick(lang, 'on the case', 'प्रकरण में')}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <button type="submit" className={previewing ? 'btn-quiet' : 'btn-primary'}>
              {previewing ? pick(lang, 'Update the preview', 'पूर्वावलोकन अद्यतन करें') : pick(lang, 'Preview the plan', 'योजना का पूर्वावलोकन')}
            </button>
          </div>
        </Card>
      </form>

      {/* ---- step 3: what will be stored, then save ---- */}
      {previewing ? (
        <div id="preview" className="scroll-mt-24"><Card>
          <CardHead
            title={pick(lang, '3 · Check it, then save', '3 · जाँचें, फिर सहेजें')}
            hint={pick(lang, 'This is exactly what the plan will say. Nothing is saved until you press a save button.', 'योजना ठीक यही कहेगी। सहेजें दबाने तक कुछ नहीं सहेजा जाता।')}
          />
          <div className="card-pad space-y-5">
            {!chosenMatch ? (
              <Callout tone="warn">{pick(lang, 'Choose an intervention above.', 'ऊपर हस्तक्षेप चुनें।')}</Callout>
            ) : !chosenMatch.eligible ? (
              <Callout tone="warn">{chosenMatch.intervention.name}: {chosenMatch.excludedBecause}</Callout>
            ) : !preview || preview.schoolIds.length === 0 ? (
              <Callout tone="warn">{pick(lang, 'Choose at least one school above.', 'ऊपर कम से कम एक विद्यालय चुनें।')}</Callout>
            ) : (
              <>
                <Facts cols={4}>
                  <Field label={pick(lang, 'Intervention', 'हस्तक्षेप')}>
                    <Link href={`/interventions/${chosenMatch.intervention.id}?case=${c.id}`} className="link font-medium">{chosenMatch.intervention.name}</Link>
                  </Field>
                  <Field label={pick(lang, 'Schools', 'विद्यालय')}>{preview.schoolIds.length}</Field>
                  <Field label={pick(lang, 'Estimated cost', 'अनुमानित लागत')} hint={costNote(chosenMatch.intervention.cost_basis, lang)}>
                    <span className="tnum">{fmtInr(preview.estimatedCost)}</span> <CostSource cost={chosenMatch.intervention.cost_basis} lang={lang} />
                  </Field>
                  <Field label={pick(lang, 'Approved by', 'स्वीकृति')}>
                    {approver?.who}
                    {chosenMatch.intervention.lever !== c.lever ? (
                      <span className="block text-xs text-warn">{pick(lang, `Changes this case's lever from ${c.lever} to ${chosenMatch.intervention.lever}`, `प्रकरण का स्तर ${c.lever} से ${chosenMatch.intervention.lever} होगा`)}</span>
                    ) : null}
                  </Field>
                </Facts>

                {preview.preRegistration ? (
                  <div className="rounded-md border border-brand/25 bg-brand-light p-3">
                    <h3 className="mb-1 text-sm font-semibold text-ink">{pick(lang, 'How success will be judged', 'सफलता कैसे आँकी जाएगी')}</h3>
                    <p className="mb-2 text-sm leading-relaxed text-ink-soft">
                      {pick(
                        lang,
                        'These terms are fixed now and locked when the plan is approved, so they cannot be chosen later to suit the result. The comparison schools are the closest matches on the baseline result, from other clusters in the district, that are not in another open case.',
                        'ये शर्तें अभी तय होती हैं और स्वीकृति पर बंद हो जाती हैं, ताकि बाद में परिणाम के अनुसार न चुनी जा सकें। तुलना विद्यालय ज़िले के अन्य संकुलों से, आधार परिणाम में सबसे निकट, चुने गए हैं।',
                      )}
                    </p>
                    <Facts cols={3}>
                      <Field label={pick(lang, 'Compare', 'तुलना')}>{roundLabel(preview.preRegistration.baseline_round_id)} → {roundLabel(preview.preRegistration.followup_round_id)}</Field>
                      <Field label={pick(lang, 'Must gain at least', 'न्यूनतम सुधार')}><span className="tnum">+{preview.preRegistration.success_threshold_pp} pp</span> <span className="text-xs text-ink-faint">{pick(lang, 'more than the comparison schools', 'तुलना विद्यालयों से अधिक')}</span></Field>
                      <Field label={pick(lang, 'Participation floor', 'भागीदारी न्यूनतम')}><span className="tnum">{Math.round(preview.preRegistration.participation_floor_ratio * 100)}%</span> · <Mono>{preview.preRegistration.settings_version_id}</Mono></Field>
                    </Facts>
                    <p className="mt-2 text-sm text-ink-soft">
                      <span className="font-medium text-ink">{preview.preRegistration.comparison_school_ids.length} {pick(lang, 'comparison schools:', 'तुलना विद्यालय:')}</span>{' '}
                      {preview.preRegistration.comparison_school_ids.map((sid) => comparisonNames.get(sid) ?? sid).join(', ') || pick(lang, 'none could be found', 'कोई नहीं मिला')}
                    </p>
                  </div>
                ) : (
                  <Callout tone="warn">{pick(lang, 'No later assessment round is scheduled, so there is nothing to check this plan against yet.', 'कोई अगला आकलन दौर निर्धारित नहीं है।')}</Callout>
                )}

                <div>
                  <h3 className="h-section mb-2">{pick(lang, 'The work it will turn into, once approved', 'स्वीकृति के बाद बनने वाले काम')}</h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {preview.tasks.map(({ template: t, count }) => (
                      <li key={t.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="tnum w-8 shrink-0 font-semibold text-ink">{count}×</span>
                        <span className="min-w-0 flex-1 text-ink">{fillTemplate(c, pick(lang, t.title_en, t.title_hi))}</span>
                        <span className="text-ink-soft"><RoleName role={t.owner_role} lang={lang} /> · {t.duration_days} {pick(lang, 'days', 'दिन')} · <EvidenceTypeName type={t.proof_type} lang={lang} />{t.proof_count > 1 ? ` ×${t.proof_count}` : ''}</span>
                        {t.cross_source ? <CrossSourcePill lang={lang} /> : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <ComposeForm
                  action={composePlanAction}
                  hidden={{
                    case_id: c.id, intervention_id: chosenMatch.intervention.id,
                    school_ids: preview.schoolIds.join(','), case_version: String(c.version),
                  }}
                  submitLabel={pick(lang, 'Save and submit for approval', 'सहेजें और स्वीकृति हेतु भेजें')}
                  draftLabel={pick(lang, 'Save as a draft', 'मसौदे के रूप में सहेजें')}
                  pendingLabel={pick(lang, 'Saving…', 'सहेजा जा रहा है…')}
                >
                  <ReasonBox
                    name="rationale" required rows={3}
                    label={pick(lang, 'Why this plan fits this case', 'यह योजना इस प्रकरण के लिए क्यों उपयुक्त है')}
                    placeholder={pick(lang, 'What you saw in the diagnosis or on a visit that makes this the right choice.', 'निदान या भ्रमण में आपने क्या देखा जिससे यह सही विकल्प है।')}
                  />
                  <p className="mb-3 text-sm text-ink-soft">
                    {pick(lang, 'Submitting sends it to', 'भेजने पर यह जाएगी')} {approver?.who}. {pick(lang, 'Someone other than you has to approve it.', 'स्वीकृति आपके अलावा कोई और देगा।')}
                  </p>
                </ComposeForm>
              </>
            )}
          </div>
        </Card></div>
      ) : null}
    </div>
  );
}
