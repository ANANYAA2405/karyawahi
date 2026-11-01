import type { Session } from './session';
import { may } from './guard';
import { ROLE_LABELS } from '@domain/permissions';
import { can } from './authz';

/**
 * Navigation, derived from the permission matrix rather than hand-listed per role, so a role
 * never sees a link to something it would be refused. The server still checks every read and
 * write independently; hiding a link is a courtesy, not the control.
 *
 * Eight top-level sections. Supporting pages (approvals, proof, audit, imports…) live inside
 * a section rather than each being a destination of its own.
 */

export type BadgeKey = 'approvals' | 'evidence' | 'tasks' | 'notifications' | 'complaints' | 'accounts';

export interface NavItem {
  href: string;
  key: string;
  badge?: BadgeKey;
}

export interface NavSection extends NavItem {
  icon: string;
  /** Child pages. A section is highlighted when any of these (or its own href) is active. */
  children: NavItem[];
}

/** Officer roles land on the operational overview; field roles on their day's work. */
const OVERVIEW_ROLES = new Set(['beo', 'deo', 'state_admin', 'demo_admin']);
const MY_DAY_ROLES = new Set(['crc', 'brc', 'headmaster']);

export const homeFor = (s: Session): string =>
  OVERVIEW_ROLES.has(s.role) ? '/overview'
  : MY_DAY_ROLES.has(s.role) ? '/today'
  : ROLE_LABELS[s.role]?.home ?? '/cases';

const isFieldRole = (s: Session) => s.roles.some((r) => ['crc', 'brc', 'headmaster'].includes(r.role));
const isOnlyHeadmaster = (s: Session) => s.roles.every((r) => r.role === 'headmaster');
const hasRole = (s: Session, ...roles: string[]) => s.roles.some((r) => roles.includes(r.role));
/** Coordinators keep the desktop Field Operations workspace alongside My day. */
const hasFieldDesk = (s: Session) => hasRole(s, 'crc', 'brc');

