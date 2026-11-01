import 'server-only';
import { one } from './db';

/**
 * Has the round a plan is judged on arrived, with no outcome check run against it yet?
 *
 * A plan's pre-registration names its follow-up round at approval. When that round is imported
 * (Data import), the results are in the database but nothing re-checks the plan by itself: an
 * officer runs the check, so a person sees the verdict the moment it is made. This tells the
 * case page when to offer that check, and how much of the plan's schools the round covers.
 */
export interface OutcomeDue {
  roundId: string;
  roundCode: string;
  roundLabel: string;
  /** Plan schools with results for the plan's grade and competency in the follow-up round. */
  schoolsWithData: number;
  schoolsTotal: number;
  /** When the most recent batch carrying those results was committed. */
  arrivedAt: string | null;
}

export function outcomeCheckDue(caseId: string, planId: string | null): OutcomeDue | null {
  if (!planId) return null;
  const plan = one<{ school_ids: string; grade: number | null; competency_id: string | null; followup: string | null }>(
    `select school_ids,
            json_extract(pre_registration, '$.grade') grade,
            json_extract(pre_registration, '$.competency_id') competency_id,
            json_extract(pre_registration, '$.followup_round_id') followup
       from case_plans where id = ? and case_id = ?`,
    planId, caseId,
  );
  if (!plan?.followup || plan.grade == null || !plan.competency_id) return null;

  const already = one('select 1 from outcome_evaluations where case_id = ? and plan_id = ? and followup_round_id = ?', caseId, planId, plan.followup);
  if (already) return null;

  let schools: string[] = [];
  try { schools = JSON.parse(plan.school_ids) as string[]; } catch { schools = []; }
  if (schools.length === 0) return null;

  const q = schools.map(() => '?').join(',');
  const got = one<{ n: number; arrived: string | null }>(
    `select count(distinct r.school_id) n, max(b.committed_at) arrived
       from assessment_results r left join import_batches b on b.id = r.import_batch_id
      where r.round_id = ? and r.grade = ? and r.competency_id = ? and r.school_id in (${q})`,
    plan.followup, plan.grade, plan.competency_id, ...schools,
  );
  if (!got || got.n === 0) return null;

  const round = one<{ code: string; label: string }>('select code, label from assessment_rounds where id = ?', plan.followup);
  return {
    roundId: plan.followup,
    roundCode: round?.code ?? plan.followup,
    roundLabel: round?.label ?? '',
    schoolsWithData: got.n,
    schoolsTotal: schools.length,
    arrivedAt: got.arrived,
  };
}
