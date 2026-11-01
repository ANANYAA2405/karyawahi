import type { Language } from '@domain/types';

/**
 * Bilingual labels. The seed carries Hindi for everything a field user reads — competency
 * names, task titles, case statuses — so the app never machine-translates those; it picks the
 * column. Chrome that has no Hindi in the data is translated here.
 */

export const pick = (lang: Language, en: string, hi: string): string => (lang === 'hi' ? hi || en : en);

type Dict = Record<string, { en: string; hi: string }>;

export const T: Dict = {
  // chrome
  appName: { en: 'Karyavahi', hi: 'कार्यवाही' },
  tagline: { en: 'Data to action', hi: 'डेटा से कार्यवाही तक' },
  signIn: { en: 'Sign in', hi: 'साइन इन' },
  signOut: { en: 'Sign out', hi: 'साइन आउट' },
  signedInAs: { en: 'Signed in as', hi: 'साइन इन:' },
  language: { en: 'Language', hi: 'भाषा' },
  search: { en: 'Search', hi: 'खोजें' },
  back: { en: 'Back', hi: 'वापस' },
  demoBanner: {
    en: 'DEMO MODE — FICTIONAL SEED DATA — NOT ACTUAL GOVERNMENT STATISTICS',
    hi: 'डेमो मोड — काल्पनिक डेटा — वास्तविक सरकारी आँकड़े नहीं',
  },
  demoBannerReal: {
    en: 'DEMO MODE — REAL SCHOOLS (UDISE+ ~2020-21) · LEARNING RESULTS SIMULATED, CALIBRATED TO PRS 2024 · COSTS FROM UP PAB 2025-26',
    hi: 'डेमो मोड — वास्तविक विद्यालय (यू-डाइस+ ~2020-21) · अधिगम परिणाम काल्पनिक, परख 2024 से अंशांकित · लागत उ.प्र. PAB 2025-26 से',
  },
  demoClock: { en: 'Demo date', hi: 'डेमो तिथि' },

  // nav
  navHome: { en: 'Home', hi: 'होम' },
  navCases: { en: 'Cases', hi: 'प्रकरण' },
  navFindings: { en: 'Findings', hi: 'निष्कर्ष' },
  navTasks: { en: 'My tasks', hi: 'मेरे काम' },
  navApprovals: { en: 'Approvals', hi: 'स्वीकृतियाँ' },
  navEvidence: { en: 'Proof to check', hi: 'जाँचने योग्य सबूत' },
  navSchools: { en: 'Schools', hi: 'विद्यालय' },
  navInterventions: { en: 'Interventions', hi: 'हस्तक्षेप' },
  navReports: { en: 'Reports', hi: 'रिपोर्ट' },
  navImport: { en: 'Data import', hi: 'डेटा आयात' },
  navAudit: { en: 'Audit trail', hi: 'अंकेक्षण' },
  navSettings: { en: 'Settings', hi: 'सेटिंग' },
  navAssistant: { en: 'AI assistant', hi: 'AI सहायक' },
  navNotifications: { en: 'Notifications', hi: 'सूचनाएँ' },
  navVisits: { en: 'Visits', hi: 'भ्रमण' },
  navAdmin: { en: 'Demo admin', hi: 'डेमो प्रशासन' },
  navOutbox: { en: 'Message outbox', hi: 'संदेश आउटबॉक्स' },
  navJobs: { en: 'System jobs', hi: 'सिस्टम कार्य' },
  navApiKeys: { en: 'API keys', hi: 'API कुंजियाँ' },
  navFeedback: { en: 'User feedback', hi: 'उपयोगकर्ता सुझाव' },
  navAi: { en: 'AI activity log', hi: 'AI लॉग' },
  navOverview: { en: 'Dashboard', hi: 'डैशबोर्ड' },
  navToday: { en: 'My day', hi: 'आज का काम' },
  navMySchool: { en: 'My school', hi: 'मेरा विद्यालय' },
  navExecutionAll: { en: 'All field work', hi: 'सभी क्षेत्र कार्य' },
  navHotspots: { en: 'Learning hotspots', hi: 'अधिगम हॉटस्पॉट' },
  navExecution: { en: 'Field operations', hi: 'क्षेत्र संचालन' },
  navImpact: { en: 'Outcome verification', hi: 'परिणाम सत्यापन' },
  navReportBuilder: { en: 'Report builder', hi: 'रिपोर्ट बनाएँ' },
  navCompare: { en: 'Compare options', hi: 'विकल्प तुलना' },
  navAdminHub: { en: 'Administration', hi: 'प्रशासन' },
  navDemoControls: { en: 'System & demo controls', hi: 'सिस्टम व डेमो नियंत्रण' },
  navBlockDesk: { en: 'Block desk', hi: 'खंड डेस्क' },
  navDistrictDesk: { en: 'District desk', hi: 'ज़िला डेस्क' },
  navStateDesk: { en: 'State desk', hi: 'राज्य डेस्क' },
  navSearch: { en: 'Search', hi: 'खोज' },
  navComplaints: { en: 'Complaints', hi: 'शिकायतें' },
  navComplaintNew: { en: 'Raise a complaint', hi: 'शिकायत दर्ज करें' },
  navAccounts: { en: 'Accounts & approvals', hi: 'खाते व स्वीकृति' },
  navHierarchy: { en: 'Organisation', hi: 'संगठन' },
  navGeography: { en: 'Geography', hi: 'भूगोल' },
  navAccount: { en: 'My account', hi: 'मेरा खाता' },

  // case anatomy
  theFinding: { en: 'The finding', hi: 'निष्कर्ष' },
  theDiagnosis: { en: 'What the data shows', hi: 'डेटा क्या दिखाता है' },
  thePlan: { en: 'The plan', hi: 'योजना' },
  theWork: { en: 'The work', hi: 'काम' },
  theProof: { en: 'The proof', hi: 'सबूत' },
  theOutcome: { en: 'Did it work?', hi: 'क्या यह काम आया?' },
  timeline: { en: 'Timeline', hi: 'घटनाक्रम' },
  driverSchools: { en: 'Driver schools', hi: 'चिन्हित विद्यालय' },
  severity: { en: 'Severity', hi: 'गंभीरता' },
  owner: { en: 'Accountable officer', hi: 'उत्तरदायी अधिकारी' },
  dueDate: { en: 'Due', hi: 'नियत तिथि' },
  status: { en: 'Status', hi: 'स्थिति' },

  // actions
  approve: { en: 'Approve plan', hi: 'योजना स्वीकृत करें' },
  requestRevision: { en: 'Send back for changes', hi: 'बदलाव के लिए लौटाएँ' },
  reject: { en: 'Reject plan', hi: 'योजना अस्वीकार करें' },
  referPab: { en: 'Refer to PAB', hi: 'PAB को भेजें' },
  verify: { en: 'Accept proof', hi: 'सबूत स्वीकारें' },
  sendBack: { en: 'Send proof back', hi: 'सबूत लौटाएँ' },
  close: { en: 'Close case', hi: 'प्रकरण बंद करें' },
  reopen: { en: 'Reopen case', hi: 'फिर से खोलें' },
  dismiss: { en: 'Dismiss', hi: 'ख़ारिज करें' },
  reason: { en: 'Written reason', hi: 'लिखित कारण' },
  submit: { en: 'Submit', hi: 'जमा करें' },
  cancel: { en: 'Cancel', hi: 'रद्द' },

  // severity / misc
  critical: { en: 'Critical', hi: 'अति गंभीर' },
  high: { en: 'High', hi: 'गंभीर' },
  medium: { en: 'Medium', hi: 'मध्यम' },
  overdue: { en: 'Overdue', hi: 'विलंबित' },
  escalated: { en: 'Escalated', hi: 'उच्चाधिकारी को भेजा' },
  noneYet: { en: 'Nothing here yet', hi: 'अभी कुछ नहीं' },
  illustrative: { en: 'Illustrative', hi: 'केवल उदाहरण' },
  aiDrafted: { en: 'AI-drafted', hi: 'AI द्वारा तैयार' },
};