export function navFor(s: Session): NavSection[] {
  const out: NavSection[] = [];
  const home = homeFor(s);

  // 1. Overview — plus the detailed role desks that predate it.
  const overviewChildren: NavItem[] = [];
  if (home === '/overview') {
    if (hasRole(s, 'beo')) overviewChildren.push({ href: '/beo', key: 'navBlockDesk' });
    if (hasRole(s, 'deo')) overviewChildren.push({ href: '/district', key: 'navDistrictDesk' });
    if (hasRole(s, 'state_admin', 'demo_admin')) overviewChildren.push({ href: '/state', key: 'navStateDesk' });
  }
  if (home === '/today' && hasRole(s, 'headmaster')) overviewChildren.push({ href: '/school', key: 'navMySchool' });
  out.push({ href: home, key: home === '/today' ? 'navToday' : 'navOverview', icon: 'home', children: overviewChildren });

  // 2. Learning hotspots
  if (!isOnlyHeadmaster(s)) {
    out.push({
      href: '/hotspots', key: 'navHotspots', icon: 'map',
      children: [
        { href: '/schools', key: 'navSchools' },
        ...(may(s, 'case.view') ? [{ href: '/findings', key: 'navFindings' }] : []),
      ],
    });
  } else {
    out.push({ href: '/schools', key: 'navSchools', icon: 'school', children: [] });
  }

  // 3. Cases & action plans
  const caseChildren: NavItem[] = [];
  if (may(s, 'plan.approve_block') || may(s, 'plan.approve_district_or_pab')) {
    caseChildren.push({ href: '/approvals', key: 'navApprovals', badge: 'approvals' });
  }
  out.push({ href: '/cases', key: 'navCases', icon: 'briefcase', children: caseChildren });

  // 4. Intervention studio
  out.push({
    href: '/interventions', key: 'navInterventions', icon: 'flask',
    children: [{ href: '/interventions/compare', key: 'navCompare' }],
  });

  // 5. Field execution
  const exec: NavItem[] = [];
  if (isFieldRole(s) || may(s, 'task.update_own')) exec.push({ href: '/tasks', key: 'navTasks', badge: 'tasks' });
  if (may(s, 'evidence.verify')) exec.push({ href: '/evidence', key: 'navEvidence', badge: 'evidence' });
  if (isFieldRole(s)) exec.push({ href: '/visits', key: 'navVisits' });
  if (hasFieldDesk(s)) {
    out.push({ href: '/field', key: 'navExecution', icon: 'clipboard', children: [{ href: '/execution', key: 'navExecutionAll' }, ...exec] });
  } else if (!isOnlyHeadmaster(s)) {
    out.push({ href: '/execution', key: 'navExecution', icon: 'clipboard', children: exec });
  } else if (exec.length) {
    out.push({ ...exec[0], icon: 'clipboard', children: exec.slice(1) });
  }

  // 5b. Complaints & grievances
  if (can(s, 'view_complaint')) {
    out.push({ href: '/complaints', key: 'navComplaints', icon: 'inbox', badge: 'complaints',
      children: can(s, 'create_complaint') ? [{ href: '/complaints/new', key: 'navComplaintNew' }] : [] });
  }

  // 6. Impact & reports
  if (may(s, 'report.export')) {
    out.push({
      href: '/reports', key: 'navReports', icon: 'chart',
      children: [
        { href: '/impact', key: 'navImpact' },
        { href: '/reports/new', key: 'navReportBuilder' },
      ],
    });
  }

  // 7. Karyavahi AI
  if (may(s, 'ai.assistant')) out.push({ href: '/assistant', key: 'navAssistant', icon: 'sparkles', children: [] });

  // 8. Administration
  const admin: NavItem[] = [];
  if (may(s, 'audit.view')) admin.push({ href: '/audit', key: 'navAudit' });
  if (may(s, 'data.import')) admin.push({ href: '/import', key: 'navImport' });
  if (may(s, 'audit.view')) admin.push({ href: '/ai-log', key: 'navAi' });
  if (can(s, 'approve_accounts') || can(s, 'manage_users')) admin.push({ href: '/admin/accounts', key: 'navAccounts', badge: 'accounts' });
  if (can(s, 'manage_hierarchy') || may(s, 'audit.view')) admin.push({ href: '/admin/hierarchy', key: 'navHierarchy' });
  if (can(s, 'manage_geography') || may(s, 'audit.view')) admin.push({ href: '/admin/geography', key: 'navGeography' });
  if (may(s, 'settings.configure')) admin.push({ href: '/settings', key: 'navSettings' });
  if (may(s, 'settings.configure') || may(s, 'demo.reset')) admin.push({ href: '/admin/jobs', key: 'navJobs' });
  if (may(s, 'api.manage_keys')) admin.push({ href: '/admin/api-keys', key: 'navApiKeys' });
  if (may(s, 'feedback.review')) admin.push({ href: '/admin/feedback', key: 'navFeedback' });
  if (may(s, 'demo.reset')) {
    admin.push({ href: '/admin/outbox', key: 'navOutbox' });
    admin.push({ href: '/admin/demo', key: 'navDemoControls' });
  }
  if (admin.length > 0) out.push({ href: '/admin', key: 'navAdminHub', icon: 'shield', children: admin });

  // A role's home may also appear as a child link (the auditor's home is /audit).
  for (const sec of out) sec.children = sec.children.filter((c) => c.href !== sec.href && c.href !== home);
  return out;
}

/** The sidebar's groups. Sections not listed fall into Administration. */
const GROUP_OF: Record<string, 'overview' | 'intelligence' | 'operations' | 'insights' | 'admin'> = {
  navOverview: 'overview', navToday: 'overview', navHotspots: 'intelligence', navSchools: 'intelligence', navCases: 'intelligence',
  navInterventions: 'operations', navExecution: 'operations', navTasks: 'operations', navComplaints: 'operations',
  navReports: 'insights', navAssistant: 'insights',
};
export const GROUP_LABEL = { overview: 'Overview', intelligence: 'Intelligence', operations: 'Operations', insights: 'Insights', admin: 'Administration' } as const;
export const GROUP_LABEL_HI: Record<keyof typeof GROUP_LABEL, string> = {
  overview: 'सारांश', intelligence: 'विश्लेषण', operations: 'संचालन', insights: 'अंतर्दृष्टि', admin: 'प्रशासन',
};

export function navGroups(s: Session): { key: keyof typeof GROUP_LABEL; sections: NavSection[] }[] {
  const order: (keyof typeof GROUP_LABEL)[] = ['overview', 'intelligence', 'operations', 'insights', 'admin'];
  const all = navFor(s);
  return order
    .map((key) => ({ key, sections: all.filter((sec) => (GROUP_OF[sec.key] ?? 'admin') === key) }))
    .filter((g) => g.sections.length > 0);
}
