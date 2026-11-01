import Link from 'next/link';
import type { InterventionMatch, InterventionHistory, FeasibilityCheck } from '@/lib/studio';
import { Icon } from './Icon';

/** Intervention Studio panels. Server components; every value is computed in src/lib/studio.ts. */

export function FitPanel({ caseId, caseTitle, match, factors }: { caseId: string; caseTitle: string; match: InterventionMatch; factors: string[] }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="fit-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-light/50 px-4 py-3 sm:px-5">
        <div>
          <h2 id="fit-title" className="text-md font-semibold text-ink">Why this option for {caseId}?</h2>
          <p className="text-sm text-ink-soft">{caseTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {match.eligible ? <span className="tnum rounded-lg bg-navy px-2.5 py-1 text-sm font-semibold text-white" title="Rule-based relevance points">{match.points} pts</span> : <span className="chip border-crit/30 bg-crit-light text-crit">Not a fit</span>}
          <Link href={`/cases/${caseId}#plan`} className="btn-quiet btn-sm">Back to case</Link>
        </div>
      </header>
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-3">
        <div>
          <p className="label mb-1.5">Matches the problem because</p>
          {match.eligible ? (
            <ul className="space-y-1.5 text-sm text-ink">
              {match.reasons.map((r) => <li key={r.text} className="flex gap-2"><span className="tnum shrink-0 rounded bg-good-light px-1 text-2xs font-semibold text-good">+{r.points}</span>{r.text}</li>)}
            </ul>
          ) : <p className="text-sm text-crit">{match.excludedBecause}</p>}
        </div>
        <div>
          <p className="label mb-1.5">Records behind the diagnosis</p>
          {factors.length ? <ul className="space-y-1 text-sm text-ink-soft">{factors.map((f) => <li key={f} className="flex gap-2"><Icon name="search" size={13} className="mt-0.5 text-ink-faint" />{f}</li>)}</ul> : <p className="text-sm text-ink-faint">No diagnosis conditions recorded.</p>}
          <p className="mt-2 text-xs text-ink-faint">Associations observed in the driver schools — not established causes.</p>
        </div>
        <div>
          <p className="label mb-1.5">What could make it fail</p>
          {match.risks.length ? (
            <ul className="space-y-1.5 text-sm">{match.risks.map((r) => <li key={r.text} className={`flex gap-2 ${r.level === 'crit' ? 'text-crit' : 'text-warn'}`}><Icon name="alert" size={14} className="mt-0.5" />{r.text}</li>)}</ul>
          ) : <p className="text-sm text-ink-soft">No specific risk read from this case’s diagnosis. The card’s own delivery conditions still apply (below).</p>}
          <p className={`mt-3 rounded-lg px-2.5 py-1.5 text-xs ${match.authority.canApprove ? 'bg-good-light text-good' : 'bg-paper-sunk text-ink-soft'}`}>
            <Icon name="shield" size={13} className="mr-1 inline" />Approved by the {match.authority.who}.{match.authority.canApprove ? ' You hold this authority.' : ' You do not hold this authority.'}
          </p>
        </div>
      </div>
      <p className="border-t border-line bg-paper-sunk px-4 py-2 text-xs text-ink-faint sm:px-5">Points add up the listed rules. They measure relevance to this case, not a predicted learning effect. Unknown: whether delivery will reach the dose the card was designed for — that is what the outcome check is for.</p>
    </section>
  );
}

export function HistoryPanel({ h }: { h: InterventionHistory }) {
  const parts = [
    { label: 'Gain shown', n: h.improved, cls: 'bg-good' },
    { label: 'No gain', n: h.notImproved, cls: 'bg-warn' },
    { label: 'Inconclusive', n: h.inconclusive, cls: 'bg-navy-200' },
  ];
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="hist-title">
      <h2 id="hist-title" className="text-md font-semibold text-ink">Historical outcomes in this ledger</h2>
      <p className="mb-3 text-xs text-ink-faint">Counts across the whole (fictional) ledger — aggregate only. Not a causal estimate.</p>
      <dl className="mb-3 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-paper-sunk py-2"><dt className="label">Plans</dt><dd className="kpi-num text-xl text-ink">{h.plans}</dd></div>
        <div className="rounded-lg bg-paper-sunk py-2"><dt className="label">Evaluated</dt><dd className="kpi-num text-xl text-ink">{h.evaluated}</dd></div>
        <div className="rounded-lg bg-paper-sunk py-2"><dt className="label">Confirmed</dt><dd className="kpi-num text-xl text-good">{h.confirmed}</dd></div>
      </dl>
      {h.evaluated > 0 ? (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
            {parts.map((p) => (p.n ? <span key={p.label} className={p.cls} style={{ width: `${(100 * p.n) / h.evaluated}%` }} /> : null))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 text-xs text-ink-soft">{parts.map((p) => <li key={p.label} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${p.cls}`} />{p.label} {p.n}</li>)}</ul>
        </>
      ) : <p className="text-sm text-ink-faint">Never evaluated in this ledger.</p>}
    </section>
  );
}

