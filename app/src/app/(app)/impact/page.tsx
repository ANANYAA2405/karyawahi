import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { all, j } from '@/lib/db';
import { canSeeCase, and } from '@/lib/scope';
import { listCases } from '@/lib/cases';
import { competencies, rounds } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { PageHead, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';

/**
 * Outcome verification. Every pre-registered difference-in-differences check in scope, shown
 * with its interval, participation and delivery status — and the cases still waiting for a
 * follow-up round. "Improvement demonstrated" is only claimed when the interval clears zero;
 * a positive point estimate alone is labelled indicative.
 */

const STATES = [
  { key: 'improved_confirmed', label: 'Improvement demonstrated', tone: 'border-good/30 bg-good-light text-good', note: '95% interval above zero and threshold met' },
  { key: 'improved_indicative', label: 'Improvement indicative', tone: 'border-brand/30 bg-brand-light text-brand', note: 'Point estimate met the threshold; interval does not rule out no effect' },
  { key: 'no_gain', label: 'No improvement demonstrated', tone: 'border-warn/30 bg-warn-light text-warn', note: 'Below target or no change' },
  { key: 'worsened', label: 'Negative outcome', tone: 'border-crit/30 bg-crit-light text-crit', note: 'Treated schools fell relative to comparison' },
  { key: 'inconclusive', label: 'Inconclusive', tone: 'border-line-strong bg-paper-sunk text-ink-soft', note: 'Data cannot settle it' },
] as const;
const stateOf = (cat: string) => (cat === 'below_target' || cat === 'no_change' ? 'no_gain' : cat);

type Row = {
  id: string; case_id: string; title: string; grade: number; competency_id: string; category: string;
  tb: number | null; tf: number | null; cb: number | null; cf: number | null; did: number | null; lo: number | null; hi: number | null;
  thr: number; pc: string; dv: number; csv: number; eligible: number; blockers: string; note: string; evaluated_at: string;
  treated: string; comparison: string; iv: string | null; illustrative: number;
};

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;
  const comp = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  const p = canSeeCase(session, 'oe.case_id');
  const rows = all<Row>(
    `select oe.id, oe.case_id, c.title, oe.grade, oe.competency_id, oe.category,
            oe.treated_baseline_mean tb, oe.treated_followup_mean tf, oe.comparison_baseline_mean cb, oe.comparison_followup_mean cf,
            oe.did_pp did, oe.ci_low_pp lo, oe.ci_high_pp hi, oe.success_threshold_pp thr, oe.participation_check pc,
            oe.delivery_verified dv, oe.cross_source_verified csv, oe.closure_eligible eligible, oe.closure_blockers blockers,
            oe.interpretation_note note, oe.evaluated_at, oe.treated, oe.comparison, pl.intervention_id iv, oe.is_illustrative illustrative
       from outcome_evaluations oe join cases c on c.id = oe.case_id left join case_plans pl on pl.id = oe.plan_id
      where ${and(p).sql} order by oe.evaluated_at desc`, ...p.params,
  );
  const awaiting = listCases(session, { status: ['outcome_pending'], limit: 200, order: 'due' });
  const nextRound = rounds().find((r) => r.status === 'scheduled');
  const shown = sp.state ? rows.filter((r) => stateOf(r.category) === sp.state) : rows;
  const counts = Object.fromEntries(STATES.map((s) => [s.key, rows.filter((r) => stateOf(r.category) === s.key).length]));

  const span = 30; // ±pp drawn
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v + span) / (2 * span)) * 100))}%`;

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Outcome verification', 'परिणाम सत्यापन')}
        sub={pick(lang, 'Did the work move learning? Each check compares treated schools with comparison schools locked at approval, across the baseline and follow-up rounds.', 'क्या काम से अधिगम बढ़ा? हर जाँच स्वीकृति पर तय तुलना विद्यालयों से करती है।')}
        right={<Link href="/reports/new?type=learning_impact" className="btn-quiet"><Icon name="file" size={15} />{pick(lang, 'Impact report', 'प्रभाव रिपोर्ट')}</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STATES.map((s) => (
          <Link key={s.key} href={sp.state === s.key ? '/impact' : `/impact?state=${s.key}`} aria-pressed={sp.state === s.key}
            className={`rounded-xl border bg-white px-4 py-3 shadow-card transition-shadow hover:shadow-lift ${sp.state === s.key ? 'ring-2 ring-navy' : 'border-line'}`}>
            <span className={`chip ${s.tone}`}>{s.label}</span>
            <p className="kpi-num mt-2 text-ink">{counts[s.key]}</p>
            <p className="mt-1 text-xs leading-snug text-ink-faint">{s.note}</p>
          </Link>
        ))}
        <a href="#awaiting" className="rounded-xl border border-line bg-white px-4 py-3 shadow-card hover:shadow-lift">
          <span className="chip border-pend/30 bg-pend-light text-pend">Awaiting follow-up</span>
          <p className="kpi-num mt-2 text-ink">{awaiting.length}</p>
          <p className="mt-1 text-xs leading-snug text-ink-faint">Delivered; the next round decides</p>
        </a>
      </div>

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-md font-semibold text-ink">Outcome checks {sp.state ? `· ${STATES.find((s) => s.key === sp.state)?.label}` : ''}</h2>
            <p className="text-xs text-ink-faint">Effect = (treated after − before) − (comparison after − before), in percentage points. Bars show the 95% interval; the dashed line is zero, the teal tick is the success threshold.</p>
          </div>
          {sp.state ? <Link href="/impact" className="btn-ghost btn-sm">Show all</Link> : null}
        </header>
        {shown.length === 0 ? <p className="px-6 py-12 text-center text-sm text-ink-faint">No outcome checks in this view.</p> : (
          <div className="overflow-x-auto">
            <table className="table min-w-[1000px]">
              <thead><tr><th>Case</th><th>Treated</th><th>Comparison</th><th className="w-[260px]">Effect and 95% interval</th><th>Checks</th><th>Result</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const pc = j<{ passed?: boolean; treated_followup?: number; floor?: number }>(r.pc, {});
                  const blockers = j<string[]>(r.blockers, []);
                  const st = STATES.find((s) => s.key === stateOf(r.category))!;
                  const nT = j<unknown[]>(r.treated, []).length;
                  const nC = j<unknown[]>(r.comparison, []).length;
                  return (
                    <tr key={r.id}>
                      <td className="max-w-[260px]">
                        <Link href={`/cases/${r.case_id}#outcome`} className="font-medium text-ink hover:text-brand">{r.case_id}</Link>
                        <p className="line-clamp-2 text-xs text-ink-soft">{r.title}</p>
                        <p className="text-xs text-ink-faint">Class {r.grade} · {comp.get(r.competency_id)} · {r.iv ?? '—'} · {fmtDate(r.evaluated_at)}</p>
                      </td>
                      <td className="tnum whitespace-nowrap text-sm">{r.tb?.toFixed(1) ?? '—'}% → {r.tf?.toFixed(1) ?? '—'}%<span className="block text-xs text-ink-faint">{nT} schools</span></td>
                      <td className="tnum whitespace-nowrap text-sm">{r.cb?.toFixed(1) ?? '—'}% → {r.cf?.toFixed(1) ?? '—'}%<span className="block text-xs text-ink-faint">{nC} schools</span></td>
                      <td>
                        {r.did !== null && r.lo !== null && r.hi !== null ? (
                          <div>
                            <div className="relative h-5" role="img" aria-label={`Effect ${r.did.toFixed(1)} pp, 95% interval ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}, threshold ${r.thr} pp`}>
                              <span className="absolute inset-y-0 border-l border-dashed border-ink-faint" style={{ left: x(0) }} />
                              <span className="absolute inset-y-0 border-l-2 border-brand" style={{ left: x(r.thr) }} />
                              <span className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${r.lo > 0 ? 'bg-good' : r.hi < 0 ? 'bg-crit' : 'bg-navy-300'}`} style={{ left: x(r.lo), width: `calc(${x(r.hi)} - ${x(r.lo)})` }} />
                              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-navy shadow" style={{ left: x(r.did) }} />
                            </div>
                            <p className="tnum text-xs text-ink-soft">{r.did > 0 ? '+' : ''}{r.did.toFixed(1)} pp <span className="text-ink-faint">[{r.lo.toFixed(1)}, {r.hi.toFixed(1)}] · target ≥ {r.thr}</span></p>
                          </div>
                        ) : <span className="text-sm text-ink-faint">Not computable</span>}
                      </td>
                      <td className="text-xs">
                        <p className={pc.passed ? 'text-good' : 'text-warn'}><Icon name={pc.passed ? 'check' : 'alert'} size={12} className="mr-1 inline" />Participation {pc.passed ? 'passed' : 'below floor'}</p>
                        <p className={r.dv ? 'text-good' : 'text-warn'}><Icon name={r.dv ? 'check' : 'alert'} size={12} className="mr-1 inline" />Delivery {r.dv ? 'verified' : 'not verified'}</p>
                        <p className={r.csv ? 'text-good' : 'text-ink-faint'}><Icon name={r.csv ? 'check' : 'info'} size={12} className="mr-1 inline" />Independent check {r.csv ? 'done' : 'missing'}</p>
                      </td>
                      <td className="max-w-[220px]">
                        <span className={`chip ${st.tone}`}>{st.label}</span>
                        {r.illustrative ? <span className="chip ml-1 border-warn/30 bg-warn-light text-warn">illustrative</span> : null}
                        <p className={`mt-1 text-xs ${r.eligible ? 'text-good' : 'text-ink-soft'}`}>{r.eligible ? 'Eligible to close' : blockers.length ? `Not closable: ${blockers.join('; ')}` : 'Not closable'}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section id="awaiting" className="card overflow-hidden scroll-mt-28">
          <header className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-md font-semibold text-ink">Awaiting follow-up ({awaiting.length})</h2>
            <p className="text-xs text-ink-faint">{nextRound ? `Work verified; the outcome check runs on ${nextRound.code} (${nextRound.label}), window ${fmtDate(nextRound.window_start)} – ${fmtDate(nextRound.window_end)}.` : 'Work verified; waiting for the next round.'}</p>
          </header>
          {awaiting.length === 0 ? <p className="px-6 py-10 text-center text-sm text-ink-faint">None.</p> : (
            <ul className="divide-y divide-line">
              {awaiting.slice(0, 20).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <Link href={`/cases/${c.id}`} className="min-w-0 truncate text-sm text-ink hover:text-brand"><span className="font-mono text-xs text-ink-faint">{c.id}</span> {c.title}</Link>
                  <span className="shrink-0 text-xs text-ink-faint">Class {c.grade} · {comp.get(c.competency_id)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-ink">Reading these results honestly</h2>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li><strong className="text-ink">Comparable groups.</strong> Comparison schools are locked at approval, before anyone sees the result — so they cannot be chosen to flatter it.</li>
            <li><strong className="text-ink">Parallel trends.</strong> The method assumes treated and comparison schools would have moved together without the work. Two rounds cannot test that.</li>
            <li><strong className="text-ink">Regression to the mean.</strong> Schools are picked because they fell; some recovery is expected anyway.</li>
            <li><strong className="text-ink">Participation.</strong> If too few children were assessed at follow-up, the result is not trusted for closure.</li>
            <li><strong className="text-ink">Three separate states.</strong> Work completed, proof verified and learning improved are never merged. Only the last closes a case.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
