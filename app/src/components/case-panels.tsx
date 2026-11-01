import Link from 'next/link';
import type { Language } from '@domain/types';
import type {
  Case, Finding, Diagnosis, CasePlan, Approval, Task, Evidence, OutcomeEvaluation, CaseEvent,
} from '@/lib/cases';
import type { TrendPoint } from '@/lib/repo';
import { OUTCOME_NOTE } from '@domain/outcome';
import { pick, FACTOR_LABEL } from '@/lib/i18n';
import { GpsBadge } from './GpsBadge';
import {
  Card, CardHead, Callout, Facts, Field, Empty, Mono, Delta, Bar,
  fmtPct, fmtDate, fmtInr, fmtInt, shortHash,
} from './ui';
import {
  Pill, StatusPill, SeverityPill, OutcomePill, TaskStatusPill, EvidenceStatusPill,
  AiDrafted, OfficerWritten, Illustrative, Association, CrossSourcePill, OverduePill,
  EscalatedPill, EvidenceTypeName, FactorName, RoleName, EvidenceStrength,
} from './labels';
import { CostSource, costNote, type CostBasisLike } from './cost';
import { OutcomeCalibrationNote } from './CalibrationNote';
import { TrendChart, DivergingBars, EffectInterval, SlopeChart } from './charts';
import { SERIES } from '@/lib/viz';
import { EvidenceSummary } from './EvidenceSummary';

/** The anatomy of a case, one panel per question an officer actually asks. */

export interface Names {
  users: Map<string, string>;
  schools: Map<string, string>;
  clusters: Map<string, string>;
  blocks: Map<string, string>;
  districts: Map<string, string>;
  competency: string;
  roundLabels: Map<string, string>;
}

const nm = (m: Map<string, string>, id: string | null | undefined, fallback = '—') =>
  !id ? fallback : (m.get(id) ?? id);