export function t(lang: Language, key: keyof typeof T | string): string {
  const e = T[key as string];
  if (!e) return String(key);
  return pick(lang, e.en, e.hi);
}

export const SEVERITY_LABEL = {
  critical: { en: 'Critical', hi: 'अति गंभीर' },
  high: { en: 'High', hi: 'गंभीर' },
  medium: { en: 'Medium', hi: 'मध्यम' },
} as const;

export const OUTCOME_LABEL = {
  improved_confirmed: { en: 'Improved — confirmed', hi: 'सुधार — पुष्ट' },
  improved_indicative: { en: 'Improved — indicative', hi: 'सुधार — संकेतात्मक' },
  below_target: { en: 'Below target', hi: 'लक्ष्य से कम' },
  no_change: { en: 'No change', hi: 'कोई बदलाव नहीं' },
  worsened: { en: 'Worsened', hi: 'और बिगड़ा' },
  inconclusive: { en: 'Inconclusive', hi: 'अनिर्णीत' },
} as const;

export const FACTOR_LABEL = {
  teacher_transfer: { en: 'Teacher transferred, not replaced', hi: 'शिक्षक स्थानांतरित, प्रतिस्थापन नहीं' },
  visit_gap: { en: 'No CRC visit for a long stretch', hi: 'लंबे समय से संकुल भ्रमण नहीं' },
  attendance_drop: { en: 'Attendance fell', hi: 'उपस्थिति घटी' },
  high_ptr: { en: 'Pupil–teacher ratio above threshold', hi: 'छात्र-शिक्षक अनुपात अधिक' },
} as const;

export const TASK_STATUS_LABEL = {
  assigned: { en: 'Assigned', hi: 'सौंपा गया' },
  acknowledged: { en: 'Acknowledged', hi: 'स्वीकार किया' },
  in_progress: { en: 'In progress', hi: 'जारी' },
  submitted: { en: 'Proof submitted', hi: 'सबूत जमा' },
  verified: { en: 'Verified', hi: 'सत्यापित' },
  sent_back: { en: 'Sent back', hi: 'लौटाया गया' },
  cancelled: { en: 'Cancelled', hi: 'रद्द' },
} as const;

export const EVIDENCE_TYPE_LABEL = {
  spot_assessment_sheet: { en: 'Spot-assessment sheet', hi: 'त्वरित आकलन पत्रक' },
  spot_check_sheet: { en: 'Independent spot-check sheet', hi: 'स्वतंत्र जाँच पत्रक' },
  photo_attendance_register: { en: 'Photo of attendance register', hi: 'उपस्थिति रजिस्टर का फ़ोटो' },
  visit_log: { en: 'Visit log', hi: 'भ्रमण लॉग' },
  contact_log: { en: 'Family contact log', hi: 'परिवार संपर्क लॉग' },
  training_attendance: { en: 'Training attendance', hi: 'प्रशिक्षण उपस्थिति' },
  tlm_receipt: { en: 'Teaching-material receipt', hi: 'शिक्षण सामग्री रसीद' },
  order_copy: { en: 'Copy of the order', hi: 'आदेश की प्रति' },
  joining_report: { en: 'Joining report', hi: 'कार्यभार ग्रहण रिपोर्ट' },
  photo_lesson_plan: { en: 'Photo of the lesson plan', hi: 'पाठ योजना का फ़ोटो' },
} as const;
