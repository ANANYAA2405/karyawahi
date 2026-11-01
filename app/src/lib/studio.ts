import 'server-only';
import { all } from './db';
import type { Session } from './session';
import { interventions, intervention, competency } from './repo';
import { getCase, caseDiagnosis, casePlans } from './cases';
import { canDecideLever } from './guard';
import type { Intervention, FactorCode, Lever } from '@domain/types';

/**
 * Intervention Studio — deterministic, explainable matching.
 *
 * Every point an option earns is listed with the rule that gave it, so the ranking can be
 * argued with. The points measure *relevance to this case*, not a predicted learning effect:
 * the catalogue makes no effect-size claim for 15 of its 18 cards, and the score never
 * invents one. An LLM may explain these results; it does not produce them.
 */

/** Which intervention categories plausibly respond to which observed condition. */
const FACTOR_FIT: Record<FactorCode, { ids: string[]; why: string }> = {
  teacher_transfer: { ids: ['INT-11', 'INT-12', 'INT-14'], why: 'addresses a lost or missing teacher' },
  visit_gap: { ids: ['INT-04', 'INT-18'], why: 'restores academic support visits' },
  attendance_drop: { ids: ['INT-09', 'INT-10'], why: 'targets falling attendance' },
  high_ptr: { ids: ['INT-14', 'INT-15', 'INT-13'], why: 'designed for large or multigrade classes' },
};

const FACTOR_LABEL: Record<FactorCode, string> = {
  teacher_transfer: 'teacher transferred without replacement',
  visit_gap: 'no CRC visit for 60+ days',
  attendance_drop: 'attendance fell',
  high_ptr: 'high pupil–teacher ratio',
};

export interface MatchReason { points: number; text: string }
export interface MatchRisk { level: 'warn' | 'crit'; text: string }

export interface InterventionMatch {
  intervention: Intervention;
  eligible: boolean;
  excludedBecause?: string;
  points: number;
  reasons: MatchReason[];
  risks: MatchRisk[];
  authority: { lever: Lever; canApprove: boolean; who: string };
  history: InterventionHistory;
  isCurrentPlan: boolean;
}

export interface InterventionHistory {
  plans: number;
  evaluated: number;
  improved: number;
  confirmed: number;
  notImproved: number;
  inconclusive: number;
}

/** State-wide aggregate counts only — no case details cross the user's scope here. */
export function interventionHistory(id?: string): Map<string, InterventionHistory> {
  const rows = all<{ intervention_id: string; plans: number; evaluated: number; improved: number; confirmed: number; not_improved: number; inconclusive: number }>(
    `select p.intervention_id,
            count(distinct p.id) plans,
            count(oe.id) evaluated,
            sum(case when oe.category in ('improved_confirmed','improved_indicative') then 1 else 0 end) improved,
            sum(case when oe.category = 'improved_confirmed' then 1 else 0 end) confirmed,
            sum(case when oe.category in ('below_target','no_change','worsened') then 1 else 0 end) not_improved,
            sum(case when oe.category = 'inconclusive' then 1 else 0 end) inconclusive
       from case_plans p left join outcome_evaluations oe on oe.plan_id = p.id
      ${id ? 'where p.intervention_id = ?' : ''}
      group by p.intervention_id`,
    ...(id ? [id] : []),
  );
  return new Map(rows.map((r) => [r.intervention_id, {
    plans: Number(r.plans), evaluated: Number(r.evaluated), improved: Number(r.improved ?? 0),
    confirmed: Number(r.confirmed ?? 0), notImproved: Number(r.not_improved ?? 0), inconclusive: Number(r.inconclusive ?? 0),
  }]));
}

const EMPTY_HISTORY: InterventionHistory = { plans: 0, evaluated: 0, improved: 0, confirmed: 0, notImproved: 0, inconclusive: 0 };

export function authorityFor(s: Session, lever: Lever) {
  return {
    lever,
    canApprove: canDecideLever(s, lever),
    who: lever === 'block' ? 'Block Education Officer or DEO' : lever === 'district' ? 'District Education Officer or state team' : 'DEO or state team, then the PAB',
  };
}

