import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { interventions, competencies } from '@/lib/repo';
import { getCase } from '@/lib/cases';
import { matchForCase, interventionHistory, authorityFor, feasibility } from '@/lib/studio';
import { pick } from '@/lib/i18n';
import { PageHead, fmtInr } from '@/components/ui';
import { EvidenceStrength } from '@/components/labels';
import { Icon } from '@/components/Icon';
import type { Intervention } from '@domain/types';

/**
 * Compare two or three interventions on the dimensions that decide a plan. No composite score:
 * each row is a fact or a rule-based judgement with its reason, and where the catalogue makes
 * no effect claim the comparison says so instead of inventing one.
 */

type SP = { id?: string | string[]; ids?: string; case?: string };

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const all = interventions();
  const raw = [...(Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []), ...(sp.ids ? sp.ids.split(',') : [])];
  const ids = [...new Set(raw.map((x) => x.trim().toUpperCase()))].filter((x) => all.some((i) => i.id === x)).slice(0, 3);
  const caseId = sp.case && getCase(session, sp.case.toUpperCase()) ? sp.case.toUpperCase() : undefined;
  const match = caseId ? matchForCase(session, caseId) : null;
  const caseSchools = caseId ? getCase(session, caseId)?.school_ids.length ?? 1 : 1;

  // With a case but nothing chosen yet, start from the top three matches.
  const chosen: Intervention[] = (ids.length ? ids : match ? match.matches.filter((m) => m.eligible).slice(0, 3).map((m) => m.intervention.id) : [])
    .map((id) => all.find((i) => i.id === id)!).filter(Boolean);
  const hist = interventionHistory();
  const comps = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  const cols = chosen.map((iv) => {
    const m = match?.matches.find((x) => x.intervention.id === iv.id) ?? null;
    const f = feasibility(iv, { schools: caseSchools, budgetInr: null, teachersAvailable: null, weeksAvailable: null, attendancePct: null, trainingComplete: false, connectivity: false });
    return { iv, m, h: hist.get(iv.id), auth: m?.authority ?? authorityFor(session, iv.lever), cost: f.totalCost };
  });

  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode[] }) => (
    <tr>
      <th scope="row" className="w-48 border-b border-line bg-paper-sunk px-3 py-3 text-left align-top text-sm font-semibold text-ink">
        {label}{hint ? <span className="mt-0.5 block text-2xs font-normal text-ink-faint">{hint}</span> : null}
      </th>
      {children.map((c, i) => <td key={i} className="border-b border-l border-line px-3 py-3 align-top text-sm text-ink-soft">{c}</td>)}
    </tr>
  );

  const Group = ({ label, tone }: { label: string; tone: 'brand' | 'warn' | 'ink' }) => (
    <tr><th colSpan={cols.length + 1} className={`border-b border-line bg-white px-3 pb-1.5 pt-4 text-left text-2xs font-semibold uppercase tracking-[0.08em] ${tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : 'text-ink-faint'}`}>{label}</th></tr>
  );

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href={`/interventions${caseId ? `?case=${caseId}` : ''}`} className="link">{pick(lang, 'Interventions', 'हस्तक्षेप')}</Link>}
        title={pick(lang, 'Compare options', 'विकल्पों की तुलना')}
        sub={caseId && match ? `For ${caseId}: ${match.caseTitle}` : pick(lang, 'Pick two or three interventions. Open from a case to also see how each fits it.', 'दो या तीन हस्तक्षेप चुनें।')}
      />

      <form method="get" className="card flex flex-wrap items-end gap-2 p-3">
        {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
        {[0, 1, 2].map((n) => (
          <label key={n} className="min-w-[220px] flex-1">
            <span className="label">Option {n + 1}{n === 2 ? ' (optional)' : ''}</span>
            <select name="id" defaultValue={chosen[n]?.id ?? ''} className="input mt-1 h-9 text-sm">
              <option value="">—</option>
              {all.map((i) => <option key={i.id} value={i.id}>{i.id} · {i.name}</option>)}
            </select>
          </label>
        ))}
        <button type="submit" className="btn-primary h-9"><Icon name="scale" size={14} />Compare</button>
      </form>

      {cols.length < 2 ? (
        <div className="card px-6 py-12 text-center">
          <Icon name="scale" size={28} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-medium text-ink">Choose at least two options</p>
          <p className="mt-1 text-sm text-ink-soft">Use the selectors above, or tick rows in the catalogue.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="w-48 border-b border-line bg-paper-sunk" />
                {cols.map(({ iv, m }) => (
                  <th key={iv.id} scope="col" className="border-b border-l border-line px-3 py-3 text-left align-top">
                    <p className="font-mono text-xs font-normal text-ink-faint">{iv.id}</p>
                    <Link href={`/interventions/${iv.id}${caseId ? `?case=${caseId}` : ''}`} className="text-base font-semibold leading-snug text-ink hover:text-brand">{iv.name}</Link>
                    {m?.isCurrentPlan ? <span className="chip ml-1 border-brand/30 bg-brand-light align-middle text-brand">Current plan</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {match ? (
                <Row label={`Relevance to ${caseId}`} hint="Rule-based points; not an effect estimate">
                  {cols.map(({ m }) => m && m.eligible ? (
                    <div key="r"><p className="tnum text-lg font-semibold text-ink">{m.points} pts</p><ul className="mt-1 space-y-0.5 text-xs">{m.reasons.map((r) => <li key={r.text}>+{r.points} {r.text}</li>)}</ul></div>
                  ) : <span key="r" className="text-crit">Not a fit — {m?.excludedBecause}</span>)}
                </Row>
              ) : null}
              <Group label="Fit" tone="ink" />
              <Row label="Targets">{cols.map(({ iv }) => <span key="t">Class {iv.grades.join(', ')} · {iv.competency_ids.map((c) => comps.get(c) ?? c).join(', ')}</span>)}</Row>
              <Group label="Documented evidence" tone="brand" />
              <Row label="Evidence quality">{cols.map(({ iv }) => <div key="e" className="space-y-1"><EvidenceStrength status={iv.evidence.status} lang={lang} /><p className="text-xs">{iv.evidence.summary}</p></div>)}</Row>
              <Row label="Effect estimate" hint="Only where the card cites one">{cols.map(({ iv }) => iv.evidence.effect_size_text ? <span key="x" className="text-ink">{iv.evidence.effect_size_text} <span className="text-warn">(verify before production)</span></span> : <span key="x" className="text-ink-faint">No effect-size claim made</span>)}</Row>
              <Group label="Assumptions & delivery — not evidence" tone="warn" />
              <Row label="Cost" hint="Illustrative card figure">{cols.map(({ iv, cost }) => <span key="c" className="tnum">{fmtInr(iv.cost_basis.amount_inr)} {iv.cost_basis.unit}{caseId && cost !== null ? <span className="block text-xs text-ink-faint">≈ {fmtInr(cost)} for this case’s {caseSchools} school(s)</span> : null}</span>)}</Row>
              <Row label="Duration">{cols.map(({ iv }) => <span key="d">{iv.duration_weeks ? `${iv.duration_weeks} weeks` : 'Next PAB cycle'}</span>)}</Row>
              <Row label="Resources & staff">{cols.map(({ iv }) => <ul key="s" className="list-disc space-y-0.5 pl-4 text-sm">{iv.resources.slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul>)}</Row>
              <Row label="Delivery conditions" hint="Must be true for it to work">{cols.map(({ iv }) => <ul key="dc" className="list-disc space-y-0.5 pl-4 text-sm">{iv.delivery_conditions.map((r) => <li key={r}>{r}</li>)}</ul>)}</Row>
              <Row label="Risks for this case">{cols.map(({ m, iv }) => m ? (m.risks.length ? <ul key="rk" className="space-y-0.5 text-sm text-warn">{m.risks.map((r) => <li key={r.text}>{r.text}</li>)}</ul> : <span key="rk" className="text-ink-faint">None read from the diagnosis</span>) : <ul key="rk" className="list-disc space-y-0.5 pl-4 text-sm">{iv.limitations.slice(0, 3).map((l) => <li key={l}>{l}</li>)}</ul>)}</Row>
              <Row label="Ledger outcomes" hint="Aggregate, this fictional ledger">{cols.map(({ h }) => h && h.evaluated ? <span key="h">{h.improved} of {h.evaluated} evaluated showed a gain ({h.confirmed} confirmed){h.inconclusive ? `, ${h.inconclusive} inconclusive` : ''}</span> : <span key="h" className="text-ink-faint">{h?.plans ? `${h.plans} plans, none evaluated yet` : 'Never used'}</span>)}</Row>
              <Group label="Decision" tone="ink" />
              <Row label="Authority required">{cols.map(({ auth }) => <span key="a" className={auth.canApprove ? 'text-good' : ''}>{auth.who}{auth.canApprove ? ' — you can approve' : ''}</span>)}</Row>
              <Row label="Success metric">{cols.map(({ iv }) => <span key="sm">{iv.success_metric}</span>)}</Row>
              <Row label="Plan it">{cols.map(({ iv }) => <Link key="p" href={`/interventions/${iv.id}?${caseId ? `case=${caseId}&` : ''}schools=${caseSchools}#what-if`} className="btn-quiet btn-sm">What-if planner<Icon name="arrow-right" size={13} /></Link>)}</Row>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-faint">Approving a different intervention is done from the case’s plan section by an officer with the authority shown. Karyavahi AI can explain this comparison but cannot choose for you.</p>
    </div>
  );
}
