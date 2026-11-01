// Canonical domain types. One file, shared by the seed generator, the Next.js app and the
// Postgres schema (sql/schema.sql mirrors these names column for column).

export type ID = string;
export type ISODate = string; // 'YYYY-MM-DD'
export type ISOTime = string; // ISO-8601 UTC timestamp

/** Where a record came from. Never label fictional rows as public or partner data. */
export type Provenance = 'synthetic_demo' | 'public_historical' | 'partner_provided' | 'user_uploaded';

export type RoleCode = 'beo' | 'brc' | 'crc' | 'headmaster' | 'deo' | 'state_admin' | 'auditor' | 'demo_admin';
export type ScopeType = 'state' | 'district' | 'block' | 'cluster' | 'school';
export type Lever = 'block' | 'district' | 'pab';
export type Severity = 'critical' | 'high' | 'medium';
export type Language = 'en' | 'hi';
export type Channel = 'app' | 'whatsapp' | 'ivr' | 'sms';

export type CaseStatus =
  | 'detected'
  | 'under_investigation'
  | 'awaiting_approval'
  | 'revision_requested'
  | 'approved'
  | 'assigned'
  | 'in_progress'
  | 'awaiting_verification'
  | 'outcome_pending'
  | 'closed'
  | 'reopened'
  | 'referred_pab'
  | 'dismissed';

export type TaskStatus = 'assigned' | 'acknowledged' | 'in_progress' | 'submitted' | 'verified' | 'sent_back' | 'cancelled';
export type EvidenceStatus = 'pending' | 'verified' | 'rejected';
export type OutcomeCategory =
  | 'improved_confirmed'
  | 'improved_indicative'
  | 'below_target'
  | 'no_change'
  | 'worsened'
  | 'inconclusive';

// ---------- geography ----------
export interface State { id: ID; name: string; provenance: Provenance }
export interface District { id: ID; state_id: ID; name: string; code: string; provenance: Provenance }
export interface Block { id: ID; district_id: ID; name: string; code: string; provenance: Provenance }
export interface Cluster { id: ID; block_id: ID; district_id: ID; name: string; provenance: Provenance }

export interface School {
  id: ID;
  name: string;
  village: string;
  category: 'primary' | 'upper_primary' | 'composite';
  grades_served: number[];
  state_id: ID;
  district_id: ID;
  block_id: ID;
  cluster_id: ID;
  enrolment_total: number;
  enrolment_g1: number;
  enrolment_g2: number;
  enrolment_g3: number;
  teachers_sanctioned: number;
  teachers_in_position: number; // as of seed date, after staff events
  ptr: number; // pupil-teacher ratio as of seed date
  provenance: Provenance;
  source_ref: string;
  created_at: ISOTime;
}

// ---------- people ----------
export interface User {
  id: ID;
  full_name: string;
  email: string;
  preferred_language: Language;
  preferred_channel: Channel;
  is_demo_account: boolean;
  status: 'active' | 'inactive';
  created_at: ISOTime;
  provenance: Provenance;
}

export interface UserRole {
  id: ID;
  user_id: ID;
  role: RoleCode;
  scope_type: ScopeType;
  scope_id: ID;
  granted_at: ISOTime;
  granted_by: ID | null;
}

// ---------- reference data ----------
export interface Competency { id: ID; code: string; domain: 'literacy' | 'numeracy'; name_en: string; name_hi: string }

export interface MetricDefinition {
  id: ID;
  name: string;
  definition: string;
  unit: 'percent';
  numerator: string;
  denominator: string;
  higher_is_better: boolean;
  caveats: string;
  version: number;
}

export interface AssessmentRound {
  id: ID;
  code: string;
  label: string;
  academic_year: string;
  round_type: 'baseline' | 'midline' | 'endline';
  window_start: ISODate;
  window_end: ISODate;
  import_date: ISODate | null;
  status: 'completed' | 'scheduled';
  instrument_note: string;
}

export interface DetectionSettings {
  materiality_pp: number;
  z_threshold: number;
  min_cluster_assessed: number;
  min_school_reporting_share: number;
  min_participation: number;
  driver_cumulative_share: number;
  max_driver_schools: number;
  severity_critical_pp: number;
  severity_high_pp: number;
}

