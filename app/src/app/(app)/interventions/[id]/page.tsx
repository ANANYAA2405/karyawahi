import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { intervention, competencies } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Callout, Facts, Field, Mono, fmtInr, fmtDate,
} from '@/components/ui';
import { Pill, EvidenceStrength, EvidenceTypeName, RoleName } from '@/components/labels';
import { matchForCase, feasibility, interventionHistory, authorityFor } from '@/lib/studio';
import { getCase } from '@/lib/cases';
import { planCounts } from '@/lib/plans';
import { FitPanel, FeasibilityPanel } from '@/components/studio';
import { Icon } from '@/components/Icon';
import { CostSource, costNote, unitLabel, isRealCost } from '@/components/cost';

/**
 * One intervention card, in full, including the parts that argue against using it. It leads with
 * a picture: who has to approve it, how long it runs and what it costs, how it has fared in this
 * ledger, and a timeline of the tasks approving it would create.
 */

const LADDER = [
  { k: 'block', en: 'Block', hi: 'खंड' },
  { k: 'district', en: 'District', hi: 'ज़िला' },
  { k: 'pab', en: 'PAB', hi: 'PAB' },
] as const;
const CATEGORY: Record<string, { en: string; hi: string }> = {
  numeracy: { en: 'Numeracy', hi: 'गणित' }, literacy: { en: 'Literacy', hi: 'भाषा' }, attendance: { en: 'Attendance', hi: 'उपस्थिति' },
  teacher_support: { en: 'Teacher support', hi: 'शिक्षक सहायता' }, staffing: { en: 'Staffing', hi: 'स्टाफ़' }, materials: { en: 'Materials', hi: 'सामग्री' },
};
const ROLE_BAR: Record<string, string> = { headmaster: 'bg-brand/60', crc: 'bg-pend/60', brc: 'bg-navy-600/60', beo: 'bg-amber', deo: 'bg-warn' };

type WF = { case?: string; schools?: string; budget?: string; teachers?: string; weeks?: string; attendance?: string; training?: string; connectivity?: string };
const numOr = (v: string | undefined, min: number, max: number): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