const STATUS_STYLE = {
  ok: { icon: 'check-circle', cls: 'text-good', label: 'OK' },
  warn: { icon: 'alert', cls: 'text-warn', label: 'At risk' },
  fail: { icon: 'ban', cls: 'text-crit', label: 'Blocks delivery' },
  unknown: { icon: 'info', cls: 'text-ink-faint', label: 'Not assessed' },
} as const;

export function FeasibilityPanel({
  id, caseId, values, checks, totalCost, verdict, costSource = 'illustrative',
}: {
  id: string; caseId?: string;
  /** Where the card's unit cost comes from: a UP PAB 2025-26 line, a neighbouring line's rate, or illustrative. */
  costSource?: 'pab' | 'pab_proxy' | 'illustrative';
  values: { schools: number; budget: string; teachers: string; weeks: string; attendance: string; training: boolean; connectivity: boolean };
  checks: FeasibilityCheck[]; totalCost: number | null; verdict: 'feasible' | 'at_risk' | 'not_feasible';
}) {
  const v = { feasible: ['bg-good-light text-good border-good/30', 'Deliverable as designed'], at_risk: ['bg-warn-light text-warn border-warn/30', 'Deliverable, with risks to fidelity'], not_feasible: ['bg-crit-light text-crit border-crit/30', 'Not deliverable as designed'] }[verdict];
  const inp = 'input h-9 text-sm';
  return (
    <section className="card overflow-hidden" aria-labelledby="wf-title" id="what-if">
      <header className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 id="wf-title" className="text-md font-semibold text-ink">What-if feasibility planner</h2>
        <p className="text-sm text-ink-faint">Enter your constraints. This checks whether the plan can be <em>delivered</em> as designed — it does not predict a learning outcome.</p>
      </header>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[300px_1fr]">
        <form method="get" action={`/interventions/${id}#what-if`} className="space-y-3">
          {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
          <label className="block"><span className="text-sm font-medium text-ink">Schools</span><input name="schools" type="number" min={1} max={500} defaultValue={values.schools} className={inp} /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Budget available (₹)</span><input name="budget" type="number" min={0} step={500} defaultValue={values.budget} placeholder="e.g. 10000" className={inp} /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Teachers available</span><input name="teachers" type="number" min={0} max={2000} defaultValue={values.teachers} placeholder="e.g. 3" className={inp} /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Weeks before the next round</span><input name="weeks" type="number" min={0} max={52} defaultValue={values.weeks} placeholder="e.g. 4" className={inp} /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Average attendance (%)</span><input name="attendance" type="number" min={0} max={100} defaultValue={values.attendance} placeholder="e.g. 70" className={inp} /></label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="training" value="1" defaultChecked={values.training} className="h-4 w-4 accent-brand" />Training already complete</label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="connectivity" value="1" defaultChecked={values.connectivity} className="h-4 w-4 accent-brand" />Schools have phone/data connectivity</label>
          <button type="submit" className="btn-primary w-full"><Icon name="refresh" size={15} />Check feasibility</button>
        </form>
        <div>
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 ${v[0]}`}>
            <p className="text-base font-semibold">{v[1]}</p>
            {totalCost !== null ? <p className="text-sm">{costSource === 'illustrative' ? 'Illustrative cost' : 'Estimated cost (UP PAB 2025-26 rate)'}: <strong className="tnum">₹{totalCost.toLocaleString('en-IN')}</strong></p> : null}
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {checks.map((c) => {
              const st = STATUS_STYLE[c.status];
              return (
                <li key={c.key} className="flex items-start gap-3 px-3.5 py-2.5">
                  <Icon name={st.icon} size={17} className={`mt-0.5 ${st.cls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{c.label} <span className={`ml-1 text-xs font-normal ${st.cls}`}>{st.label}</span></p>
                    <p className="text-sm text-ink-soft">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-faint">{costSource === 'pab' ? 'Unit cost from the UP PAB 2025-26 minutes; the counts come from the schools’ UDISE+ figures where a case is open.'
            : costSource === 'pab_proxy' ? 'Unit cost borrowed from the nearest UP PAB 2025-26 line (see the card); the counts come from the schools’ UDISE+ figures where a case is open.'
              : 'Costs are illustrative card figures, not PAB unit costs.'}</p>
        </div>
      </div>
    </section>
  );
}