export interface OutcomeSettings {
  success_threshold_pp: number;
  participation_floor_ratio: number;
  min_participation: number;
  comparison_schools_per_treated: number;
}

export interface SettingVersion {
  id: ID;
  version: number;
  effective_from: ISODate;
  detection: DetectionSettings;
  outcome: OutcomeSettings;
  reminders: { reminder_days_before_due: number; escalation_days_overdue: number };
  diagnosis: { visit_gap_days: number; attendance_drop_pp: number; teacher_transfer_window_days: number; ptr_threshold: number };
  closure_rules: string[];
  change_note: string;
  changed_by: ID;
  created_at: ISOTime;
}

// ---------- data pipeline ----------
export interface Dataset {
  id: ID;
  name: string;
  description: string;
  provenance: Provenance;
  refresh_cadence: string;
  owner_role: RoleCode;
  last_import_batch_id: ID | null;
  last_updated_at: ISOTime | null;
  source_note: string;
}

export interface ImportBatch {
  id: ID;
  dataset_id: ID;
  file_name: string;
  scope_type: ScopeType;
  scope_id: ID;
  round_id: ID | null;
  uploaded_by: ID;
  uploaded_at: ISOTime;
  status: 'committed' | 'committed_with_rejections' | 'failed';
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  warnings: number;
  error_summary: string | null;
  committed_at: ISOTime | null;
  provenance: Provenance;
}

export interface ImportRejectedRow {
  id: ID;
  import_batch_id: ID;
  row_number: number;
  raw: Record<string, string>;
  error_code: 'unknown_school_id' | 'proficient_exceeds_assessed' | 'duplicate_row' | 'invalid_date' | 'missing_required' | 'non_numeric';
  message: string;
}

export interface AssessmentResult {
  id: ID;
  round_id: ID;
  school_id: ID;
  grade: number;
  competency_id: ID;
  metric_id: ID;
  enrolled: number;
  n_assessed: number;
  n_proficient: number;
  pct_proficient: number; // 0-100, one decimal
  participation_rate: number; // 0-1
  dq_flags: string[];
  import_batch_id: ID;
  provenance: Provenance;
}

export interface AttendanceMonthly {
  id: ID;
  school_id: ID;
  month: string; // YYYY-MM
  working_days: number;
  avg_attendance_pct: number;
  import_batch_id: ID;
  provenance: Provenance;
}

export interface StaffEvent {
  id: ID;
  school_id: ID;
  event_type: 'transfer_out' | 'joined';
  event_date: ISODate;
  teacher_ref: string; // pseudonymous
  import_batch_id: ID;
  provenance: Provenance;
}

// ---------- detection & diagnosis ----------
export interface DqCheck { check: string; value: number; threshold: number; passed: boolean }

export interface DriverSchool {
  school_id: ID;
  prev_pct: number;
  curr_pct: number;
  change_pp: number;
  contribution_share: number; // 0-1 share of the cluster's excess drop
}

export interface Finding {
  id: ID;
  round_id: ID;
  prev_round_id: ID;
  district_id: ID;
  block_id: ID;
  cluster_id: ID;
  grade: number;
  competency_id: ID;
  metric_id: ID;
  prev_value_pct: number;
  curr_value_pct: number;
  change_pp: number;
  district_change_pp: number;
  relative_change_pp: number;
  z_score: number;
  n_prev: number;
  n_curr: number;
  schools_reporting: number;
  schools_total: number;
  participation_rate: number;
  dq_checks: DqCheck[];
  detection_method: string;
  thresholds: { materiality_pp: number; z_threshold: number };
  settings_version_id: ID;
  status: 'case_opened' | 'monitoring' | 'rejected_noise' | 'rejected_data_quality' | 'manual';
  case_id: ID | null;
  driver_schools: DriverSchool[];
  measured_prev_window_end: ISODate;
  measured_curr_window_end: ISODate;
  detected_at: ISOTime;
  severity: Severity;
  provenance: Provenance;
}

