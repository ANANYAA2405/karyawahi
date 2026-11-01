// Reference data: competencies, metric definitions, assessment rounds, versioned settings and
// the intervention library. Intervention costs are ILLUSTRATIVE (not PAB unit costs). Only the three
// TaRL-type cards (INT-01..03) cite published evidence, flagged "verify before production".

import type { AssessmentRound, Competency, Intervention, MetricDefinition, SettingVersion, TaskTemplate } from './types';

export const SEED = 20261024;
export const AS_OF_DATE = '2026-10-24';
export const AS_OF_TS = '2026-10-24T06:30:00.000Z'; // 12:00 IST
export const SEED_VERSION = 'karyavahi-seed v1.0';
export const SIM_MODEL = 'simulated-template-v1';
export const DISCLAIMER = 'DEMO MODE — FICTIONAL SEED DATA — NOT ACTUAL GOVERNMENT STATISTICS';

export const COMPETENCIES: Competency[] = [
  { id: 'CMP-L1', code: 'L1', domain: 'literacy', name_en: 'Letter recognition', name_hi: 'अक्षर पहचान' },
  { id: 'CMP-L2', code: 'L2', domain: 'literacy', name_en: 'Word reading', name_hi: 'शब्द पठन' },
  { id: 'CMP-L3', code: 'L3', domain: 'literacy', name_en: 'Reading with comprehension', name_hi: 'समझ के साथ पढ़ना' },
  { id: 'CMP-N1', code: 'N1', domain: 'numeracy', name_en: 'Number recognition', name_hi: 'संख्या पहचान' },
  { id: 'CMP-N2', code: 'N2', domain: 'numeracy', name_en: 'Addition', name_hi: 'जोड़' },
  { id: 'CMP-N3', code: 'N3', domain: 'numeracy', name_en: 'Subtraction', name_hi: 'घटाव' },
];

export const METRICS: MetricDefinition[] = [
  {
    id: 'MET-PCT-PROF',
    name: 'Students at grade benchmark (%)',
    definition: 'Share of assessed students in a grade who meet the grade-level benchmark for the competency in a given assessment round.',
    unit: 'percent',
    numerator: 'Students assessed who met the benchmark',
    denominator: 'Students assessed',
    higher_is_better: true,
    caveats: 'Baseline (July) and endline (February) rounds differ seasonally; compare like with like or against the district change. Grade cohorts change between academic years.',
    version: 1,
  },
  {
    id: 'MET-PARTICIPATION',
    name: 'Assessment participation (%)',
    definition: 'Students assessed divided by students enrolled in that grade.',
    unit: 'percent',
    numerator: 'Students assessed',
    denominator: 'Students enrolled in the grade',
    higher_is_better: true,
    caveats: 'Low participation can hide weak students; outcome checks apply a participation floor.',
    version: 1,
  },
];

export const ROUNDS: AssessmentRound[] = [
  { id: 'RND-2025-02', code: 'R0', label: 'Endline 2024-25', academic_year: '2024-25', round_type: 'endline', window_start: '2025-02-10', window_end: '2025-02-21', import_date: '2025-03-03', status: 'completed', instrument_note: 'Fictional state spot-assessment, grades 1–3' },
  { id: 'RND-2025-07', code: 'R1', label: 'Baseline 2025-26', academic_year: '2025-26', round_type: 'baseline', window_start: '2025-07-21', window_end: '2025-08-01', import_date: '2025-08-11', status: 'completed', instrument_note: 'Fictional state spot-assessment, grades 1–3' },
  { id: 'RND-2026-02', code: 'R2', label: 'Endline 2025-26', academic_year: '2025-26', round_type: 'endline', window_start: '2026-02-09', window_end: '2026-02-20', import_date: '2026-03-02', status: 'completed', instrument_note: 'Fictional state spot-assessment, grades 1–3' },
  { id: 'RND-2026-07', code: 'R3', label: 'Baseline 2026-27', academic_year: '2026-27', round_type: 'baseline', window_start: '2026-07-20', window_end: '2026-07-31', import_date: '2026-08-10', status: 'completed', instrument_note: 'Fictional state spot-assessment, grades 1–3' },
  { id: 'RND-2026-11', code: 'R4', label: 'Midline 2026-27', academic_year: '2026-27', round_type: 'midline', window_start: '2026-11-16', window_end: '2026-11-27', import_date: null, status: 'scheduled', instrument_note: 'Scheduled — no data yet' },
];

