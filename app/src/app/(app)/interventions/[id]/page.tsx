import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { intervention, competencies } from '@/lib/repo';
import { listCases } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Callout, Facts, Field, Mono, fmtInr, fmtDate,
} from '@/components/ui';
import { Pill, Illustrative, EvidenceStrength, EvidenceTypeName, RoleName } from '@/components/labels';
import { matchForCase, feasibility, interventionHistory } from '@/lib/studio';
import { getCase } from '@/lib/cases';
import { FitPanel, HistoryPanel, FeasibilityPanel } from '@/components/studio';
import { Icon } from '@/components/Icon';

/** One intervention card, in full, including the parts that argue against using it. */

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
  const caseSchools = caseId ? getCase(session, caseId)?.school_ids.length ?? 1 : 1;

  const wfValues = {
    schools: numOr(sp.schools, 1, 500) ?? Math.max(1, caseSchools),
    budget: sp.budget ?? '', teachers: sp.teachers ?? '', weeks: sp.weeks ?? '', attendance: sp.attendance ?? '',
    training: sp.training === '1', connectivity: sp.connectivity === '1',
  };
  const wf = feasibility(i, {
    schools: wfValues.schools,
    budgetInr: numOr(sp.budget, 0, 1e9), teachersAvailable: numOr(sp.teachers, 0, 2000),
    weeksAvailable: numOr(sp.weeks, 0, 52), attendancePct: numOr(sp.attendance, 0, 100),
    trainingComplete: wfValues.training, connectivity: wfValues.connectivity,
  });
  const hist = interventionHistory(i.id).get(i.id) ?? { plans: 0, evaluated: 0, improved: 0, confirmed: 0, notImproved: 0, inconclusive: 0 };

  const comps = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));
  const using = listCases(session, { limit: 200 }).slice(0, 0); // cases link via plans; listed below from plans
  const look = lookupsFor(lang);

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

      <Card>
        <CardHead title={pick(lang, 'At a glance', 'एक नज़र में')} />
        <div className="card-pad">
          <Facts cols={4}>
            <Field label={pick(lang, 'Category', 'श्रेणी')}>{i.category.replace(/_/g, ' ')}</Field>
            <Field label={pick(lang, 'Classes', 'कक्षाएँ')}>{i.grades.join(', ')}</Field>
            <Field label={pick(lang, 'Runs for', 'अवधि')}>{i.duration_weeks} {pick(lang, 'weeks', 'सप्ताह')}</Field>
            <Field label={pick(lang, 'Cost', 'लागत')} hint={i.cost_basis.note}>
              <span className="tnum">{fmtInr(i.cost_basis.amount_inr)}</span>
              <span className="text-xs text-ink-faint"> / {i.cost_basis.unit}</span>
              <span className="ml-1.5"><Illustrative lang={lang} /></span>
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
              <li>{pick(lang, 'Cost', 'लागत')} {fmtInr(i.cost_basis.amount_inr)} / {i.cost_basis.unit} {pick(lang, 'is an illustrative card figure', 'एक उदाहरणार्थ आँकड़ा है')}{i.cost_basis.note ? ` — ${i.cost_basis.note.replace(/\.$/, '')}` : ''}.</li>
              <li>{pick(lang, 'Whether it worked here is decided by the next assessment round, not by delivery.', 'यहाँ काम आया या नहीं, यह अगला आकलन तय करेगा।')}</li>
            </ul>
          </div>
        </div>
      </Card>

      <HistoryPanel h={hist} />

      <FeasibilityPanel id={i.id} caseId={caseId} values={wfValues} checks={wf.checks} totalCost={wf.totalCost} verdict={wf.verdict} />

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
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{pick(lang, 'Task', 'काम')}</th>
                <th scope="col">{pick(lang, 'Owner', 'ज़िम्मेदार')}</th>
                <th scope="col">{pick(lang, 'Per school?', 'प्रति विद्यालय?')}</th>
                <th scope="col">{pick(lang, 'Days', 'दिन')}</th>
                <th scope="col">{pick(lang, 'Proof', 'सबूत')}</th>
              </tr>
            </thead>
            <tbody>
              {i.task_templates.map((t) => (
                <tr key={t.key}>
                  <td className="max-w-md">
                    {pick(lang, t.title_en, t.title_hi)}
                    {t.cross_source ? (
                      <span className="ml-1.5"><Pill tone="active">{pick(lang, 'independent check', 'स्वतंत्र जाँच')}</Pill></span>
                    ) : null}
                  </td>
                  <td className="text-sm"><RoleName role={t.owner_role} lang={lang} /></td>
                  <td className="text-sm">{t.per_school ? pick(lang, 'yes', 'हाँ') : pick(lang, 'once', 'एक बार')}</td>
                  <td className="tnum text-sm">{t.duration_days}</td>
                  <td className="text-sm">{t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