export type FactorCode = 'teacher_transfer' | 'visit_gap' | 'attendance_drop' | 'high_ptr';

export interface FactorObservation {
  factor: FactorCode;
  school_id: ID;
  value: number;
  unit: string;
  threshold: number;
  flagged: boolean;
  source_table: string;
  source_record_ids: ID[];
}

export interface Diagnosis {
  id: ID;
  case_id: ID;
  finding_id: ID | null;
  observations: FactorObservation[]; // observed facts per driver school
  ranked_factors: { factor: FactorCode; label: string; schools_flagged: number; of_driver_schools: number; rank: number }[]; // association, not cause
  ai_hypothesis: string; // labelled AI-generated hypothesis
  ai_hypothesis_model: string;
  human_conclusion: string | null; // officer's own note
  human_conclusion_by: ID | null;
  created_at: ISOTime;
  method_note: string;
}

// ---------- interventions ----------
export interface TaskTemplate {
  key: string;
  title_en: string;
  title_hi: string;
  owner_role: RoleCode;
  per_school: boolean;
  duration_days: number;
  proof_type: EvidenceType;
  proof_count: number;
  cross_source: boolean;
}

export interface Intervention {
  id: ID;
  name: string;
  category: 'numeracy' | 'literacy' | 'attendance' | 'teacher_support' | 'staffing' | 'materials';
  domains: ('literacy' | 'numeracy')[];
  grades: number[];
  competency_ids: ID[];
  description: string;
  steps: string[];
  resources: string[];
  duration_weeks: number;
  lever: Lever;
  /**
   * The seed's cards carry an illustrative cost. Where a card maps to a line of the UP PAB
   * 2025-26 minutes, the app's real-data layer replaces it with that unit cost and its page
   * (basis 'pab'), or with a neighbouring line's rate, said so (basis 'pab_proxy').
   */
  cost_basis: {
    amount_inr: number; unit: string; note: string; illustrative: boolean;
    basis?: 'pab' | 'pab_proxy'; per?: 'child_in_class' | 'teacher' | 'school'; amount_composite_inr?: number | null; note_hi?: string;
    citation?: { doc: string; url: string; pdf_page: number; printed_page: string; line: string };
    illustrative_original?: { amount_inr: number; unit: string } | null;
  };
  evidence: {
    status: 'sourced_summary_verify' | 'illustrative';
    summary: string;
    source_title: string | null;
    source_url: string | null;
    effect_size_text: string | null;
  };
  delivery_conditions: string[];
  limitations: string[];
  success_metric: string;
  required_evidence: string[];
  task_templates: TaskTemplate[];
  version: number;
  review_date: ISODate;
  provenance: Provenance;
}

// ---------- the case ledger ----------
export interface Case {
  id: ID;
  title: string;
  origin: 'detected' | 'manual';
  finding_id: ID | null;
  diagnosis_id: ID | null;
  state_id: ID;
  district_id: ID;
  block_id: ID;
  cluster_id: ID;
  school_ids: ID[]; // driver schools
  grade: number;
  competency_id: ID;
  severity: Severity;
  lever: Lever;
  status: CaseStatus;
  owner_user_id: ID; // accountable officer
  current_plan_id: ID | null;
  created_at: ISOTime;
  updated_at: ISOTime;
  due_date: ISODate | null;
  verification_status: 'not_started' | 'pending' | 'partially_verified' | 'verified';
  reopen_count: number;
  closure_type: OutcomeCategory | null;
  closed_at: ISOTime | null;
  pab_cycle: string | null;
  provenance: Provenance;
}

export interface CasePlan {
  id: ID;
  case_id: ID;
  cycle: number;
  version: number;
  intervention_id: ID;
  alternatives: ID[];
  school_ids: ID[];
  rationale: string;
  drafted_by: 'ai_draft' | 'officer';
  ai_model: string | null;
  pre_registration: {
    grade: number;
    competency_id: ID;
    metric_id: ID;
    baseline_round_id: ID;
    followup_round_id: ID;
    comparison_school_ids: ID[];
    success_threshold_pp: number;
    participation_floor_ratio: number;
    settings_version_id: ID;
  } | null;
  estimated_cost_inr: number;
  cost_is_illustrative: boolean;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'revision_requested' | 'superseded' | 'referred_pab';
  created_at: ISOTime;
  created_by: ID;
}

