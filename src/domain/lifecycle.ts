import type { CaseStatus, OutcomeCategory, RoleCode } from './types';

export const CASE_STATUSES: readonly CaseStatus[] = [
  'detected',
  'under_investigation',
  'awaiting_approval',
  'revision_requested',
  'approved',
  'assigned',
  'in_progress',
  'awaiting_verification',
  'outcome_pending',
  'closed',
  'reopened',
  'referred_pab',
  'dismissed',
] as const;

/** The only legal moves. Anything else is refused by the server and by the seed validator. */
export const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  detected: ['under_investigation', 'dismissed'],
  under_investigation: ['awaiting_approval', 'dismissed'],
  awaiting_approval: ['approved', 'revision_requested', 'under_investigation', 'referred_pab'],
  revision_requested: ['awaiting_approval'],
  approved: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['awaiting_verification'],
  awaiting_verification: ['in_progress', 'outcome_pending'],
  outcome_pending: ['closed', 'reopened'],
  reopened: ['awaiting_approval'],
  closed: ['reopened'],
  referred_pab: ['under_investigation'],
  dismissed: ['under_investigation'],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Who may make each legal move. A move missing from this table is refused for everyone, so a
 * new transition has no authority until someone decides who holds it. Seeing a case (a
 * headmaster whose school is in it, a task owner, an auditor) is never authority over it.
 * Plan decisions are narrowed further by the lever, and approval by maker ≠ checker.
 */
export const TRANSITION_ROLES: Readonly<Record<string, readonly RoleCode[]>> = {
  'detected>under_investigation': ['beo', 'deo'],
  'detected>dismissed': ['beo', 'deo'],
  'under_investigation>awaiting_approval': ['beo', 'deo'],
  'under_investigation>dismissed': ['beo', 'deo'],
  'awaiting_approval>approved': ['beo', 'deo', 'state_admin'],
  'awaiting_approval>revision_requested': ['beo', 'deo', 'state_admin'],
  'awaiting_approval>under_investigation': ['beo', 'deo', 'state_admin'],
  'awaiting_approval>referred_pab': ['beo', 'deo', 'state_admin'],
  'revision_requested>awaiting_approval': ['beo', 'deo'],
  'approved>assigned': ['beo', 'deo'],
  'assigned>in_progress': ['beo', 'deo'],
  'in_progress>awaiting_verification': ['beo', 'deo'],
  'awaiting_verification>in_progress': ['beo', 'deo'],
  'awaiting_verification>outcome_pending': ['beo', 'deo'],
  'outcome_pending>closed': ['beo', 'deo'],
  'outcome_pending>reopened': ['beo', 'deo', 'state_admin'],
  'reopened>awaiting_approval': ['beo', 'deo'],
  'closed>reopened': ['beo', 'deo', 'state_admin'],
  'referred_pab>under_investigation': ['deo', 'state_admin'],
  'dismissed>under_investigation': ['beo', 'deo'],
};

export function rolesForTransition(from: CaseStatus, to: CaseStatus): readonly RoleCode[] {
  return TRANSITION_ROLES[`${from}>${to}`] ?? [];
}

/** The moves that decide a submitted plan, and the subset that approve it. */
export const isPlanDecision = (from: CaseStatus, to: CaseStatus): boolean =>
  from === 'awaiting_approval' && ['approved', 'revision_requested', 'under_investigation', 'referred_pab'].includes(to);
export const isPlanApproval = (from: CaseStatus, to: CaseStatus): boolean =>
  from === 'awaiting_approval' && (to === 'approved' || to === 'referred_pab');

/** Moves that always need a written reason. */
export const REASON_REQUIRED: readonly [CaseStatus, CaseStatus][] = [
  ['awaiting_approval', 'under_investigation'], // plan rejected
  ['awaiting_approval', 'revision_requested'],
  ['outcome_pending', 'reopened'],
  ['closed', 'reopened'],
  ['detected', 'dismissed'],
  ['under_investigation', 'dismissed'],
  ['awaiting_verification', 'in_progress'], // evidence sent back
];

export function reasonRequired(from: CaseStatus, to: CaseStatus): boolean {
  return REASON_REQUIRED.some(([a, b]) => a === from && b === to);
}

export const STATUS_LABELS: Record<CaseStatus, { en: string; hi: string; tone: 'neutral' | 'pending' | 'active' | 'good' | 'warn' | 'critical' }> = {
  detected: { en: 'New finding', hi: 'नया निष्कर्ष', tone: 'neutral' },
  under_investigation: { en: 'Being looked into', hi: 'जाँच चल रही है', tone: 'pending' },
  awaiting_approval: { en: 'Waiting for approval', hi: 'स्वीकृति की प्रतीक्षा', tone: 'pending' },
  revision_requested: { en: 'Sent back for changes', hi: 'बदलाव के लिए लौटाया गया', tone: 'warn' },
  approved: { en: 'Plan approved', hi: 'योजना स्वीकृत', tone: 'active' },
  assigned: { en: 'Work assigned', hi: 'काम सौंपा गया', tone: 'active' },
  in_progress: { en: 'Work under way', hi: 'काम जारी है', tone: 'active' },
  awaiting_verification: { en: 'Proof being checked', hi: 'सबूत की जाँच हो रही है', tone: 'pending' },
  outcome_pending: { en: 'Waiting for next assessment', hi: 'अगले आकलन की प्रतीक्षा', tone: 'pending' },
  closed: { en: 'Closed — improvement verified', hi: 'बंद — सुधार सत्यापित', tone: 'good' },
  reopened: { en: 'Reopened', hi: 'फिर से खोला गया', tone: 'critical' },
  referred_pab: { en: 'Sent to PAB', hi: 'PAB को भेजा गया', tone: 'neutral' },
  dismissed: { en: 'Dismissed', hi: 'ख़ारिज', tone: 'neutral' },
};

export const OPEN_STATUSES: readonly CaseStatus[] = CASE_STATUSES.filter(
  (s) => !['closed', 'referred_pab', 'dismissed'].includes(s),
);

export interface ClosureInput {
  allTasksVerified: boolean;
  crossSourceVerified: boolean;
  outcomeCategory: OutcomeCategory | null;
  participationPassed: boolean;
}

/** A case closes only on proof: delivery verified, a second source, and a measured gain. */
export function closureEligibility(i: ClosureInput): { eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!i.allTasksVerified) blockers.push('Not every task has verified evidence');
  if (!i.crossSourceVerified) blockers.push('No independent (cross-source) verification yet');
  if (i.outcomeCategory === null) blockers.push('No outcome evaluation yet');
  else if (i.outcomeCategory !== 'improved_confirmed' && i.outcomeCategory !== 'improved_indicative')
    blockers.push(`Outcome is "${i.outcomeCategory.replace('_', ' ')}", not an improvement`);
  if (!i.participationPassed) blockers.push('Follow-up participation fell below the floor');
  return { eligible: blockers.length === 0, blockers };
}