/** Rank the catalogue against one case. Returns null when the case is out of scope. */
export function matchForCase(s: Session, caseId: string): { caseTitle: string; factors: { factor: FactorCode; share: number; label: string }[]; matches: InterventionMatch[] } | null {
  const c = getCase(s, caseId);
  if (!c) return null;
  const dx = caseDiagnosis(s, caseId);
  const plans = casePlans(s, caseId);
  const current = plans.find((p) => p.id === c.current_plan_id) ?? plans.at(-1);
  const comp = competency(c.competency_id);
  const history = interventionHistory();
  const factors = (dx?.ranked_factors ?? []).map((f) => ({
    factor: f.factor, share: f.of_driver_schools > 0 ? f.schools_flagged / f.of_driver_schools : 0,
    label: `${f.schools_flagged} of ${f.of_driver_schools} driver schools: ${FACTOR_LABEL[f.factor] ?? f.label}`,
  }));

  const matches = interventions().map((iv): InterventionMatch => {
    const reasons: MatchReason[] = [];
    const risks: MatchRisk[] = [];
    let eligible = true;
    let excludedBecause: string | undefined;

    if (!iv.grades.includes(c.grade)) { eligible = false; excludedBecause = `Not designed for Class ${c.grade}`; }
    else if (!iv.competency_ids.includes(c.competency_id)) {
      eligible = false; excludedBecause = `Does not target ${comp?.name_en ?? c.competency_id}`;
    } else {
      const targeted = iv.competency_ids.length <= 3;
      reasons.push({ points: targeted ? 3 : 1, text: targeted ? `Targets ${comp?.name_en ?? c.competency_id} specifically` : `Covers ${comp?.name_en ?? c.competency_id} among ${iv.competency_ids.length} competencies` });
    }

    for (const f of factors) {
      if (FACTOR_FIT[f.factor]?.ids.includes(iv.id) && f.share > 0) {
        const pts = f.share >= 0.6 ? 3 : f.share >= 0.3 ? 2 : 1;
        reasons.push({ points: pts, text: `${FACTOR_FIT[f.factor].why} — ${f.label}` });
      }
    }

    if (iv.evidence.status === 'sourced_summary_verify') reasons.push({ points: 1, text: 'Cites published evidence (flagged: verify before production)' });

    const h = history.get(iv.id) ?? EMPTY_HISTORY;
    if (h.evaluated >= 3) {
      const rate = h.improved / h.evaluated;
      if (rate >= 0.5) reasons.push({ points: 1, text: `In this ledger, ${h.improved} of ${h.evaluated} evaluated uses showed a gain` });
      else risks.push({ level: 'warn', text: `In this ledger, only ${h.improved} of ${h.evaluated} evaluated uses showed a gain` });
    }

    // Feasibility risks read straight off the diagnosis.
    const teacherLoss = factors.find((f) => f.factor === 'teacher_transfer')?.share ?? 0;
    if (teacherLoss >= 0.5 && ['INT-01', 'INT-02', 'INT-07', 'INT-15', 'INT-17'].includes(iv.id)) {
      risks.push({ level: 'crit', text: `Relies on a teacher in post, but ${Math.round(teacherLoss * 100)}% of driver schools lost one` });
    }
    const visitGap = factors.find((f) => f.factor === 'visit_gap')?.share ?? 0;
    if (visitGap >= 0.5 && ['INT-01', 'INT-02', 'INT-08'].includes(iv.id)) {
      risks.push({ level: 'warn', text: 'Needs CRC follow-up, and most driver schools have had no visit for 60+ days' });
    }
    if (iv.lever === 'pab') risks.push({ level: 'warn', text: 'Needs PAB sanction — cannot start this cycle' });

    return {
      intervention: iv, eligible, excludedBecause,
      points: eligible ? reasons.reduce((t, r) => t + r.points, 0) : 0,
      reasons, risks, authority: authorityFor(s, iv.lever), history: h,
      isCurrentPlan: current?.intervention_id === iv.id,
    };
  });

  matches.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.points - a.points || a.intervention.id.localeCompare(b.intervention.id));
  return { caseTitle: c.title, factors, matches };
}