export interface Approval {
  id: ID;
  case_id: ID;
  plan_id: ID;
  required_role: RoleCode;
  submitted_by: ID;
  submitted_at: ISOTime;
  decision: 'pending' | 'approved' | 'approved_with_edits' | 'rejected' | 'revision_requested' | 'approved_for_pab';
  decided_by: ID | null;
  decided_at: ISOTime | null;
  reason: string | null;
  original_plan: Record<string, unknown>;
  edited_plan: Record<string, unknown> | null;
  ai_drafted: boolean;
}

export type EvidenceType =
  | 'spot_assessment_sheet'
  | 'spot_check_sheet'
  | 'photo_attendance_register'
  | 'visit_log'
  | 'contact_log'
  | 'training_attendance'
  | 'tlm_receipt'
  | 'order_copy'
  | 'joining_report'
  | 'photo_lesson_plan';

export interface Task {
  id: ID;
  case_id: ID;
  plan_id: ID;
  cycle: number;
  template_key: string;
  title_en: string;
  title_hi: string;
  school_id: ID | null;
  owner_user_id: ID;
  owner_role: RoleCode;
  proof_type: EvidenceType;
  proof_count: number;
  cross_source: boolean;
  status: TaskStatus;
  assigned_at: ISOTime;
  due_date: ISODate;
  original_due_date: ISODate;
  acknowledged_at: ISOTime | null;
  started_at: ISOTime | null;
  submitted_at: ISOTime | null; // final submission
  verified_at: ISOTime | null;
  reminder_sent_at: ISOTime | null;
  escalated_at: ISOTime | null;
  is_overdue: boolean; // derived as of seed date; recomputed by the app
  reassigned_from: ID | null;
  reassign_reason: string | null;
  deadline_change_reason: string | null;
}

export interface Evidence {
  id: ID;
  task_id: ID;
  case_id: ID;
  school_id: ID | null;
  evidence_type: EvidenceType;
  file_name: string | null;
  sha256: string | null;
  visit_id: ID | null;
  summary: Record<string, unknown>;
  submitted_by: ID;
  submitted_role: RoleCode;
  submitted_at: ISOTime;
  gps_status: 'matched' | 'not_captured' | 'outside_radius';
  channel: Channel;
  status: EvidenceStatus;
  verified_by: ID | null;
  verified_at: ISOTime | null;
  verification_method: 'desk_review' | 'spot_check_visit' | 'cross_source_assessment' | null;
  rejection_reason: string | null;
  provenance: Provenance;
}

export interface Visit {
  id: ID;
  school_id: ID;
  visitor_user_id: ID;
  visitor_role: RoleCode;
  visit_date: ISODate;
  purpose: 'routine' | 'coaching' | 'spot_assessment' | 'spot_check' | 'task_follow_up';
  case_id: ID | null;
  task_id: ID | null;
  checklist: { item: string; done: boolean }[];
  notes: string;
  gps_status: 'matched' | 'not_captured' | 'outside_radius';
  sync_status: 'synced' | 'pending_sync';
  logged_at: ISOTime;
  provenance: Provenance;
}

export interface OutcomeSchoolRow {
  school_id: ID;
  baseline_pct: number | null;
  followup_pct: number | null;
  baseline_n: number;
  followup_n: number;
  baseline_participation: number | null;
  followup_participation: number | null;
}

