import type { CaseStatus } from '@domain/types';

/**
 * Presentation of the case lifecycle in seven plain stages. The underlying state machine
 * (src/domain/lifecycle) is unchanged — this only groups its statuses for display and names
 * the next action a reader should expect.
 */

export const STAGES = [
  { key: 'detected', en: 'Detected', hi: 'पहचान' },
  { key: 'investigation', en: 'Investigation', hi: 'जाँच' },
  { key: 'approval', en: 'Approval', hi: 'स्वीकृति' },
  { key: 'assignment', en: 'Assignment', hi: 'आवंटन' },
  { key: 'execution', en: 'Execution', hi: 'क्रियान्वयन' },
  { key: 'verification', en: 'Verification', hi: 'सत्यापन' },
  { key: 'closure', en: 'Closure', hi: 'समापन' },
] as const;

const STAGE_OF: Record<CaseStatus, number> = {
  detected: 0,
  under_investigation: 1, reopened: 1,
  awaiting_approval: 2, revision_requested: 2,
  approved: 3, assigned: 3,
  in_progress: 4,
  awaiting_verification: 5, outcome_pending: 5,
  closed: 6, referred_pab: 6, dismissed: 6,
};
export const stageIndex = (s: CaseStatus) => STAGE_OF[s] ?? 0;
/** The statuses that make up one stage, for filtering by stage. */
export const statusesForStage = (i: number): CaseStatus[] =>
  (Object.entries(STAGE_OF) as [CaseStatus, number][]).filter(([, v]) => v === i).map(([k]) => k);

const NEXT: Record<CaseStatus, { en: string; hi: string }> = {
  detected: { en: 'Start investigation', hi: 'जाँच शुरू करें' },
  reopened: { en: 'Re-investigate', hi: 'फिर से जाँचें' },
  under_investigation: { en: 'Submit plan for approval', hi: 'योजना स्वीकृति हेतु भेजें' },
  awaiting_approval: { en: 'Approve or revise plan', hi: 'योजना स्वीकृत/संशोधित करें' },
  revision_requested: { en: 'Revise and resubmit plan', hi: 'योजना संशोधित करें' },
  approved: { en: 'Assign field tasks', hi: 'कार्य सौंपें' },
  assigned: { en: 'Begin field work', hi: 'क्षेत्र कार्य शुरू करें' },
  in_progress: { en: 'Complete tasks with proof', hi: 'प्रमाण सहित कार्य पूरा करें' },
  awaiting_verification: { en: 'Verify submitted proof', hi: 'प्रमाण सत्यापित करें' },
  outcome_pending: { en: 'Wait for next assessment', hi: 'अगले आकलन की प्रतीक्षा' },
  closed: { en: 'None — closed', hi: 'कोई नहीं — बंद' },
  referred_pab: { en: 'Follow up with PAB', hi: 'PAB से अनुवर्ती' },
  dismissed: { en: 'None — dismissed', hi: 'कोई नहीं — खारिज' },
};
export const nextAction = (s: CaseStatus) => NEXT[s] ?? { en: '—', hi: '—' };