// ================================================================== 1. the finding
export function FindingPanel({
  finding, trend, names, lang, grade,
}: { finding: Finding | null; trend: TrendPoint[]; names: Names; lang: Language; grade: number }) {
  if (!finding) {
    return (
      <Card>
        <CardHead
          title={pick(lang, '1 · The finding', '1 · निष्कर्ष')}
          hint={pick(lang, 'This case was opened by hand, not by the detector.', 'यह प्रकरण स्वयं खोला गया, पहचान-तंत्र द्वारा नहीं।')}
        />
        <div className="card-pad">
          <Callout tone="method">
            {pick(
              lang,
              'Opened from a field concern rather than from an assessment comparison, so there is no detection record. The diagnosis below is still built from the context tables.',
              'आकलन तुलना के बजाय क्षेत्रीय चिंता से खोला गया, अतः पहचान रिकॉर्ड नहीं है।',
            )}
          </Callout>
        </div>
      </Card>
    );
  }

  const dq = finding.dq_checks;
  const currIdx = trend.findIndex((t) => t.round_id === finding.round_id);
  const series = [
    {
      key: 'cluster', label: pick(lang, 'This cluster', 'यह संकुल'), color: SERIES.one,
      points: trend.map((t) => t.cluster_pct),
    },
    {
      key: 'district', label: pick(lang, 'District', 'ज़िला'), color: SERIES.two,
      points: trend.map((t) => t.district_pct),
    },
  ];

  return (
    <Card>
      <CardHead
        title={pick(lang, '1 · The finding', '1 · निष्कर्ष')}
        hint={pick(
          lang,
          'What the assessment rounds show, and whether it clears the thresholds that open a case.',
          'आकलन दौर क्या दिखाते हैं, और क्या यह सीमाएँ पार करता है।',
        )}
        right={<SeverityPill severity={finding.severity} lang={lang} />}
      />

      <div className="card-pad space-y-4">
        <Facts cols={4}>
          <Field label={pick(lang, 'Previous round', 'पिछला दौर')}>
            <span className="tnum">{fmtPct(finding.prev_value_pct)}</span>
            <span className="ml-1 text-xs text-ink-faint">{nm(names.roundLabels, finding.prev_round_id)}</span>
          </Field>
          <Field label={pick(lang, 'This round', 'यह दौर')}>
            <span className="tnum font-semibold">{fmtPct(finding.curr_value_pct)}</span>
            <span className="ml-1 text-xs text-ink-faint">{nm(names.roundLabels, finding.round_id)}</span>
          </Field>
          <Field label={pick(lang, 'Change', 'बदलाव')}>
            <Delta pp={finding.change_pp} />
          </Field>
          <Field
            label={pick(lang, 'Beyond the district', 'ज़िले से अधिक')}
            hint={pick(lang, `District moved ${finding.district_change_pp > 0 ? '+' : ''}${finding.district_change_pp} pp`, `ज़िला ${finding.district_change_pp} pp`)}
          >
            <Delta pp={finding.relative_change_pp} />
          </Field>
        </Facts>

        <Callout tone="method" title={pick(lang, 'How this was measured', 'माप की विधि')}>
          {pick(
            lang,
            `Class ${grade} ${names.competency}, students at the grade benchmark. The cluster's change is compared with the whole district's change over the same two rounds, which removes seasonal and state-wide shifts. A case opens only when the gap is at least ${finding.thresholds.materiality_pp} pp and a two-proportion z-test reaches −${finding.thresholds.z_threshold}. Here z = ${finding.z_score}, on ${fmtInt(finding.n_prev)} students then and ${fmtInt(finding.n_curr)} now.`,
            `कक्षा ${grade} ${names.competency}। संकुल का बदलाव उसी दो दौरों में पूरे ज़िले के बदलाव से तुलना किया गया। प्रकरण तभी खुलता है जब अंतर कम से कम ${finding.thresholds.materiality_pp} pp हो और z-परीक्षण −${finding.thresholds.z_threshold} तक पहुँचे। यहाँ z = ${finding.z_score}।`,
          )}
        </Callout>

        <div>
          <h3 className="h-section mb-2">
            {pick(lang, 'Cluster against district, every round', 'हर दौर में संकुल और ज़िला')}
          </h3>
          <TrendChart
            xLabels={trend.map((t) => t.code)}
            series={series}
            caption={`Class ${grade} ${names.competency}: percentage of assessed students at the grade benchmark, this cluster compared with the district, across ${trend.length} assessment rounds.`}
            markers={currIdx > 0 ? [{ at: currIdx, label: pick(lang, 'this finding', 'यह निष्कर्ष') }] : []}
          />
        </div>

        {finding.driver_schools.length > 0 ? (
          <div>
            <h3 className="h-section mb-1">
              {pick(lang, 'Which schools account for the drop', 'गिरावट के लिए कौन से विद्यालय')}
            </h3>
            <p className="mb-2 text-sm leading-snug text-ink-soft">
              {pick(
                lang,
                `Each school's share of the cluster's excess drop, weighted by students assessed. These ${finding.driver_schools.length} cover ${Math.round(finding.driver_schools.reduce((t, d) => t + d.contribution_share, 0) * 100)}% of it, and they are the schools the plan acts on.`,
                `प्रत्येक विद्यालय का योगदान, आकलित छात्रों के अनुसार। ये ${finding.driver_schools.length} विद्यालय गिरावट का ${Math.round(finding.driver_schools.reduce((t, d) => t + d.contribution_share, 0) * 100)}% हैं।`,
              )}
            </p>
            <DivergingBars
              caption="Change in percentage points for each driver school between the two rounds."
              data={finding.driver_schools.map((d) => ({
                key: d.school_id,
                label: nm(names.schools, d.school_id),
                value: d.change_pp,
                note: `${fmtPct(d.prev_pct)} → ${fmtPct(d.curr_pct)} · ${Math.round(d.contribution_share * 100)}%`,
              }))}
            />
            <ul className="mt-2 flex flex-wrap gap-2">
              {finding.driver_schools.map((d) => (
                <li key={d.school_id}>
                  <Link href={`/schools/${d.school_id}`} className="chip border-line-strong bg-paper-sunk text-ink-soft hover:bg-paper-deep">
                    {nm(names.schools, d.school_id)} <Mono>{d.school_id}</Mono>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="h-section mb-2">
            {pick(lang, 'Data-quality gates', 'डेटा गुणवत्ता जाँच')}
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{pick(lang, 'Check', 'जाँच')}</th>
                <th scope="col">{pick(lang, 'Value', 'मान')}</th>
                <th scope="col">{pick(lang, 'Needs', 'आवश्यक')}</th>
                <th scope="col">{pick(lang, 'Result', 'परिणाम')}</th>
              </tr>
            </thead>
            <tbody>
              {dq.map((c) => (
                <tr key={c.check}>
                  <td>{c.check.replace(/_/g, ' ')}</td>
                  <td className="tnum">{c.value}</td>
                  <td className="tnum text-ink-soft">≥ {c.threshold}</td>
                  <td>
                    {c.passed
                      ? <Pill tone="good">{pick(lang, 'Passed', 'उत्तीर्ण')}</Pill>
                      : <Pill tone="critical">{pick(lang, 'Failed', 'अनुत्तीर्ण')}</Pill>}
                  </td>
                </tr>
              ))}
              <tr>
                <td>{pick(lang, 'schools reporting', 'रिपोर्ट करने वाले विद्यालय')}</td>
                <td className="tnum">{finding.schools_reporting} / {finding.schools_total}</td>
                <td className="tnum text-ink-soft">—</td>
                <td><Mono>{Math.round((finding.schools_reporting / finding.schools_total) * 100)}%</Mono></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-faint">
            <Mono>{finding.id}</Mono> · {finding.detection_method} ·{' '}
            {pick(lang, 'settings', 'सेटिंग')} <Mono>{finding.settings_version_id}</Mono> ·{' '}
            {pick(lang, 'detected', 'पहचान')} {fmtDate(finding.detected_at, true, lang)}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ================================================================== 2. the diagnosis
export function DiagnosisPanel({
  diagnosis, names, lang, children,
}: { diagnosis: Diagnosis | null; names: Names; lang: Language; children?: React.ReactNode }) {
  if (!diagnosis) {
    return (
      <Card>
        <CardHead title={pick(lang, '2 · What the data shows', '2 · डेटा क्या दिखाता है')} />
        <Empty>{pick(lang, 'No diagnosis recorded.', 'कोई निदान दर्ज नहीं।')}</Empty>
      </Card>
    );
  }

  const byFactor = new Map<string, typeof diagnosis.observations>();
  for (const o of diagnosis.observations) {
    if (!byFactor.has(o.factor)) byFactor.set(o.factor, []);
    byFactor.get(o.factor)!.push(o);
  }

  return (
    <Card>
      <CardHead
        title={pick(lang, '2 · What the data shows', '2 · डेटा क्या दिखाता है')}
        hint={pick(
          lang,
          'Conditions found in the driver schools, each read from a context table and traceable to the records it came from.',
          'चिन्हित विद्यालयों में पाई गई परिस्थितियाँ, प्रत्येक स्रोत रिकॉर्ड तक जाँची जा सकती है।',
        )}
        right={<Association lang={lang} />}
      />
      <div className="card-pad space-y-4">
        <Callout tone="warn" title={pick(lang, 'These are associations, not causes', 'ये संबंध हैं, कारण नहीं')}>
          {pick(
            lang,
            'Each row below is a fact: this school crossed this threshold in this window. Nothing here establishes that it caused the drop. The ranking is by how many driver schools share the condition, which is a starting point for enquiry, not a finding of cause.',
            'नीचे की हर पंक्ति एक तथ्य है। यह सिद्ध नहीं करती कि यही गिरावट का कारण है। क्रम केवल इस आधार पर है कि कितने विद्यालयों में यह स्थिति मिली।',
          )}
        </Callout>

        <div>
          <h3 className="h-section mb-2">{pick(lang, 'Ranked by how many schools share it', 'कितने विद्यालयों में, उस क्रम में')}</h3>
          <ul className="space-y-2">
            {diagnosis.ranked_factors.map((f) => (
              <li key={f.factor} className="flex flex-wrap items-center gap-3">
                <span className="min-w-[15rem] text-base text-ink">
                  <FactorName factor={f.factor as keyof typeof FACTOR_LABEL} lang={lang} />
                </span>
                <Bar value={f.schools_flagged} max={f.of_driver_schools} tone={f.schools_flagged === f.of_driver_schools ? 'crit' : 'warn'} />
                <span className="tnum text-sm font-medium text-ink">
                  {f.schools_flagged} {pick(lang, 'of', 'में से')} {f.of_driver_schools}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="h-section mb-2">{pick(lang, 'The underlying observations', 'मूल अवलोकन')}</h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'School', 'विद्यालय')}</th>
                  <th scope="col">{pick(lang, 'Condition', 'स्थिति')}</th>
                  <th scope="col">{pick(lang, 'Measured', 'मापा गया')}</th>
                  <th scope="col">{pick(lang, 'Threshold', 'सीमा')}</th>
                  <th scope="col">{pick(lang, 'Flagged', 'चिन्हित')}</th>
                  <th scope="col">{pick(lang, 'Source records', 'स्रोत रिकॉर्ड')}</th>
                </tr>
              </thead>
              <tbody>
                {diagnosis.observations.map((o, i) => (
                  <tr key={`${o.school_id}-${o.factor}-${i}`}>
                    <td>
                      <Link href={`/schools/${o.school_id}`} className="link">{nm(names.schools, o.school_id)}</Link>
                    </td>
                    <td><FactorName factor={o.factor as keyof typeof FACTOR_LABEL} lang={lang} /></td>
                    <td className="tnum">{o.value} {o.unit}</td>
                    <td className="tnum text-ink-soft">{o.threshold} {o.unit}</td>
                    <td>
                      {o.flagged
                        ? <Pill tone="critical">{pick(lang, 'Yes', 'हाँ')}</Pill>
                        : <Pill>{pick(lang, 'No', 'नहीं')}</Pill>}
                    </td>
                    <td>
                      <Mono>{o.source_table}</Mono>
                      {o.source_record_ids.length > 0 ? (
                        <span className="ml-1 text-2xs text-ink-faint">
                          {o.source_record_ids.slice(0, 2).join(', ')}
                          {o.source_record_ids.length > 2 ? ` +${o.source_record_ids.length - 2}` : ''}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-pend/30 bg-pend-light p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{pick(lang, 'AI hypothesis', 'AI परिकल्पना')}</h3>
              <AiDrafted lang={lang} model={diagnosis.ai_hypothesis_model} />
            </div>
            <p className="text-sm leading-relaxed text-ink">{diagnosis.ai_hypothesis}</p>
            <p className="mt-1.5 text-xs text-ink-soft">
              {pick(lang, 'Generated from the observations above. It carries no authority.', 'उपरोक्त अवलोकनों से तैयार। इसका कोई अधिकार नहीं।')}
            </p>
          </div>
          <div className="rounded-md border border-line bg-paper-sunk p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{pick(lang, "The officer's conclusion", 'अधिकारी का निष्कर्ष')}</h3>
              {diagnosis.human_conclusion ? <OfficerWritten lang={lang} /> : null}
            </div>
            {diagnosis.human_conclusion ? (
              <>
                <p className="text-sm leading-relaxed text-ink">{diagnosis.human_conclusion}</p>
                <p className="mt-1.5 text-xs text-ink-soft">
                  {pick(lang, 'Recorded by', 'दर्ज किया')} {nm(names.users, diagnosis.human_conclusion_by)}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-faint">
                {pick(lang, 'Not written yet. The AI hypothesis is not a substitute for it.', 'अभी नहीं लिखा। AI परिकल्पना इसका विकल्प नहीं है।')}
              </p>
            )}
            {children}
          </div>
        </div>

        <p className="text-xs leading-snug text-ink-faint">
          <Mono>{diagnosis.id}</Mono> · {diagnosis.method_note}
        </p>
      </div>
    </Card>
  );
}

// ================================================================== 3. the plan
export function PlanPanel({
  plans, currentPlan, approvals, intervention, names, lang, children,
}: {
  plans: CasePlan[]; currentPlan: CasePlan | null; approvals: Approval[];
  intervention: { name: string; description: string; steps: string[]; resources: string[];
    duration_weeks: number; success_metric: string; required_evidence: string[];
    delivery_conditions: string[]; limitations: string[];
    evidence: { status: string; summary: string; source_title: string | null; source_url: string | null; effect_size_text: string | null };
    cost_basis: CostBasisLike;
  } | null;
  names: Names; lang: Language; children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHead
        title={pick(lang, '3 · The plan', '3 · योजना')}
        hint={pick(
          lang,
          'What will be done, in which schools, how success was defined before the work started, and who signed it off.',
          'क्या किया जाएगा, किन विद्यालयों में, सफलता की परिभाषा पहले से तय, और किसने स्वीकृत किया।',
        )}
        right={currentPlan?.drafted_by === 'ai_draft' ? <AiDrafted lang={lang} model={currentPlan.ai_model} />
          : currentPlan?.drafted_by === 'officer' ? <OfficerWritten lang={lang} /> : null}
      />

      {!currentPlan ? (
        <>
          <Empty>{pick(lang, 'No plan drafted yet.', 'अभी कोई योजना नहीं।')}</Empty>
          {children ? <div className="card-pad pt-0">{children}</div> : null}
        </>
      ) : (
        <div className="card-pad space-y-4">
          <Facts cols={4}>
            <Field label={pick(lang, 'Intervention', 'हस्तक्षेप')}>
              <Link href={`/interventions/${currentPlan.intervention_id}`} className="link font-medium">
                {intervention?.name ?? currentPlan.intervention_id}
              </Link>
            </Field>
            <Field label={pick(lang, 'Schools', 'विद्यालय')}>{currentPlan.school_ids.length}</Field>
            <Field label={pick(lang, 'Runs for', 'अवधि')}>
              {intervention?.duration_weeks ?? '—'} {pick(lang, 'weeks', 'सप्ताह')}
            </Field>
            <Field
              label={pick(lang, 'Estimated cost', 'अनुमानित लागत')}
              hint={currentPlan.cost_is_illustrative || !intervention ? pick(lang, 'Estimated when the plan was drafted, from an illustrative card figure.', 'योजना बनते समय एक उदाहरणार्थ आँकड़े से अनुमानित।') : costNote(intervention.cost_basis, lang)}
            >
              <span className="tnum">{fmtInr(currentPlan.estimated_cost_inr)}</span>{' '}
              {currentPlan.cost_is_illustrative || !intervention ? <Illustrative lang={lang} /> : <CostSource cost={intervention.cost_basis} lang={lang} />}
            </Field>
          </Facts>

          <div>
            <h3 className="h-section mb-1">{pick(lang, 'Why this one', 'यही क्यों')}</h3>
            <p className="text-sm leading-relaxed text-ink">{currentPlan.rationale}</p>
            {currentPlan.alternatives.length > 0 ? (
              <p className="mt-1.5 text-sm text-ink-soft">
                {pick(lang, 'Alternatives considered:', 'अन्य विकल्प:')}{' '}
                {currentPlan.alternatives.map((a, i) => (
                  <span key={a}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/interventions/${a}`} className="link">{a}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </div>

          {intervention ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="h-section mb-1">{pick(lang, 'Steps', 'चरण')}</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink">
                  {intervention.steps.map((st) => <li key={st}>{st}</li>)}
                </ol>
              </div>
              <div className="space-y-3">
                <div>
                  <h3 className="h-section mb-1">{pick(lang, 'What counts as proof', 'सबूत क्या माना जाएगा')}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
                    {intervention.required_evidence.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="h-section mb-1">{pick(lang, 'Only works if', 'तभी काम करेगा जब')}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
                    {intervention.delivery_conditions.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {intervention ? (
            <Callout tone={intervention.evidence.status === 'sourced_summary_verify' ? 'warn' : 'method'}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{pick(lang, 'Evidence behind this intervention', 'इस हस्तक्षेप का आधार')}</span>
                <EvidenceStrength status={intervention.evidence.status} lang={lang} />
              </div>
              <p>{intervention.evidence.summary}</p>
              {intervention.evidence.effect_size_text ? (
                <p className="mt-1">{intervention.evidence.effect_size_text}</p>
              ) : null}
              {intervention.evidence.source_title ? (
                <p className="mt-1 text-xs">
                  {intervention.evidence.source_url ? (
                    <a href={intervention.evidence.source_url} className="link" rel="noreferrer noopener" target="_blank">
                      {intervention.evidence.source_title}
                    </a>
                  ) : intervention.evidence.source_title}
                </p>
              ) : null}
              {intervention.limitations.length > 0 ? (
                <p className="mt-1.5 text-sm">
                  <span className="font-medium">{pick(lang, 'Limitations: ', 'सीमाएँ: ')}</span>
                  {intervention.limitations.join(' ')}
                </p>
              ) : null}
            </Callout>
          ) : null}

          {currentPlan.pre_registration ? (
            <div className="rounded-md border border-brand/25 bg-brand-light p-3">
              {['draft', 'submitted', 'revision_requested'].includes(currentPlan.status) ? (
                <>
                  <h3 className="mb-1 text-sm font-semibold text-ink">
                    {pick(lang, 'How success will be judged', 'सफलता कैसे आँकी जाएगी')}
                  </h3>
                  <p className="mb-2 text-sm leading-relaxed text-ink-soft">
                    {pick(
                      lang,
                      'These terms are set out now and locked when the plan is approved: the metric, the two rounds to compare, the comparison schools, and the bar to clear. They cannot be chosen afterwards to suit the result.',
                      'ये शर्तें अभी तय हैं और स्वीकृति पर बंद हो जाएँगी — मापदंड, तुलना के दो दौर, तुलना विद्यालय, और लक्ष्य। बाद में परिणाम के अनुसार नहीं बदली जा सकतीं।',
                    )}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="mb-1 text-sm font-semibold text-ink">
                    {pick(lang, 'Success was defined before the work started', 'काम शुरू होने से पहले सफलता तय की गई')}
                  </h3>
                  <p className="mb-2 text-sm leading-relaxed text-ink-soft">
                    {pick(
                      lang,
                      'These terms were locked when the plan was approved — the metric, the two rounds to compare, the comparison schools, and the bar to clear. They cannot be chosen afterwards to suit the result.',
                      'ये शर्तें योजना स्वीकृत होते समय तय हो गईं — मापदंड, तुलना के दो दौर, तुलना विद्यालय, और लक्ष्य। बाद में परिणाम के अनुसार नहीं बदली जा सकतीं।',
                    )}
                  </p>
                </>
              )}
              <Facts cols={3}>
                <Field label={pick(lang, 'Measured on', 'मापदंड')}>
                  {pick(lang, 'Class', 'कक्षा')} {currentPlan.pre_registration.grade} · {names.competency}
                </Field>
                <Field label={pick(lang, 'Compare', 'तुलना')}>
                  {nm(names.roundLabels, currentPlan.pre_registration.baseline_round_id)} →{' '}
                  {nm(names.roundLabels, currentPlan.pre_registration.followup_round_id)}
                </Field>
                <Field label={pick(lang, 'Comparison schools', 'तुलना विद्यालय')}>
                  {currentPlan.pre_registration.comparison_school_ids.length}
                </Field>
                <Field label={pick(lang, 'Must gain at least', 'न्यूनतम सुधार')}>
                  <span className="tnum">+{currentPlan.pre_registration.success_threshold_pp} pp</span>
                </Field>
                <Field label={pick(lang, 'Participation floor', 'भागीदारी न्यूनतम')}>
                  <span className="tnum">{Math.round(currentPlan.pre_registration.participation_floor_ratio * 100)}%</span>{' '}
                  <span className="text-xs text-ink-faint">{pick(lang, 'of baseline', 'आधार का')}</span>
                </Field>
                <Field label={pick(lang, 'Settings version', 'सेटिंग संस्करण')}>
                  <Mono>{currentPlan.pre_registration.settings_version_id}</Mono>
                </Field>
              </Facts>
            </div>
          ) : null}

          {approvals.length > 0 ? (
            <div>
              <h3 className="h-section mb-2">{pick(lang, 'Approvals', 'स्वीकृतियाँ')}</h3>
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border border-line bg-paper-sunk p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={
                        a.decision === 'pending' ? 'pending'
                        : a.decision.startsWith('approved') ? 'good'
                        : a.decision === 'rejected' ? 'critical' : 'warn'
                      }>
                        {a.decision.replace(/_/g, ' ')}
                      </Pill>
                      <span className="text-sm text-ink-soft">
                        {pick(lang, 'requires', 'आवश्यक')}{' '}
                        <RoleName role={a.required_role} lang={lang} />
                      </span>
                      {a.ai_drafted ? <AiDrafted lang={lang} /> : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {pick(lang, 'Submitted by', 'प्रस्तुत')} {nm(names.users, a.submitted_by)}{' '}
                      {fmtDate(a.submitted_at, false, lang)}
                      {a.decided_by ? (
                        <> · {pick(lang, 'decided by', 'निर्णय')} {nm(names.users, a.decided_by)} {fmtDate(a.decided_at, false, lang)}</>
                      ) : null}
                    </p>
                    {a.reason ? (
                      <p className="mt-1 border-l-2 border-line-strong pl-2 text-sm italic text-ink">{a.reason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plans.length > 1 ? (
            <p className="text-xs text-ink-faint">
              {pick(lang, 'Plan history:', 'योजना इतिहास:')}{' '}
              {plans.map((p) => `${p.id} (cycle ${p.cycle} v${p.version}, ${p.status})`).join(' · ')}
            </p>
          ) : null}

          {children}
        </div>
      )}
    </Card>
  );
}

// ================================================================== 4. the work
export function WorkPanel({
  tasks, names, lang, today,
}: { tasks: Task[]; names: Names; lang: Language; today: string }) {
  const verified = tasks.filter((t) => t.verified_at).length;
  return (
    <Card>
      <CardHead
        title={pick(lang, '4 · The work', '4 · काम')}
        hint={pick(
          lang,
          'Who owes what, by when, and what proof each task has to produce.',
          'किस पर क्या ज़िम्मेदारी है, कब तक, और किस सबूत के साथ।',
        )}
        right={
          tasks.length > 0 ? (
            <span className="tnum text-sm text-ink-soft">
              {verified} / {tasks.length} {pick(lang, 'verified', 'सत्यापित')}
            </span>
          ) : null
        }
      />
      {tasks.length === 0 ? (
        <Empty>{pick(lang, 'No work has been assigned yet. Tasks appear once the plan is approved.', 'अभी कोई काम नहीं सौंपा गया। योजना स्वीकृत होने पर काम दिखेगा।')}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{pick(lang, 'Task', 'काम')}</th>
                <th scope="col">{pick(lang, 'Owner', 'ज़िम्मेदार')}</th>
                <th scope="col">{pick(lang, 'School', 'विद्यालय')}</th>
                <th scope="col">{pick(lang, 'Proof needed', 'आवश्यक सबूत')}</th>
                <th scope="col">{pick(lang, 'Due', 'नियत')}</th>
                <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const overdueDays = t.is_overdue
                  ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due_date.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
                  : 0;
                return (
                  <tr key={t.id}>
                    <td className="max-w-md">
                      <Link href={`/tasks/${t.id}`} className="link">
                        {pick(lang, t.title_en, t.title_hi)}
                      </Link>
                      {t.cross_source ? <span className="ml-1.5"><CrossSourcePill lang={lang} /></span> : null}
                      {t.deadline_change_reason ? (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {pick(lang, 'Deadline moved:', 'समय-सीमा बदली:')} {t.deadline_change_reason}
                        </p>
                      ) : null}
                      {t.reassign_reason ? (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {pick(lang, 'Reassigned:', 'पुनः सौंपा:')} {t.reassign_reason}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <span className="text-sm">{nm(names.users, t.owner_user_id)}</span>
                      <br />
                      <span className="text-xs text-ink-faint"><RoleName role={t.owner_role} lang={lang} /></span>
                    </td>
                    <td className="text-sm">
                      {t.school_id ? (
                        <Link href={`/schools/${t.school_id}`} className="link">{nm(names.schools, t.school_id)}</Link>
                      ) : <span className="text-ink-faint">{pick(lang, 'all schools', 'सभी विद्यालय')}</span>}
                    </td>
                    <td className="text-sm">
                      {t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />
                    </td>
                    <td className="tnum whitespace-nowrap text-sm">
                      {fmtDate(t.due_date, false, lang)}
                      {t.original_due_date !== t.due_date ? (
                        <span className="block text-2xs text-ink-faint">
                          {pick(lang, 'was', 'पहले')} {fmtDate(t.original_due_date, false, lang)}
                        </span>
                      ) : null}
                    </td>
                    <td className="space-y-1">
                      <TaskStatusPill status={t.status} lang={lang} />
                      {t.is_overdue ? <OverduePill lang={lang} days={overdueDays} /> : null}
                      {t.escalated_at ? <EscalatedPill lang={lang} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ================================================================== 5. the proof
export function ProofPanel({
  evidence, names, lang, children,
}: { evidence: Evidence[]; names: Names; lang: Language; children?: React.ReactNode }) {
  const verified = evidence.filter((e) => e.status === 'verified');
  const independent = verified.filter((e) => e.verification_method !== 'desk_review');
  return (
    <Card>
      <CardHead
        id="proof"
        title={pick(lang, '5 · The proof', '5 · सबूत')}
        hint={pick(
          lang,
          'Nobody verifies their own work. A case cannot reach the outcome check until every task has verified proof and at least one check came from an independent source.',
          'कोई अपना ही सबूत सत्यापित नहीं करता। हर काम का सबूत सत्यापित और कम से कम एक स्वतंत्र जाँच आवश्यक।',
        )}
        right={
          <span className="tnum text-sm text-ink-soft">
            {verified.length} / {evidence.length} {pick(lang, 'verified', 'सत्यापित')}
            {independent.length > 0 ? ` · ${independent.length} ${pick(lang, 'independent', 'स्वतंत्र')}` : ''}
          </span>
        }
      />
      {evidence.length === 0 ? (
        <Empty>{pick(lang, 'No proof submitted yet.', 'अभी कोई सबूत नहीं।')}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {evidence.map((e) => (
            <li key={e.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      <EvidenceTypeName type={e.evidence_type} lang={lang} />
                    </span>
                    <EvidenceStatusPill status={e.status} lang={lang} />
                    {e.verification_method && e.verification_method !== 'desk_review' ? (
                      <Pill tone="active">{e.verification_method.replace(/_/g, ' ')}</Pill>
                    ) : null}
                    <GpsBadge status={e.gps_status} distance={e.gps_distance_m} accuracy={e.gps_accuracy_m} lang={lang} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {pick(lang, 'Submitted by', 'प्रस्तुत')} {nm(names.users, e.submitted_by)}{' '}
                    (<RoleName role={e.submitted_role} lang={lang} />) {fmtDate(e.submitted_at, true, lang)}
                    {e.school_id ? <> · {nm(names.schools, e.school_id)}</> : null}
                    {e.channel !== 'app' ? <> · {pick(lang, 'via', 'माध्यम')} {e.channel}</> : null}
                  </p>
                  <EvidenceSummary id={e.id} summary={e.summary} lang={lang} />
                  {e.verified_by ? (
                    <p className="mt-1 text-sm text-good">
                      {pick(lang, 'Checked by', 'जाँचा')} {nm(names.users, e.verified_by)} {fmtDate(e.verified_at, true, lang)}
                    </p>
                  ) : null}
                  {e.rejection_reason ? (
                    <p className="mt-1 border-l-2 border-crit/40 pl-2 text-sm text-crit">{e.rejection_reason}</p>
                  ) : null}
                  <p className="mt-1 text-2xs text-ink-faint">
                    <Mono>{e.id}</Mono>
                    {e.file_name ? <> · {e.file_name}</> : null}
                    {e.sha256 ? <> · sha256 {shortHash(e.sha256)}</> : null}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {children}
    </Card>
  );
}

// ================================================================== 6. the outcome
export function OutcomePanel({
  outcomes, names, lang, children,
}: { outcomes: OutcomeEvaluation[]; names: Names; lang: Language; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHead
        id="outcome"
        title={pick(lang, '6 · Did it work?', '6 · क्या यह काम आया?')}
        hint={pick(
          lang,
          'The pre-registered check, run on the next round against the comparison schools locked at approval.',
          'पूर्व-निर्धारित जाँच, अगले दौर पर, स्वीकृति के समय तय तुलना विद्यालयों के साथ।',
        )}
      />
      {outcomes.length === 0 ? (
        <div className="card-pad">
          <Callout tone="method">
            {pick(
              lang,
              'No outcome check yet. One is produced when the follow-up assessment round named in the plan has been imported.',
              'अभी कोई परिणाम जाँच नहीं। योजना में तय अगला आकलन दौर आयात होने पर जाँच होगी।',
            )}
          </Callout>
          {children}
        </div>
      ) : (
        <div className="divide-y divide-line">
          {outcomes.map((o) => (
            <div key={o.id} className="card-pad space-y-4">
              <OutcomeCalibrationNote outcomeId={o.id} lang={lang} />
              <div className="flex flex-wrap items-center gap-2">
                <OutcomePill category={o.category} lang={lang} />
                <span className="text-sm text-ink-soft">
                  {pick(lang, 'cycle', 'चक्र')} {o.cycle} ·{' '}
                  {nm(names.roundLabels, o.baseline_round_id)} → {nm(names.roundLabels, o.followup_round_id)}
                </span>
                {o.is_illustrative ? <Illustrative lang={lang} /> : null}
              </div>

              {o.did_pp !== null ? (
                <>
                  <div>
                    <h3 className="h-section mb-1">
                      {pick(lang, 'Difference in differences', 'अंतर का अंतर')}
                    </h3>
                    <p className="mb-2 text-sm leading-snug text-ink-soft">
                      {pick(
                        lang,
                        'How much the treated schools moved, minus how much the comparison schools moved over the same two rounds.',
                        'उपचारित विद्यालयों का बदलाव, घटा उसी अवधि में तुलना विद्यालयों का बदलाव।',
                      )}
                    </p>
                    <EffectInterval
                      did={o.did_pp}
                      ciLow={o.ci_low_pp}
                      ciHigh={o.ci_high_pp}
                      threshold={o.success_threshold_pp}
                      caption={`Difference-in-differences estimate of ${o.did_pp} percentage points with its 95% interval, against zero and the pre-registered success threshold of ${o.success_threshold_pp} points.`}
                    />
                  </div>

                  <SlopeChart
                    groups={[
                      {
                        key: 'treated', label: `${pick(lang, 'Treated', 'उपचारित')} (${o.treated.length})`,
                        color: SERIES.one, from: o.treated_baseline_mean, to: o.treated_followup_mean,
                      },
                      {
                        key: 'comparison', label: `${pick(lang, 'Comparison', 'तुलना')} (${o.comparison.length})`,
                        color: SERIES.two, from: o.comparison_baseline_mean, to: o.comparison_followup_mean,
                      },
                    ]}
                    xLabels={[nm(names.roundLabels, o.baseline_round_id), nm(names.roundLabels, o.followup_round_id)]}
                    caption="Mean percentage at the grade benchmark for the treated and comparison school groups at baseline and follow-up."
                  />
                </>
              ) : (
                <Callout tone="warn" title={pick(lang, 'No estimate could be produced', 'कोई अनुमान नहीं')}>
                  {o.interpretation_note || pick(lang, 'Too little data to compare.', 'तुलना के लिए पर्याप्त डेटा नहीं।')}
                </Callout>
              )}

              <Facts cols={4}>
                <Field label={pick(lang, 'Treated change', 'उपचारित बदलाव')}>
                  <Delta pp={o.treated_change_pp} />
                </Field>
                <Field label={pick(lang, 'Comparison change', 'तुलना बदलाव')}>
                  <Delta pp={o.comparison_change_pp} />
                </Field>
                <Field label={pick(lang, 'Delivery verified', 'कार्य सत्यापित')}>
                  {o.delivery_verified
                    ? <Pill tone="good">{pick(lang, 'Yes', 'हाँ')}</Pill>
                    : <Pill tone="critical">{pick(lang, 'No', 'नहीं')}</Pill>}
                </Field>
                <Field label={pick(lang, 'Independent check', 'स्वतंत्र जाँच')}>
                  {o.cross_source_verified
                    ? <Pill tone="good">{pick(lang, 'Yes', 'हाँ')}</Pill>
                    : <Pill tone="critical">{pick(lang, 'No', 'नहीं')}</Pill>}
                </Field>
              </Facts>

              <div className="rounded-md border border-line bg-paper-sunk p-3">
                <h3 className="mb-1 text-sm font-semibold text-ink">
                  {pick(lang, 'Participation check', 'भागीदारी जाँच')}
                </h3>
                <p className="text-sm leading-relaxed text-ink-soft">
                  {pick(
                    lang,
                    'If fewer children sit the follow-up assessment, the average can rise without anyone learning more. The check fails when follow-up participation drops below the floor.',
                    'अगर अगले आकलन में कम बच्चे बैठें, तो औसत बढ़ सकता है बिना किसी सुधार के। भागीदारी न्यूनतम से नीचे जाने पर जाँच असफल।',
                  )}
                </p>
                <p className="mt-1.5 text-sm text-ink">
                  <span className="tnum">
                    {o.participation_check.treated_baseline === null ? '—' : `${Math.round(o.participation_check.treated_baseline * 100)}%`}
                    {' → '}
                    {o.participation_check.treated_followup === null ? '—' : `${Math.round(o.participation_check.treated_followup * 100)}%`}
                  </span>
                  {' · '}
                  {pick(lang, 'floor', 'न्यूनतम')}{' '}
                  <span className="tnum">{Math.round(o.participation_check.floor * 100)}%</span>
                  {' of baseline · '}
                  {o.participation_check.passed
                    ? <Pill tone="good">{pick(lang, 'Passed', 'उत्तीर्ण')}</Pill>
                    : <Pill tone="critical">{pick(lang, 'Failed', 'अनुत्तीर्ण')}</Pill>}
                </p>
              </div>

              {o.closure_blockers.length > 0 ? (
                <Callout tone="crit" title={pick(lang, 'This case cannot be closed yet', 'यह प्रकरण अभी बंद नहीं हो सकता')}>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {o.closure_blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </Callout>
              ) : (
                <Callout tone="good" title={pick(lang, 'Eligible for closure', 'बंद करने योग्य')}>
                  {pick(
                    lang,
                    'Delivery is verified, an independent check exists, the measured gain clears the pre-registered bar and participation held.',
                    'कार्य सत्यापित, स्वतंत्र जाँच मौजूद, सुधार पूर्व-निर्धारित लक्ष्य से अधिक, और भागीदारी बनी रही।',
                  )}
                </Callout>
              )}

              <Callout tone="warn" title={pick(lang, 'How to read this number', 'इस संख्या को कैसे पढ़ें')}>
                {OUTCOME_NOTE}
                <p className="mt-1.5 text-xs">{o.ci_method}</p>
              </Callout>

              <details className="no-print">
                <summary className="cursor-pointer text-sm text-ink-faint hover:text-ink-soft">
                  {pick(lang, 'School-by-school figures', 'विद्यालयवार आँकड़े')}
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{pick(lang, 'School', 'विद्यालय')}</th>
                        <th scope="col">{pick(lang, 'Group', 'समूह')}</th>
                        <th scope="col">{pick(lang, 'Baseline', 'आधार')}</th>
                        <th scope="col">{pick(lang, 'Follow-up', 'अनुवर्ती')}</th>
                        <th scope="col">{pick(lang, 'Change', 'बदलाव')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...o.treated.map((r) => ({ r, g: pick(lang, 'Treated', 'उपचारित') })),
                        ...o.comparison.map((r) => ({ r, g: pick(lang, 'Comparison', 'तुलना') })),
                      ].map(({ r, g }) => (
                        <tr key={`${g}-${r.school_id}`}>
                          <td>
                            <Link href={`/schools/${r.school_id}`} className="link">{nm(names.schools, r.school_id)}</Link>
                          </td>
                          <td className="text-sm text-ink-soft">{g}</td>
                          <td className="tnum">{fmtPct(r.baseline_pct)}</td>
                          <td className="tnum">{fmtPct(r.followup_pct)}</td>
                          <td>
                            {r.baseline_pct !== null && r.followup_pct !== null
                              ? <Delta pp={Math.round((r.followup_pct - r.baseline_pct) * 10) / 10} />
                              : <span className="text-ink-faint">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <p className="text-xs text-ink-faint">
                <Mono>{o.id}</Mono> · {pick(lang, 'evaluated', 'मूल्यांकित')} {fmtDate(o.evaluated_at, true, lang)}
                {o.reviewed_by ? <> · {pick(lang, 'read by', 'पढ़ा')} {nm(names.users, o.reviewed_by)}</> : null}
                {' · '}<Mono>{o.settings_version_id}</Mono>
              </p>
              {children}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ================================================================== 7. the timeline
export function TimelinePanel({
  events, names, lang,
}: { events: CaseEvent[]; names: Names; lang: Language }) {
  return (
    <Card>
      <CardHead
        title={pick(lang, '7 · Timeline', '7 · घटनाक्रम')}
        hint={pick(lang, 'Every step, most recent first.', 'हर कदम, नवीनतम पहले।')}
      />
      {events.length === 0 ? <Empty /> : (
        <ol className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2.5 sm:px-5">
              <time className="tnum w-32 shrink-0 text-xs text-ink-faint" dateTime={e.ts}>
                {fmtDate(e.ts, true, lang)}
              </time>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{e.summary}</p>
                <p className="text-xs text-ink-faint">
                  {e.actor_user_id ? nm(names.users, e.actor_user_id) : e.actor_label}
                  {e.from_status && e.to_status ? (
                    <> · {e.from_status.replace(/_/g, ' ')} → {e.to_status.replace(/_/g, ' ')}</>
                  ) : null}
                  {e.related_entity ? <> · <Mono>{e.related_entity}</Mono></> : null}
                </p>
              </div>
              <span className="shrink-0"><Pill>{e.kind.replace(/_/g, ' ')}</Pill></span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