const CLOSURE_RULES = [
  'Every task in the current plan has verified evidence',
  'At least one verification comes from an independent source (spot-check or follow-up assessment by a different role)',
  'The pre-registered outcome check shows DiD at or above the success threshold',
  'Follow-up participation in treated schools meets the participation floor',
];

export const SETTINGS: SettingVersion[] = [
  {
    id: 'SET-v1',
    version: 1,
    effective_from: '2025-07-01',
    detection: { materiality_pp: 8, z_threshold: 3, min_cluster_assessed: 80, min_school_reporting_share: 0.7, min_participation: 0.7, driver_cumulative_share: 0.7, max_driver_schools: 5, severity_critical_pp: 15, severity_high_pp: 11 },
    outcome: { success_threshold_pp: 8, participation_floor_ratio: 0.85, min_participation: 0.7, comparison_schools_per_treated: 2 },
    reminders: { reminder_days_before_due: 2, escalation_days_overdue: 7 },
    diagnosis: { visit_gap_days: 60, attendance_drop_pp: 8, teacher_transfer_window_days: 150, ptr_threshold: 35 },
    closure_rules: CLOSURE_RULES,
    change_note: 'Initial configuration for the pilot.',
    changed_by: 'USR-00001',
    created_at: '2025-06-25T06:00:00.000Z',
  },
  {
    id: 'SET-v2',
    version: 2,
    effective_from: '2026-03-15',
    detection: { materiality_pp: 8, z_threshold: 3, min_cluster_assessed: 100, min_school_reporting_share: 0.7, min_participation: 0.7, driver_cumulative_share: 0.7, max_driver_schools: 5, severity_critical_pp: 15, severity_high_pp: 11 },
    outcome: { success_threshold_pp: 8, participation_floor_ratio: 0.9, min_participation: 0.7, comparison_schools_per_treated: 2 },
    reminders: { reminder_days_before_due: 2, escalation_days_overdue: 7 },
    diagnosis: { visit_gap_days: 60, attendance_drop_pp: 8, teacher_transfer_window_days: 150, ptr_threshold: 35 },
    closure_rules: CLOSURE_RULES,
    change_note: 'Raised minimum students per cluster from 80 to 100 and tightened the participation floor from 0.85 to 0.90 after the first outcome cycle.',
    changed_by: 'USR-00001',
    created_at: '2026-03-12T06:00:00.000Z',
  },
];

export function settingsAt(date: string): SettingVersion {
  return [...SETTINGS].reverse().find((s) => s.effective_from <= date) ?? SETTINGS[0];
}

/** A settings version by id, such as the one a plan's pre-registration locked. */
export function settingsById(id: string | null | undefined): SettingVersion | undefined {
  return SETTINGS.find((s) => s.id === id);
}