export interface OutcomeEvaluation {
  id: ID;
  case_id: ID;
  plan_id: ID;
  cycle: number;
  grade: number;
  competency_id: ID;
  baseline_round_id: ID;
  followup_round_id: ID;
  treated: OutcomeSchoolRow[];
  comparison: OutcomeSchoolRow[];
  treated_baseline_mean: number | null;
  treated_followup_mean: number | null;
  comparison_baseline_mean: number | null;
  comparison_followup_mean: number | null;
  treated_change_pp: number | null;
  comparison_change_pp: number | null;
  did_pp: number | null;
  ci_low_pp: number | null;
  ci_high_pp: number | null;
  ci_method: string;
  success_threshold_pp: number;
  participation_check: { treated_baseline: number | null; treated_followup: number | null; floor: number; passed: boolean };
  category: OutcomeCategory;
  delivery_verified: boolean;
  cross_source_verified: boolean;
  closure_eligible: boolean;
  closure_blockers: string[];
  interpretation_note: string;
  is_illustrative: boolean;
  settings_version_id: ID;
  evaluated_at: ISOTime;
  reviewed_by: ID | null;
  reviewed_at: ISOTime | null;
}

export interface CaseEvent {
  id: ID;
  case_id: ID;
  ts: ISOTime;
  actor_user_id: ID | null;
  actor_label: string;
  kind: string;
  summary: string;
  from_status: CaseStatus | null;
  to_status: CaseStatus | null;
  related_entity: string | null;
}

export interface Notification {
  id: ID;
  user_id: ID;
  ts: ISOTime;
  kind:
    | 'approval_request'
    | 'assignment'
    | 'acknowledgement'
    | 'deadline_upcoming'
    | 'task_overdue'
    | 'escalation'
    | 'evidence_submitted'
    | 'evidence_rejected'
    | 'outcome_available'
    | 'case_closed'
    | 'case_reopened'
    | 'import_succeeded'
    | 'import_failed'
    | 'report_generated';
  title: string;
  body: string;
  entity_type: string;
  entity_id: ID;
  link: string;
  read_at: ISOTime | null;
}

export interface OutboxMessage {
  id: ID;
  user_id: ID;
  channel: Exclude<Channel, 'app'>;
  ts: ISOTime;
  template: string;
  language: Language;
  body: string;
  entity_type: string;
  entity_id: ID;
  delivery_status: 'simulated_not_sent';
}

export interface Report {
  id: ID;
  report_type: 'atr' | 'review_pack' | 'district_escalation' | 'overdue_tasks' | 'learning_outcome' | 'data_quality' | 'executive_brief';
  title: string;
  scope_type: ScopeType;
  scope_id: ID;
  period_start: ISODate;
  period_end: ISODate;
  generated_at: ISOTime;
  generated_by: ID;
  case_ids: ID[];
  content: Record<string, unknown>;
  narrative_model: string | null;
  formats: ('csv' | 'pdf')[];
  demo_disclaimer: boolean;
}

export interface AIInteraction {
  id: ID;
  ts: ISOTime;
  user_id: ID | null;
  role: RoleCode | 'system';
  kind: 'draft_plan' | 'explain_finding' | 'draft_atr' | 'translate_hi' | 'executive_brief' | 'ask' | 'summarise_report';
  model: string;
  template_version: string;
  referenced_ids: ID[];
  input_summary: string;
  output_summary: string;
  status: 'ok' | 'blocked_unverified_number' | 'error';
  auditor_verdict: 'pass' | 'fail' | 'not_applicable';
  reviewer_decision: 'accepted' | 'edited' | 'rejected' | null;
}

export interface AuditEvent {
  id: ID;
  ts: ISOTime;
  actor_user_id: ID | null;
  actor_label: string; // user id or system process name
  actor_role: RoleCode | 'system';
  action: string;
  entity_type: string;
  entity_id: ID;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  correlation_id: string;
  source: 'web' | 'mobile' | 'whatsapp_sim' | 'ivr_sim' | 'system' | 'import';
  result: 'success' | 'failure';
  prev_hash: string;
  hash: string;
  hash_version: 'ts-json-v1' | 'sql-v1'; // seed rows hashed in TS; live rows hashed by append_audit() in SQL
}

export interface SystemJob {
  id: ID;
  job_type: 'reminder_sweep' | 'detection_run' | 'outcome_run' | 'briefing_build' | 'channel_dispatch' | 'import_validation';
  started_at: ISOTime;
  finished_at: ISOTime;
  status: 'succeeded' | 'failed' | 'skipped';
  summary: Record<string, unknown>;
  error: string | null;
}