// ---------------------------------------------------------------- what-if feasibility
export interface Constraints {
  schools: number;
  /**
   * Counts from the plan's own schools (UDISE+ enrolment of the case's class, teachers in
   * position, composite schools), when known. Without them a per-child cost assumes 30 children
   * a school and a per-teacher cost 2 teachers a school, and says so.
   */
  children?: number | null;
  teachers?: number | null;
  compositeSchools?: number | null;
  budgetInr: number | null;
  teachersAvailable: number | null;
  weeksAvailable: number | null;
  attendancePct: number | null;
  trainingComplete: boolean;
  connectivity: boolean;
}

export interface FeasibilityCheck { key: string; label: string; status: 'ok' | 'warn' | 'fail' | 'unknown'; detail: string }

/**
 * Delivery feasibility under constraints. It reports whether the plan can be *delivered* as
 * designed — cost, staff, time, attendance, readiness. It does not and cannot predict a
 * learning outcome; that is what the pre-registered outcome check is for.
 */
export function feasibility(iv: Intervention, c: Constraints): { checks: FeasibilityCheck[]; totalCost: number | null; verdict: 'feasible' | 'at_risk' | 'not_feasible' } {
  const checks: FeasibilityCheck[] = [];
  const cb = iv.cost_basis;
  const unit = cb.unit;
  const perSchool = /per school/.test(unit);
  const perCase = /per case/.test(unit);
  const perTeacher = /per teacher/.test(unit);
  const perChild = /per child/.test(unit);
  const composite = Math.min(c.schools, Math.max(0, c.compositeSchools ?? 0));
  const children = c.children ?? c.schools * 30;
  const teachers = c.teachers ?? c.schools * 2;
  const totalCost = perSchool ? cb.amount_inr * (c.schools - composite) + (cb.amount_composite_inr ?? cb.amount_inr) * composite
    : perCase ? cb.amount_inr
    : perTeacher ? cb.amount_inr * teachers
    : perChild ? cb.amount_inr * children
    : cb.amount_inr;
  const real = !cb.illustrative && !!cb.citation;
  const basisText = real
    ? `UP PAB 2025-26 ${cb.basis === 'pab' ? 'unit cost' : 'rate from the nearest line'} (PDF p. ${cb.citation!.pdf_page})`
    : 'Illustrative cost';
  const countText = perTeacher ? (c.teachers != null ? `, ${teachers} teachers in position (UDISE+)` : ', assuming 2 teachers per school')
    : perChild ? (c.children != null ? `, ${children} children in the class (UDISE+ enrolment)` : ', assuming 30 children per school')
    : perSchool && composite ? `, ${composite} composite school${composite === 1 ? '' : 's'}` : '';

  if (c.budgetInr === null) checks.push({ key: 'budget', label: 'Budget', status: 'unknown', detail: `${basisText} ₹${totalCost.toLocaleString('en-IN')} (${unit}${countText}). No budget entered.` });
  else if (totalCost <= c.budgetInr) checks.push({ key: 'budget', label: 'Budget', status: 'ok', detail: `₹${totalCost.toLocaleString('en-IN')} fits within ₹${c.budgetInr.toLocaleString('en-IN')}.` });
  else {
    const affordable = perSchool && cb.amount_inr > 0 ? Math.floor(c.budgetInr / cb.amount_inr) : 0;
    checks.push({ key: 'budget', label: 'Budget', status: affordable > 0 ? 'warn' : 'fail', detail: `Needs ₹${totalCost.toLocaleString('en-IN')}; budget is ₹${c.budgetInr.toLocaleString('en-IN')}.${affordable > 0 ? ` Covers ${affordable} of ${c.schools} schools — the rest would need a second phase.` : ''}` });
  }

  const teacherLed = ['INT-01', 'INT-02', 'INT-07', 'INT-13', 'INT-15', 'INT-17', 'INT-08'].includes(iv.id);
  if (c.teachersAvailable === null) checks.push({ key: 'staff', label: 'Staff', status: 'unknown', detail: teacherLed ? 'Teacher-led: needs at least one teacher per school for the dedicated period.' : 'No staffing figure entered.' });
  else if (teacherLed) {
    checks.push(c.teachersAvailable >= c.schools
      ? { key: 'staff', label: 'Staff', status: 'ok', detail: `${c.teachersAvailable} teachers for ${c.schools} schools.` }
      : { key: 'staff', label: 'Staff', status: c.teachersAvailable === 0 ? 'fail' : 'warn', detail: `Only ${c.teachersAvailable} teachers for ${c.schools} schools; ${c.schools - c.teachersAvailable} school(s) cannot run it without a deputation (INT-11).` });
  } else checks.push({ key: 'staff', label: 'Staff', status: 'ok', detail: 'Not dependent on classroom teacher time.' });

  if (iv.duration_weeks === 0) checks.push({ key: 'time', label: 'Delivery window', status: 'warn', detail: 'PAB proposal: no in-cycle delivery; benefits start after sanction.' });
  else if (c.weeksAvailable === null) checks.push({ key: 'time', label: 'Delivery window', status: 'unknown', detail: `Designed for ${iv.duration_weeks} weeks.` });
  else if (c.weeksAvailable >= iv.duration_weeks) checks.push({ key: 'time', label: 'Delivery window', status: 'ok', detail: `${c.weeksAvailable} weeks available; ${iv.duration_weeks} needed.` });
  else checks.push({ key: 'time', label: 'Delivery window', status: c.weeksAvailable >= iv.duration_weeks * 0.6 ? 'warn' : 'fail', detail: `${c.weeksAvailable} of ${iv.duration_weeks} weeks — ${Math.round((100 * c.weeksAvailable) / iv.duration_weeks)}% of the designed dose. Fidelity would be reduced.` });

  if (c.attendancePct === null) checks.push({ key: 'attendance', label: 'Attendance', status: 'unknown', detail: 'No attendance assumption entered.' });
  else if (c.attendancePct >= 75) checks.push({ key: 'attendance', label: 'Attendance', status: 'ok', detail: `${c.attendancePct}% average attendance.` });
  else checks.push({ key: 'attendance', label: 'Attendance', status: c.attendancePct >= 60 ? 'warn' : 'fail', detail: `${c.attendancePct}% attendance: many children would miss sessions. Consider pairing with an attendance drive (INT-09).` });

  const needsTraining = iv.steps.some((st) => /train|orient/i.test(st)) || /training|orientation/i.test(iv.name);
  checks.push(needsTraining && !c.trainingComplete
    ? { key: 'training', label: 'Training', status: 'warn', detail: 'This card includes a training or orientation step that is not yet complete.' }
    : { key: 'training', label: 'Training', status: 'ok', detail: needsTraining ? 'Training marked complete.' : 'No training prerequisite.' });

  const needsConnectivity = iv.resources.some((r) => /phone|app|online|digital|video/i.test(r));
  checks.push(needsConnectivity && !c.connectivity
    ? { key: 'connectivity', label: 'Connectivity', status: 'warn', detail: 'Some listed resources assume a phone or data connection.' }
    : { key: 'connectivity', label: 'Connectivity', status: 'ok', detail: needsConnectivity ? 'Connectivity available.' : 'Works offline.' });

  const verdict = checks.some((x) => x.status === 'fail') ? 'not_feasible' : checks.some((x) => x.status === 'warn') ? 'at_risk' : 'feasible';
  return { checks, totalCost, verdict };
}

export function compareRows(ids: string[]): Intervention[] {
  return ids.map((id) => intervention(id)).filter((x): x is Intervention => Boolean(x)).slice(0, 3);
}