// ---------------- task templates ----------------
const t = (x: TaskTemplate) => x;
export const TT = {
  crcBaselineSpot: t({ key: 'crc_baseline_spot', title_en: 'Spot-assess the driver schools before work starts', title_hi: 'काम शुरू होने से पहले चिन्हित स्कूलों का त्वरित आकलन करें', owner_role: 'crc', per_school: false, duration_days: 7, proof_type: 'spot_assessment_sheet', proof_count: 1, cross_source: false }),
  hmRemedial: t({ key: 'hm_remedial_hour', title_en: 'Run a daily 45-minute remedial hour for Class {g} {comp}, grouped by level, for 6 weeks', title_hi: 'कक्षा {g} ({comp_hi}) के लिए स्तर के अनुसार समूह बनाकर 6 सप्ताह तक रोज़ 45 मिनट की उपचारात्मक कक्षा चलाएँ', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_attendance_register', proof_count: 3, cross_source: false }),
  hmOralReading: t({ key: 'hm_oral_reading', title_en: 'Run 15 minutes of daily oral reading practice in Class {g} for 6 weeks', title_hi: 'कक्षा {g} में 6 सप्ताह तक रोज़ 15 मिनट मौखिक पठन अभ्यास कराएँ', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_attendance_register', proof_count: 3, cross_source: false }),
  hmManipulatives: t({ key: 'hm_manipulatives', title_en: 'Use the place-value kit in every Class {g} maths lesson for 6 weeks', title_hi: 'कक्षा {g} के हर गणित पाठ में 6 सप्ताह तक स्थानीय-मान किट का उपयोग करें', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_lesson_plan', proof_count: 3, cross_source: false }),
  hmPeerGroups: t({ key: 'hm_peer_groups', title_en: 'Run peer-learning groups for Class {g} three times a week for 6 weeks', title_hi: 'कक्षा {g} के लिए 6 सप्ताह तक सप्ताह में तीन बार सहपाठी-शिक्षण समूह चलाएँ', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_attendance_register', proof_count: 3, cross_source: false }),
  hmGames: t({ key: 'hm_numeracy_games', title_en: 'Run a structured numeracy-games period for Class {g} daily for 6 weeks', title_hi: 'कक्षा {g} के लिए 6 सप्ताह तक रोज़ संख्या-खेल कालांश चलाएँ', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_attendance_register', proof_count: 3, cross_source: false }),
  hmRegroup: t({ key: 'hm_regroup', title_en: 'Regroup Class {g} by level after each monthly spot-assessment and teach to the group', title_hi: 'हर मासिक आकलन के बाद कक्षा {g} को स्तर के अनुसार पुनः समूहित करें', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_lesson_plan', proof_count: 2, cross_source: false }),
  crcCoachWeekly: t({ key: 'crc_weekly_coaching', title_en: 'Visit each driver school weekly to coach the teacher and log the visit', title_hi: 'हर सप्ताह चिन्हित स्कूलों में जाकर शिक्षक को सहयोग दें और भ्रमण दर्ज करें', owner_role: 'crc', per_school: false, duration_days: 42, proof_type: 'visit_log', proof_count: 6, cross_source: false }),
  crcCoachCycle: t({ key: 'crc_coaching_cycle', title_en: 'Run an observe–feedback–model coaching cycle with the Class {g} teacher (3 visits)', title_hi: 'कक्षा {g} शिक्षक के साथ अवलोकन–प्रतिपुष्टि–प्रदर्शन चक्र चलाएँ (3 भ्रमण)', owner_role: 'crc', per_school: true, duration_days: 42, proof_type: 'visit_log', proof_count: 3, cross_source: false }),
  brcSpotCheck: t({ key: 'brc_endline_spot_check', title_en: 'Independently spot-check learning in the driver schools', title_hi: 'चिन्हित स्कूलों में सीखने की स्वतंत्र जाँच करें', owner_role: 'brc', per_school: false, duration_days: 49, proof_type: 'spot_check_sheet', proof_count: 1, cross_source: true }),
  hmHomeContact: t({ key: 'hm_home_contact', title_en: 'Contact the families of children absent 5+ days this month and log each contact', title_hi: 'इस महीने 5 या अधिक दिन अनुपस्थित बच्चों के परिवारों से संपर्क करें और हर संपर्क दर्ज करें', owner_role: 'headmaster', per_school: true, duration_days: 28, proof_type: 'contact_log', proof_count: 2, cross_source: false }),
  hmPtm: t({ key: 'hm_ptm', title_en: 'Hold a parent meeting on Class {g} learning levels and share home activities', title_hi: 'कक्षा {g} के सीखने के स्तर पर अभिभावक बैठक करें और घर की गतिविधियाँ साझा करें', owner_role: 'headmaster', per_school: true, duration_days: 21, proof_type: 'photo_attendance_register', proof_count: 1, cross_source: false }),
  crcRegisterCheck: t({ key: 'crc_attendance_check', title_en: 'Check attendance registers in each driver school on two visits', title_hi: 'दो भ्रमणों में हर चिन्हित स्कूल का उपस्थिति रजिस्टर जाँचें', owner_role: 'crc', per_school: false, duration_days: 35, proof_type: 'visit_log', proof_count: 2, cross_source: false }),
  brcFacilitators: t({ key: 'brc_arrange_facilitators', title_en: 'Train and place learning-camp facilitators', title_hi: 'शिक्षण शिविर के सहायकों को प्रशिक्षित कर नियुक्त करें', owner_role: 'brc', per_school: false, duration_days: 14, proof_type: 'training_attendance', proof_count: 1, cross_source: false }),
  hmCamp: t({ key: 'hm_host_camp', title_en: 'Host three 10-day learning camps for Class {g}', title_hi: 'कक्षा {g} के लिए 10-10 दिन के तीन शिक्षण शिविर आयोजित करें', owner_role: 'headmaster', per_school: true, duration_days: 35, proof_type: 'photo_attendance_register', proof_count: 2, cross_source: false }),
  deoOrder: t({ key: 'deo_deputation_order', title_en: 'Issue a temporary deputation order to fill the teacher gap', title_hi: 'शिक्षक की कमी पूरी करने के लिए अस्थायी प्रतिनियुक्ति आदेश जारी करें', owner_role: 'deo', per_school: false, duration_days: 14, proof_type: 'order_copy', proof_count: 1, cross_source: false }),
  hmJoining: t({ key: 'hm_confirm_joining', title_en: 'Confirm the deputed teacher has joined and is teaching Class {g}', title_hi: 'पुष्टि करें कि प्रतिनियुक्त शिक्षक ने कार्यभार ग्रहण कर लिया है और कक्षा {g} पढ़ा रहे हैं', owner_role: 'headmaster', per_school: true, duration_days: 21, proof_type: 'joining_report', proof_count: 1, cross_source: false }),
  brcGuides: t({ key: 'brc_distribute_guides', title_en: 'Distribute teacher guides and run a half-day orientation', title_hi: 'शिक्षक मार्गदर्शिकाएँ बाँटें और आधे दिन का अभिमुखीकरण करें', owner_role: 'brc', per_school: false, duration_days: 14, proof_type: 'tlm_receipt', proof_count: 1, cross_source: false }),
  hmGuides: t({ key: 'hm_use_guides', title_en: 'Teach Class {g} {comp} from the structured lesson plans daily for 6 weeks', title_hi: 'कक्षा {g} ({comp_hi}) को 6 सप्ताह तक रोज़ संरचित पाठ योजना से पढ़ाएँ', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_lesson_plan', proof_count: 2, cross_source: false }),
  brcTraining: t({ key: 'brc_multigrade_training', title_en: 'Run the 2-day multigrade classroom training for driver-school teachers', title_hi: 'चिन्हित स्कूलों के शिक्षकों के लिए 2 दिवसीय बहुकक्षा प्रशिक्षण चलाएँ', owner_role: 'brc', per_school: false, duration_days: 21, proof_type: 'training_attendance', proof_count: 1, cross_source: false }),
  hmObservation: t({ key: 'hm_classroom_observation', title_en: 'Observe the Class {g} {comp} lesson fortnightly and record two action points', title_hi: 'हर पखवाड़े कक्षा {g} ({comp_hi}) के पाठ का अवलोकन करें और दो सुधार बिंदु दर्ज करें', owner_role: 'headmaster', per_school: true, duration_days: 42, proof_type: 'photo_lesson_plan', proof_count: 3, cross_source: false }),
} as const;

const NUM = ['CMP-N1', 'CMP-N2', 'CMP-N3'];
const LIT = ['CMP-L1', 'CMP-L2', 'CMP-L3'];
const COST_NOTE = 'Illustrative cost basis for the demo — not a PAB unit cost.';
const ILLUSTRATIVE = (summary: string) => ({ status: 'illustrative' as const, summary, source_title: null, source_url: null, effect_size_text: null });
const JPAL_TITLE = "J-PAL Policy Insight: Tailoring instruction to students' learning levels to increase learning";
const JPAL_URL = 'https://povertyactionlab.org/policy-insight/tailoring-instruction-students-learning-levels-increase-learning';

const base = { version: 1, review_date: '2027-03-31', provenance: 'synthetic_demo' as const };

export const INTERVENTIONS: Intervention[] = [
  {
    ...base, id: 'INT-01', name: 'Teacher-led remedial hour — numeracy (TaRL-style)', category: 'numeracy', domains: ['numeracy'], grades: [1, 2, 3], competency_ids: NUM,
    description: 'A protected daily period in which children are grouped by current level, not grade, and taught foundational number skills with simple activities.',
    steps: ['Spot-assess and group children by level', 'Protect a 45-minute period in the timetable', 'Teach level-wise activities daily for 6 weeks', 'Re-group after a mid-point check', 'Independent spot-check at the end'],
    resources: ['Level-wise activity cards', 'Printed tracking sheet', 'CRC coaching time'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 2500, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: { status: 'sourced_summary_verify', summary: 'Grouping by level with a dedicated period is the core of TaRL-type programmes studied in India; effects depend heavily on delivery.', source_title: JPAL_TITLE, source_url: JPAL_URL, effect_size_text: 'J-PAL: government teachers with a dedicated hour raised Hindi scores by 0.15 SD; across six Indian evaluations TaRL effects ranged 0.07–0.70 SD. Volunteers in school hours while teachers kept the standard curriculum showed no impact. Applying this to numeracy is an extrapolation.' },
    delivery_conditions: ['A protected period in the timetable', 'Grouping by level, not grade', 'Teacher oriented on the activities', 'Weekly CRC coaching'],
    limitations: ['Weak if the period is not protected', 'Needs re-grouping as children move up'],
    success_metric: 'DiD on % at grade benchmark for the case competency ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment sheet', 'Attendance register photos (weeks 2, 4, 6)', 'Weekly visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmRemedial, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-02', name: 'Teacher-led remedial hour — literacy (TaRL-style)', category: 'literacy', domains: ['literacy'], grades: [1, 2, 3], competency_ids: LIT,
    description: 'A protected daily reading period with children grouped by reading level: letters, words, paragraphs, stories.',
    steps: ['Spot-assess reading level', 'Protect a 45-minute period', 'Level-wise reading activities daily for 6 weeks', 'Mid-point regrouping', 'Independent spot-check'],
    resources: ['Reading level cards', 'Graded passages', 'Tracking sheet'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 2500, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: { status: 'sourced_summary_verify', summary: 'Same TaRL-type evidence base as INT-01, applied to reading.', source_title: JPAL_TITLE, source_url: JPAL_URL, effect_size_text: 'J-PAL: government teachers with a dedicated hour raised Hindi scores by 0.15 SD; range across six Indian evaluations 0.07–0.70 SD.' },
    delivery_conditions: ['A protected period in the timetable', 'Grouping by reading level', 'Weekly CRC coaching'],
    limitations: ['Weak if the period is not protected'],
    success_metric: 'DiD on % at grade benchmark for the case competency ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment sheet', 'Attendance register photos', 'Weekly visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmRemedial, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-03', name: 'Intensive learning camps (10-day bursts)', category: 'numeracy', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Three 10-day camps of 2–3 hours a day run by trained facilitators, grouped by level.',
    steps: ['Train facilitators', 'Run camp 1, check, regroup', 'Run camps 2 and 3', 'Independent spot-check'],
    resources: ['Facilitator honorarium', 'Camp materials', 'BRC training time'], duration_weeks: 6, lever: 'district',
    cost_basis: { amount_inr: 18000, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: { status: 'sourced_summary_verify', summary: 'Volunteer-led learning camps in school hours doubled the share of children reading a paragraph or story; month-long teacher-led summer camps showed small effects.', source_title: JPAL_TITLE, source_url: JPAL_URL, effect_size_text: 'J-PAL: learning camps — 49% vs 24% could read a paragraph or story; teacher-led summer camps — +0.07 SD maths, +0.09 SD language; overall TaRL range 0.07–0.70 SD.' },
    delivery_conditions: ['Trained facilitators', 'Daily 2–3 hour sessions', 'Three camp cycles'],
    limitations: ['Needs district funds or volunteers', 'Hard to sustain beyond the camp window'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Facilitator training attendance', 'Camp attendance photos', 'Independent spot-check'],
    task_templates: [TT.brcFacilitators, TT.hmCamp, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-04', name: 'CRC coaching cycle (observe–feedback–model)', category: 'teacher_support', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Three structured coaching visits per teacher: observe a lesson, give two specific points, model one activity.',
    steps: ['Observe the lesson with a checklist', 'Give two action points', 'Model one activity', 'Repeat after two weeks'],
    resources: ['Coaching checklist', 'CRC travel'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 500, unit: 'per school (travel)', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Coached classroom visits are a recurring ingredient in the precedents the deck cites (for example Kenya Tusome). No effect size is claimed for this card.'),
    delivery_conditions: ['Same CRC across all three visits', 'Checklist used every time'], limitations: ['Depends on CRC caseload'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Three visit logs per school', 'Independent spot-check'],
    task_templates: [TT.crcCoachCycle, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-05', name: 'Structured lesson plans and teacher guides — numeracy', category: 'materials', domains: ['numeracy'], grades: [1, 2, 3], competency_ids: NUM,
    description: 'Scripted daily lesson plans with a teacher guide and short orientation.',
    steps: ['Print and distribute guides', 'Half-day orientation', 'Daily use for 6 weeks with CRC follow-up'],
    resources: ['Printed guides', 'Orientation session'], duration_weeks: 6, lever: 'district',
    cost_basis: { amount_inr: 1200, unit: 'per teacher', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Structured pedagogy is widely used in foundational-learning programmes; no effect size is claimed for this card.'),
    delivery_conditions: ['Guides reach teachers before the window starts', 'CRC follow-up visits'], limitations: ['Printing at district scale takes time'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['TLM receipt', 'Lesson plan photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.brcGuides, TT.hmGuides, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-06', name: 'Structured lesson plans and teacher guides — literacy', category: 'materials', domains: ['literacy'], grades: [1, 2, 3], competency_ids: LIT,
    description: 'Scripted daily reading lessons with a teacher guide and short orientation.',
    steps: ['Distribute guides', 'Orientation', 'Daily use for 6 weeks'],
    resources: ['Printed guides'], duration_weeks: 6, lever: 'district',
    cost_basis: { amount_inr: 1200, unit: 'per teacher', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Structured pedagogy for early reading; no effect size is claimed for this card.'),
    delivery_conditions: ['Guides delivered on time', 'CRC follow-up'], limitations: ['Printing lead time'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['TLM receipt', 'Lesson plan photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.brcGuides, TT.hmGuides, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-07', name: 'Daily oral reading practice (15 minutes)', category: 'literacy', domains: ['literacy'], grades: [1, 2, 3], competency_ids: ['CMP-L2', 'CMP-L3'],
    description: 'Children read aloud in pairs or small groups for 15 minutes every day from graded passages.',
    steps: ['Print graded passages', 'Pair children by level', 'Daily practice for 6 weeks'], resources: ['Graded passages'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 300, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Reading practice routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Daily, not weekly', 'Passages matched to level'], limitations: ['Little help for children who cannot yet decode letters'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment', 'Attendance register photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmOralReading, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-08', name: 'Place-value manipulatives kit with teacher orientation', category: 'numeracy', domains: ['numeracy'], grades: [2, 3], competency_ids: ['CMP-N2', 'CMP-N3'],
    description: 'Bundles, sticks and place-value mats used in every maths lesson to teach addition and subtraction with regrouping.',
    steps: ['Procure kit from school grant', 'Orientation by CRC', 'Daily use for 6 weeks'], resources: ['Manipulatives kit'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 4000, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Concrete materials for place value; no effect size is claimed for this card.'),
    delivery_conditions: ['Kit used daily, not stored'], limitations: ['Procurement delay'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment', 'Lesson photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmManipulatives, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-09', name: 'Attendance follow-up drive', category: 'attendance', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Headmaster and SMC contact families of chronically absent children; CRC checks registers.',
    steps: ['List children absent 5+ days', 'Home contact within a week', 'Register check on two CRC visits'], resources: ['SMC members', 'Contact log'], duration_weeks: 5, lever: 'block',
    cost_basis: { amount_inr: 0, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Attendance outreach routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Contact within a week of absence'], limitations: ['Does not fix teaching quality by itself'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Contact logs', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.hmHomeContact, TT.crcRegisterCheck, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-10', name: 'Parent meeting on learning levels', category: 'attendance', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'A meeting where parents see their child’s level and get two simple home activities.',
    steps: ['Prepare level cards', 'Hold meeting', 'Follow-up check by CRC'], resources: ['Level cards'], duration_weeks: 3, lever: 'block',
    cost_basis: { amount_inr: 800, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Parent engagement routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Most parents attend'], limitations: ['One-off unless repeated'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Meeting attendance photo', 'Independent spot-check'],
    task_templates: [TT.hmPtm, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-11', name: 'Temporary teacher deputation within the district', category: 'staffing', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'DEO deputes a teacher from a surplus school to cover a vacancy until a regular posting.',
    steps: ['Identify surplus school', 'Issue deputation order', 'Confirm joining', 'Independent spot-check'], resources: ['DEO order'], duration_weeks: 5, lever: 'district',
    cost_basis: { amount_inr: 0, unit: 'per case', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Administrative fix for a staffing gap; no effect size is claimed for this card.'),
    delivery_conditions: ['A surplus teacher exists in the district'], limitations: ['Temporary; the gap returns if not regularised'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Order copy', 'Joining report', 'Independent spot-check'],
    task_templates: [TT.deoOrder, TT.hmJoining, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-12', name: 'Additional teacher post or guest teacher (PAB proposal)', category: 'staffing', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Packaged as a dated recommendation for the next PAB cycle when no district surplus exists.',
    steps: ['DEO validates the vacancy', 'Add to the PAB packet with cost basis'], resources: ['PAB proposal'], duration_weeks: 0, lever: 'pab',
    cost_basis: { amount_inr: 120000, unit: 'per post per year', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Budget proposal, not an intervention with a measured effect.'),
    delivery_conditions: ['Approved in the PAB'], limitations: ['Takes effect only in the next financial year'],
    success_metric: 'Post sanctioned in PAB minutes', required_evidence: ['PAB packet entry'],
    task_templates: [],
  },
  {
    ...base, id: 'INT-13', name: 'Peer-learning groups', category: 'numeracy', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Older or stronger children lead short practice groups three times a week.',
    steps: ['Pick and brief peer leaders', 'Three sessions a week for 6 weeks'], resources: ['Activity cards'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 200, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Peer practice routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Teacher supervises groups'], limitations: ['Weak for children far below level'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment', 'Attendance photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmPeerGroups, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-14', name: 'Multigrade classroom management training', category: 'teacher_support', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Two-day block training on running parallel activities in multigrade rooms, followed by coaching.',
    steps: ['2-day training', 'Coaching cycle', 'Independent spot-check'], resources: ['BRC training budget'], duration_weeks: 6, lever: 'district',
    cost_basis: { amount_inr: 6000, unit: 'per training batch', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Training plus follow-up coaching; no effect size is claimed for this card.'),
    delivery_conditions: ['Coaching follows the training'], limitations: ['Training alone rarely changes practice'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Training attendance', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.brcTraining, TT.crcCoachCycle, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-15', name: 'Assessment-informed regrouping', category: 'numeracy', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'Monthly two-minute spot-assessment; children regrouped and taught to their group.',
    steps: ['Monthly spot-assessment', 'Regroup', 'Teach to group'], resources: ['Spot-assessment cards'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 500, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Formative assessment routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Regrouping actually happens'], limitations: ['Monthly sheets alone do not help (deck cites a null result for evaluation sheets without a specific intervention)'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment', 'Lesson photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmRegroup, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-16', name: 'Library period with graded readers (PAB proposal)', category: 'materials', domains: ['literacy'], grades: [1, 2, 3], competency_ids: LIT,
    description: 'Graded readers for every class and a weekly library period; needs a budget line.',
    steps: ['Cost the reader sets', 'Add to PAB packet'], resources: ['Graded readers'], duration_weeks: 0, lever: 'pab',
    cost_basis: { amount_inr: 9000, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Budget proposal; no effect size is claimed for this card.'),
    delivery_conditions: ['Approved in the PAB'], limitations: ['Next financial year at the earliest'],
    success_metric: 'Line item approved in PAB minutes', required_evidence: ['PAB packet entry'],
    task_templates: [],
  },
  {
    ...base, id: 'INT-17', name: 'Structured numeracy-games period', category: 'numeracy', domains: ['numeracy'], grades: [1, 2], competency_ids: ['CMP-N1', 'CMP-N2'],
    description: 'A daily 30-minute period of structured number games with simple materials.',
    steps: ['Prepare game kit', 'Daily period for 6 weeks'], resources: ['Game kit'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 1500, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('Structured play routine; no effect size is claimed for this card.'),
    delivery_conditions: ['Daily period'], limitations: ['Less suited to Class 3 subtraction'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Baseline spot-assessment', 'Attendance photos', 'Visit logs', 'Independent spot-check'],
    task_templates: [TT.crcBaselineSpot, TT.hmGames, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
  {
    ...base, id: 'INT-18', name: 'Headmaster academic check-ins', category: 'teacher_support', domains: ['numeracy', 'literacy'], grades: [1, 2, 3], competency_ids: [...NUM, ...LIT],
    description: 'The headmaster observes the target lesson every fortnight and records two action points; CRC reviews.',
    steps: ['Fortnightly observation', 'Two action points', 'CRC review'], resources: ['Observation sheet'], duration_weeks: 6, lever: 'block',
    cost_basis: { amount_inr: 0, unit: 'per school', note: COST_NOTE, illustrative: true },
    evidence: ILLUSTRATIVE('School leadership routine (the deck cites fortnightly visits with action plans in Sobral as a precedent); no effect size is claimed.'),
    delivery_conditions: ['Headmaster has a free period'], limitations: ['Depends on headmaster capacity'],
    success_metric: 'DiD ≥ +8 pp at the next round', required_evidence: ['Observation sheets', 'Independent spot-check'],
    task_templates: [TT.hmObservation, TT.crcCoachWeekly, TT.brcSpotCheck],
  },
];

export const INTERVENTION_BY_ID = new Map(INTERVENTIONS.map((i) => [i.id, i]));