export default async function InterventionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<WF> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const sp = await searchParams;
  const i = intervention(id);
  if (!i) notFound();

  // Case context: only honoured if the case is in the user's scope.
  const caseId = sp.case && getCase(session, sp.case.toUpperCase()) ? sp.case.toUpperCase() : undefined;
  const ctx = caseId ? matchForCase(session, caseId) : null;
  const fit = ctx?.matches.find((m) => m.intervention.id === i.id) ?? null;
  const theCase = caseId ? getCase(session, caseId) : null;
  const caseSchools = theCase?.school_ids.length ?? 1;
  // The case's own schools give the real child and teacher counts, while the school count is theirs.
  const counts = theCase && !sp.schools ? planCounts(theCase.school_ids, theCase.grade) : {};

  const wfValues = {
    schools: numOr(sp.schools, 1, 500) ?? Math.max(1, caseSchools),
    budget: sp.budget ?? '', teachers: sp.teachers ?? '', weeks: sp.weeks ?? '', attendance: sp.attendance ?? '',
    training: sp.training === '1', connectivity: sp.connectivity === '1',
  };
  const wf = feasibility(i, {
    schools: wfValues.schools,
    budgetInr: numOr(sp.budget, 0, 1e9), teachersAvailable: numOr(sp.teachers, 0, 2000),
    weeksAvailable: numOr(sp.weeks, 0, 52), attendancePct: numOr(sp.attendance, 0, 100),
    trainingComplete: wfValues.training, connectivity: wfValues.connectivity, ...counts,
  });
  const hist = interventionHistory(i.id).get(i.id) ?? { plans: 0, evaluated: 0, improved: 0, confirmed: 0, notImproved: 0, inconclusive: 0 };

  const comps = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));
  const auth = authorityFor(session, i.lever);
  const rung = LADDER.findIndex((l) => l.k === i.lever);
  const dayMax = Math.max(1, ...i.task_templates.map((t) => t.duration_days));
  const weeks = Math.max(0, i.duration_weeks || 0);
  const outcomes = [
    { en: 'Gain shown', hi: 'सुधार दिखा', n: hist.improved, cls: 'bg-good' },
    { en: 'No gain', hi: 'सुधार नहीं', n: hist.notImproved, cls: 'bg-warn' },
    { en: 'Inconclusive', hi: 'अनिर्णीत', n: hist.inconclusive, cls: 'bg-navy-200' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        breadcrumb={
          <>
            <Link href={`/interventions${caseId ? `?case=${caseId}` : ''}`} className="link">{pick(lang, 'Interventions', 'हस्तक्षेप')}</Link>
            {' › '}<Mono>{i.id}</Mono>
          </>
        }
        title={i.name}
        sub={i.description}
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill tone={i.lever === 'block' ? 'neutral' : 'active'}>
              {i.lever === 'block' ? pick(lang, 'block lever', 'खंड स्तर') : i.lever === 'district' ? pick(lang, 'district lever', 'ज़िला स्तर') : 'PAB'}
            </Pill>
            <EvidenceStrength status={i.evidence.status} lang={lang} />
          </div>
        }
      />

      {fit && ctx && caseId ? (
        <FitPanel caseId={caseId} caseTitle={ctx.caseTitle} match={fit} factors={ctx.factors.map((f) => f.label)} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line-strong bg-white px-4 py-3 text-sm text-ink-soft">
          <span><Icon name="info" size={14} className="mr-1 inline text-ink-faint" />{pick(lang, 'Open this card from a case to see why it does or does not fit that case.', 'किसी प्रकरण से खोलें ताकि उपयुक्तता दिखे।')}</span>
          <Link href={`/interventions/compare?ids=${i.id}`} className="btn-quiet btn-sm"><Icon name="scale" size={14} />{pick(lang, 'Compare with others', 'तुलना करें')}</Link>
        </div>
      )}

      {/* The picture: approval, time and cost, and the track record. */}
      <section className="grid gap-3 lg:grid-cols-3" aria-label={pick(lang, 'This intervention at a glance', 'यह हस्तक्षेप एक नज़र में')}>
        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="label">{pick(lang, 'Who has to approve it', 'किसकी स्वीकृति चाहिए')}</p>
          <ol className="mt-4 flex items-center gap-1" aria-label={pick(lang, 'Approval ladder', 'स्वीकृति सीढ़ी')}>
            {LADDER.map((l, idx) => (
              <li key={l.k} className="flex flex-1 items-center gap-1">
                <span aria-current={idx === rung ? 'step' : undefined}
                  className={`flex-1 rounded-xl border px-2 py-2 text-center text-sm ${idx === rung ? 'border-brand bg-brand font-semibold text-white' : idx < rung ? 'border-brand/30 bg-brand-light text-brand' : 'border-line bg-paper-sunk text-ink-faint'}`}>
                  {pick(lang, l.en, l.hi)}
                </span>
                {idx < LADDER.length - 1 ? <Icon name="chevron-right" size={14} className="shrink-0 text-ink-faint" /> : null}
              </li>
            ))}
          </ol>
          <p className={`mt-3 flex items-center gap-1.5 text-sm ${auth.canApprove ? 'text-good' : 'text-ink-soft'}`}>
            <Icon name={auth.canApprove ? 'check-circle' : 'lock'} size={14} className="shrink-0" />
            {auth.canApprove ? pick(lang, 'You can approve this.', 'आप इसे स्वीकृत कर सकते हैं।') : pick(lang, 'A higher level has to approve this.', 'इसे उच्च स्तर स्वीकृत करेगा।')}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'How long, and what it costs', 'कितना समय, कितनी लागत')}</span>
            <span className="text-xs text-ink-faint"><span className="tnum kpi-num mr-1 text-ink">{weeks || '—'}</span>{pick(lang, 'weeks', 'सप्ताह')}</span>
          </p>
          <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }} role="img" aria-label={`${weeks} ${pick(lang, 'weeks', 'सप्ताह')}`}>
            {Array.from({ length: Math.max(12, Math.ceil(weeks / 12) * 12) }, (_, w) => (
              <span key={w} className={`h-3 rounded-sm ${w < weeks ? 'bg-brand/60' : 'bg-paper-deep'}`} />
            ))}
          </div>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="tnum text-xl font-semibold text-ink">{fmtInr(i.cost_basis.amount_inr)}</span>
            <span className="text-xs text-ink-faint">/ {unitLabel(i.cost_basis.unit, lang)}</span>
            {i.cost_basis.amount_composite_inr ? <span className="text-xs text-ink-faint">· {pick(lang, 'composite school', 'कंपोज़िट विद्यालय')} {fmtInr(i.cost_basis.amount_composite_inr)}</span> : null}
            <CostSource cost={i.cost_basis} lang={lang} />
          </p>
          {isRealCost(i.cost_basis) ? <p className="mt-1.5 text-xs leading-snug text-ink-soft">{costNote(i.cost_basis, lang)}</p> : null}
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'How it fared in this ledger', 'इस पंजी में परिणाम')}</span>
            <span className="text-xs text-ink-faint"><span className="tnum font-semibold text-ink">{hist.plans}</span> {pick(lang, 'plans', 'योजनाएँ')} · <span className="tnum font-semibold text-ink">{hist.evaluated}</span> {pick(lang, 'checked', 'जाँची')}</span>
          </p>
          {hist.evaluated > 0 ? (
            <>
              <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={outcomes.map((o) => `${pick(lang, o.en, o.hi)} ${o.n}`).join(', ')}>
                {outcomes.map((o) => (o.n ? <span key={o.en} className={`h-full ${o.cls}`} style={{ width: `${(100 * o.n) / hist.evaluated}%` }} /> : null))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                {outcomes.map((o) => <li key={o.en} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${o.cls}`} />{pick(lang, o.en, o.hi)} <span className="tnum font-semibold text-ink">{o.n}</span></li>)}
              </ul>
              <p className="mt-2 text-2xs text-ink-faint">{hist.confirmed} {pick(lang, 'confirmed (interval above zero). Aggregate only; not a causal estimate.', 'पुष्ट (अंतराल शून्य से ऊपर)। केवल कुल योग; कारण का अनुमान नहीं।')}</p>
            </>
          ) : <p className="mt-4 text-sm text-ink-faint">{pick(lang, 'Never evaluated in this ledger.', 'इस पंजी में कभी जाँचा नहीं गया।')}</p>}
        </div>
      </section>

      <Card>
        <CardHead title={pick(lang, 'At a glance', 'एक नज़र में')} />
        <div className="card-pad">
          <Facts cols={4}>
            <Field label={pick(lang, 'Category', 'श्रेणी')}>{CATEGORY[i.category] ? pick(lang, CATEGORY[i.category].en, CATEGORY[i.category].hi) : i.category}</Field>
            <Field label={pick(lang, 'Classes', 'कक्षाएँ')}>{i.grades.join(', ')}</Field>
            <Field label={pick(lang, 'Runs for', 'अवधि')}>{i.duration_weeks} {pick(lang, 'weeks', 'सप्ताह')}</Field>
            <Field label={pick(lang, 'Cost', 'लागत')} hint={costNote(i.cost_basis, lang)}>
              <span className="tnum">{fmtInr(i.cost_basis.amount_inr)}</span>
              <span className="text-xs text-ink-faint"> / {unitLabel(i.cost_basis.unit, lang)}</span>
              <span className="ml-1.5"><CostSource cost={i.cost_basis} lang={lang} /></span>
            </Field>
            <Field label={pick(lang, 'Competencies', 'दक्षताएँ')} >
              {i.competency_ids.map((c) => comps.get(c) ?? c).join(', ')}
            </Field>
            <Field label={pick(lang, 'Judged on', 'मापदंड')}>{i.success_metric}</Field>
            <Field label={pick(lang, 'Card version', 'कार्ड संस्करण')}>v{i.version}</Field>
            <Field label={pick(lang, 'Review due', 'समीक्षा तिथि')}><span className="tnum">{fmtDate(i.review_date)}</span></Field>
          </Facts>
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'What the evidence says', 'आधार क्या कहता है')}
          right={<EvidenceStrength status={i.evidence.status} lang={lang} />}
        />
        <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="space-y-2.5 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-brand"><Icon name="file" size={13} />{pick(lang, 'Documented evidence', 'प्रलेखित आधार')}</p>
            {i.evidence.source_title ? (
              <>
                <p className="text-sm leading-relaxed text-ink">{i.evidence.summary}</p>
                {i.evidence.effect_size_text ? (
                  <Callout tone="warn" title={pick(lang, 'The reported effect, and its spread', 'बताया गया प्रभाव और उसका विस्तार')}>
                    {i.evidence.effect_size_text}
                  </Callout>
                ) : null}
                <p className="text-sm">
                  <span className="text-ink-faint">{pick(lang, 'Source: ', 'स्रोत: ')}</span>
                  {i.evidence.source_url ? (
                    <a href={i.evidence.source_url} className="link" target="_blank" rel="noreferrer noopener">{i.evidence.source_title}</a>
                  ) : i.evidence.source_title}
                </p>
                {i.evidence.status === 'sourced_summary_verify' ? <p className="text-xs text-warn">{pick(lang, 'Summary flagged: verify against the source before production use.', 'स्रोत से सत्यापन आवश्यक।')}</p> : null}
              </>
            ) : (
              <p className="text-sm leading-relaxed text-ink-soft">
                {pick(lang, 'None. This card cites no published study and makes no claim about how large an effect to expect.', 'कोई नहीं। यह कार्ड किसी अध्ययन का हवाला नहीं देता और प्रभाव का दावा नहीं करता।')}
              </p>
            )}
          </div>
          <div className="space-y-2.5 bg-paper-sunk/50 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-warn"><Icon name="info" size={13} />{pick(lang, 'Assumptions — not evidence', 'मान्यताएँ — आधार नहीं')}</p>
            {!i.evidence.source_title ? <p className="text-sm text-ink-soft">{i.evidence.summary}</p> : null}
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>{pick(lang, 'It will work here only if:', 'यहाँ तभी काम करेगा जब:')} {i.delivery_conditions.join('; ')}.</li>
              {isRealCost(i.cost_basis)
                ? <li>{pick(lang, 'Cost', 'लागत')} {fmtInr(i.cost_basis.amount_inr)} / {unitLabel(i.cost_basis.unit, lang)} {i.cost_basis.basis === 'pab' ? pick(lang, 'is the UP PAB 2025-26 unit cost', 'उ.प्र. PAB 2025-26 की इकाई लागत है') : pick(lang, 'is borrowed from the nearest UP PAB 2025-26 line', 'उ.प्र. PAB 2025-26 की निकटतम पंक्ति से ली गई दर है')} ({pick(lang, 'PDF page', 'PDF पृष्ठ')} {i.cost_basis.citation?.pdf_page}). {pick(lang, 'What a district actually spends can differ.', 'ज़िले का वास्तविक व्यय भिन्न हो सकता है।')}</li>
                : <li>{pick(lang, 'Cost', 'लागत')} {fmtInr(i.cost_basis.amount_inr)} / {unitLabel(i.cost_basis.unit, lang)} {pick(lang, 'is an illustrative card figure', 'एक उदाहरणार्थ आँकड़ा है')}{i.cost_basis.note ? ` — ${costNote(i.cost_basis, lang).replace(/\.$/, '')}` : ''}.</li>}
              <li>{pick(lang, 'Whether it worked here is decided by the next assessment round, not by delivery.', 'यहाँ काम आया या नहीं, यह अगला आकलन तय करेगा।')}</li>
            </ul>
          </div>
        </div>
      </Card>

      <FeasibilityPanel id={i.id} caseId={caseId} values={wfValues} checks={wf.checks} totalCost={wf.totalCost} verdict={wf.verdict} costSource={isRealCost(i.cost_basis) ? (i.cost_basis.basis ?? 'pab') : 'illustrative'} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={pick(lang, 'How it is done', 'कैसे किया जाता है')} />
          <div className="card-pad">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink">
              {i.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            {i.resources.length > 0 ? (
              <>
                <h3 className="h-section mb-1 mt-4">{pick(lang, 'What is needed', 'आवश्यक सामग्री')}</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
                  {i.resources.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHead title={pick(lang, 'When it will not work', 'यह कब काम नहीं करेगा')} />
          <div className="card-pad space-y-3">
            <div>
              <h3 className="h-section mb-1">{pick(lang, 'Only works if', 'तभी काम करेगा जब')}</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
                {i.delivery_conditions.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
            {i.limitations.length > 0 ? (
              <div>
                <h3 className="h-section mb-1">{pick(lang, 'Known limitations', 'ज्ञात सीमाएँ')}</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
                  {i.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title={pick(lang, 'What proof it has to produce', 'कौन सा सबूत देना होगा')}
          hint={pick(lang, 'Approving this intervention creates these tasks, each with its own proof requirement.', 'स्वीकृति पर ये काम बनते हैं, हर एक के लिए सबूत आवश्यक।')}
        />
        <ol className="divide-y divide-line" aria-label={pick(lang, 'Task timeline', 'काम की समय-रेखा')}>
          {i.task_templates.map((t) => (
            <li key={t.key} className="grid items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {pick(lang, t.title_en, t.title_hi)}
                  {t.cross_source ? <span className="ml-1.5"><Pill tone="active">{pick(lang, 'independent check', 'स्वतंत्र जाँच')}</Pill></span> : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  <RoleName role={t.owner_role} lang={lang} /> · {t.per_school ? pick(lang, 'per school', 'प्रति विद्यालय') : pick(lang, 'once', 'एक बार')} · {t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-paper-deep">
                  <span className={`block h-full rounded-full ${ROLE_BAR[t.owner_role] ?? 'bg-brand/50'}`} style={{ width: `${Math.max(4, (100 * t.duration_days) / dayMax)}%` }} />
                </span>
                <span className="tnum w-16 shrink-0 text-right text-xs text-ink-soft">{t.duration_days} {pick(lang, 'days', 'दिन')}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <h3 className="h-section mb-1">{pick(lang, 'Accepted as proof', 'सबूत के रूप में स्वीकार्य')}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
            {i.required_evidence.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      </Card>
    </div>
  );
}
