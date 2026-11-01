import type { RoleCode } from './types';

export const ACTIONS = [
  'case.view',
  'case.create',
  'case.edit_diagnosis',
  'plan.approve_block',
  'plan.approve_district_or_pab',
  'plan.reject_or_revise',
  'task.assign',
  'task.update_own',
  'evidence.submit_own',
  'evidence.verify',
  'outcome.recompute',
  'case.close',
  'case.reopen',
  'data.import',
  'report.export',
  'audit.view',
  'ai.executive_briefing',
  'ai.assistant',
  'settings.configure',
  'users.manage',
  'api.manage_keys',
  'feedback.review',
  'demo.reset',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * 'yes'  = allowed within the role's scope
 * 'own'  = only records assigned to / submitted by this user
 * 'spot' = only spot-check verification of other people's evidence
 * 'propose' = can propose, a BEO decides
 * 'raise' = can raise a field concern that a BEO may promote to a case
 * 'no'
 */
export type Grant = 'yes' | 'own' | 'spot' | 'propose' | 'raise' | 'no';

export const MATRIX: Record<Action, Record<RoleCode, Grant>> = {
  'case.view':                   { beo: 'yes', brc: 'yes', crc: 'yes', headmaster: 'own', deo: 'yes', state_admin: 'yes', auditor: 'yes', demo_admin: 'yes' },
  'case.create':                 { beo: 'yes', brc: 'no', crc: 'raise', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  'case.edit_diagnosis':         { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'no', auditor: 'no', demo_admin: 'yes' },
  'plan.approve_block':          { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'plan.approve_district_or_pab':{ beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'no' },
  'plan.reject_or_revise':       { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'no' },
  'task.assign':                 { beo: 'yes', brc: 'propose', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'task.update_own':             { beo: 'no', brc: 'own', crc: 'own', headmaster: 'own', deo: 'no', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'evidence.submit_own':         { beo: 'no', brc: 'own', crc: 'own', headmaster: 'own', deo: 'own', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'evidence.verify':             { beo: 'yes', brc: 'yes', crc: 'spot', headmaster: 'no', deo: 'yes', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'outcome.recompute':           { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'no' },
  'case.close':                  { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'no', auditor: 'no', demo_admin: 'no' },
  'case.reopen':                 { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'no' },
  'data.import':                 { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  'report.export':               { beo: 'yes', brc: 'yes', crc: 'own', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'yes', demo_admin: 'yes' },
  'audit.view':                  { beo: 'yes', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'yes', demo_admin: 'yes' },
  'ai.executive_briefing':       { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'yes', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  'ai.assistant':                { beo: 'yes', brc: 'yes', crc: 'yes', headmaster: 'yes', deo: 'yes', state_admin: 'yes', auditor: 'yes', demo_admin: 'yes' },
  'settings.configure':          { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'no', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  'users.manage':                { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'no', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  // Read-only API keys for state dashboard systems (VSKs). State-level only: a key can read a
  // whole district or the state, so issuing one is a state decision.
  'api.manage_keys':             { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'no', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  // Reading what people said about the app (thumbs on Claude, the feedback form) and exporting
  // it. The state programme team runs the user testing; comments are not shared more widely.
  'feedback.review':             { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'no', state_admin: 'yes', auditor: 'no', demo_admin: 'yes' },
  'demo.reset':                  { beo: 'no', brc: 'no', crc: 'no', headmaster: 'no', deo: 'no', state_admin: 'no', auditor: 'no', demo_admin: 'yes' },
};

export function grantFor(role: RoleCode, action: Action): Grant {
  return MATRIX[action][role];
}

/** Coarse check; scope and ownership are checked separately against the record. */
export function can(role: RoleCode, action: Action): boolean {
  return grantFor(role, action) !== 'no';
}

export const ROLE_LABELS: Record<RoleCode, { en: string; hi: string; home: string; login: string }> = {
  beo: { en: 'Block Education Officer', hi: 'खंड शिक्षा अधिकारी', home: '/beo', login: '/login/block-officer' },
  brc: { en: 'Block Resource Coordinator', hi: 'खंड संसाधन समन्वयक', home: '/field', login: '/login/resource-coordinator' },
  crc: { en: 'Cluster Resource Coordinator', hi: 'संकुल संसाधन समन्वयक', home: '/field', login: '/login/resource-coordinator' },
  headmaster: { en: 'Headmaster', hi: 'प्रधानाध्यापक', home: '/school', login: '/login/headmaster' },
  deo: { en: 'District Education Officer', hi: 'ज़िला शिक्षा अधिकारी', home: '/district', login: '/login/district-officer' },
  state_admin: { en: 'State programme team', hi: 'राज्य कार्यक्रम दल', home: '/state', login: '/login/state' },
  auditor: { en: 'Auditor', hi: 'लेखा परीक्षक', home: '/audit', login: '/login/auditor' },
  demo_admin: { en: 'Demo administrator', hi: 'डेमो प्रशासक', home: '/admin', login: '/login/admin' },
};
