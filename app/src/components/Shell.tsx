import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { getLanguage, getSession } from '@/lib/session';
import { navGroups, navFor, homeFor, GROUP_LABEL, GROUP_LABEL_HI, type BadgeKey, type NavSection } from '@/lib/nav';
import { t, pick } from '@/lib/i18n';
import { today } from '@/lib/clock';
import { countUnread } from '@/lib/feed';
import { countEvidenceToCheck, countTasks, approvalQueue } from '@/lib/cases';
import { scopeName } from '@/lib/repo';
import { ROLE_LABELS } from '@domain/permissions';
import { UserMenu, UserMenuLink, UserMenuForm, LanguageToggle, type ClientNavGroup } from './Chrome';
import { CommandPalette, CommandTrigger, Dock, type DockItem } from './Command';
import { Logo } from './Brand';
import { Icon } from './Icon';
import { DemoBannerText } from './DemoBanner';
import { fmtDate } from './ui';
import { AssistantDrawer } from './Chat';
import { FeedbackButton } from './Feedback';
import { may } from '@/lib/guard';
import { can } from '@/lib/authz';
import { aiStatus } from '@/lib/ai/config';
import { listComplaints } from '@/lib/complaints';
import { verificationQueue, canDecide } from '@/lib/onboarding';

/**
 * The application frame, built around the content rather than a menu:
 *
 *   a thin demo strip · a quiet top bar (home, your place, one search box that is also the menu,
 *   AI, notifications, account) · the page · a floating dock of the four or five places your
 *   role uses most, which becomes the tab bar on a phone.
 *
 * Every other page is one keystroke away in the command palette (⌘K or /), which lists exactly
 * the pages this role may open: the same list the permission matrix builds on the server.
 */

/** The places that go in the dock, in order, after the role's home, with the short labels a
 *  dock has room for. */
const DOCK_KEYS = ['navHotspots', 'navCases', 'navExecution', 'navReports'];
const DOCK_LABEL: Record<string, [string, string]> = {
  navHotspots: ['Hotspots', 'हॉटस्पॉट'], navCases: ['Cases', 'प्रकरण'], navExecution: ['Field work', 'क्षेत्र कार्य'], navReports: ['Reports', 'रिपोर्ट'],
};

export default async function Shell({ children }: { children: ReactNode }) {
  const session = await getSession();
  const lang = await getLanguage();
  if (!session) return <>{children}</>;

  const role = ROLE_LABELS[session.role];
  const roleLabel = pick(lang, role?.en ?? session.role, role?.hi ?? session.role);
  const scope = scopeName(session.scope_type, session.scope_id);
  const home = homeFor(session);
  const badges: Record<BadgeKey, number> = {
    approvals: approvalQueue(session, { limit: 200 }).length,
    evidence: countEvidenceToCheck(session),
    tasks: countTasks(session, { ownerUserId: session.user_id, status: ['assigned', 'acknowledged', 'in_progress', 'sent_back'] }),
    notifications: countUnread(session),
    complaints: listComplaints(session, { queue: 'mine', limit: 500 }).length,
    accounts: verificationQueue(session).filter((r) => r.status === 'approval_pending' && canDecide(session, r).allowed).length,
  };
  const groups: ClientNavGroup[] = navGroups(session).map((g) => ({
    key: g.key, label: pick(lang, GROUP_LABEL[g.key], GROUP_LABEL_HI[g.key]),
    sections: g.sections.map((s) => ({
      href: s.href, icon: s.icon, label: t(lang, s.key), badge: s.badge ? badges[s.badge] : undefined,
      children: s.children.map((c) => ({ href: c.href, label: t(lang, c.key), badge: c.badge ? badges[c.badge] : undefined })),
    })),
  }));

  // The dock: field roles get their four phone tabs; everyone else their home and main places.
  const sectionBadge = (s: NavSection) => (s.badge ? badges[s.badge] : 0) + s.children.reduce((n, c) => n + (c.badge ? badges[c.badge] : 0), 0);
  const sections = navFor(session);
  const dock: DockItem[] = home === '/today' ? [
    { href: '/today', icon: 'home', label: t(lang, 'navToday') },
    session.roles.some((r) => r.role === 'headmaster')
      ? { href: '/school', icon: 'school', label: t(lang, 'navMySchool') }
      : { href: '/schools', icon: 'school', label: t(lang, 'navSchools') },
    { href: '/tasks', icon: 'clipboard', label: t(lang, 'navTasks'), badge: badges.tasks },
    can(session, 'create_complaint')
      ? { href: '/complaints/new', icon: 'plus', label: pick(lang, 'Raise', 'दर्ज करें') }
      : { href: '/notifications', icon: 'bell', label: t(lang, 'navNotifications'), badge: badges.notifications },
  ] : [
    { href: home, icon: 'home', label: pick(lang, 'Home', 'होम'), badge: sections[0] ? sectionBadge(sections[0]) || undefined : undefined },
    ...DOCK_KEYS.map((k) => sections.find((s) => s.key === k)).filter((s): s is NavSection => !!s && s.href !== home)
      .map((s) => ({ href: s.href, icon: s.icon, label: DOCK_LABEL[s.key] ? pick(lang, ...DOCK_LABEL[s.key]) : t(lang, s.key), badge: sectionBadge(s) || undefined })),
  ].slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-center gap-2 bg-amber-light px-4 py-1 text-center text-2xs font-semibold uppercase tracking-[0.1em] text-warn no-print" role="note">
        <DemoBannerText lang={lang} />
        <span className="hidden normal-case tracking-normal sm:inline">· {t(lang, 'demoClock')} {fmtDate(today(), false, lang)}</span>
      </div>
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ivory/90 backdrop-blur no-print">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href={home} className="flex shrink-0 items-center gap-2.5" aria-label={pick(lang, 'Karyavahi home', 'कार्यवाही मुखपृष्ठ')}>
            <Logo size={30} />
            <span className="hidden font-display text-md font-semibold tracking-tight text-ink lg:inline">Karyavahi</span>
          </Link>
          <span className="hidden min-w-0 items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1 text-xs text-ink-soft md:inline-flex" title={roleLabel}>
            <Icon name="pin" size={13} className="shrink-0 text-ink-faint" />
            <span className="truncate font-medium text-ink">{scope}</span>
            <span className="hidden truncate text-ink-faint xl:inline">· {roleLabel}</span>
          </span>
          <div className="flex min-w-0 flex-1 justify-center px-1">
            <CommandTrigger label={pick(lang, 'Search or jump to…', 'खोजें या सीधे जाएँ…')} />
          </div>
          {may(session, 'ai.assistant') ? <Suspense fallback={null}><AssistantDrawer configured={aiStatus().configured} userKey={session.user_id} label={pick(lang, 'Ask Claude', 'Claude से पूछें')} hint={pick(lang, 'Ask Claude about this page', 'इस पृष्ठ के बारे में Claude से पूछें')} /></Suspense> : null}
          <FeedbackButton lang={lang} />
          <Link href="/notifications" className="btn-ghost relative px-2" title={t(lang, 'navNotifications')}>
            <Icon name="bell" size={19} label={t(lang, 'navNotifications')} />
            {badges.notifications > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-crit" aria-label={`${badges.notifications} unread`} /> : null}
          </Link>
          <UserMenu name={session.full_name} role={roleLabel} scope={scope} email={session.email}>
            <UserMenuLink href="/account"><Icon name="user" size={16} />{t(lang, 'navAccount')}</UserMenuLink>
            <UserMenuLink href="/notifications">
              <Icon name="bell" size={16} />{t(lang, 'navNotifications')}
              {badges.notifications > 0 ? <span className="tnum ml-auto text-xs text-ink-faint">{badges.notifications}</span> : null}
            </UserMenuLink>
            <LanguageToggle current={lang} compact />
            <UserMenuForm action="/api/sign-out" danger><Icon name="logout" size={16} />{t(lang, 'signOut')}</UserMenuForm>
          </UserMenu>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-8 print-full">{children}</main>

      <Dock items={dock} labels={{ more: pick(lang, 'More', 'और'), dock: pick(lang, 'Main places', 'मुख्य स्थान') }} />
      <CommandPalette groups={groups} labels={{
        trigger: pick(lang, 'Search or jump to…', 'खोजें या सीधे जाएँ…'),
        placeholder: may(session, 'ai.assistant')
          ? pick(lang, 'A page, a place, an id like CASE-0184, or a question for Claude', 'पृष्ठ, स्थान, CASE-0184 जैसी पहचान, या Claude से प्रश्न')
          : pick(lang, 'Type a page, a place, or an id like CASE-0184', 'पृष्ठ, स्थान या CASE-0184 जैसी पहचान लिखें'),
        ask: may(session, 'ai.assistant') && aiStatus().configured ? pick(lang, 'Ask Claude', 'Claude से पूछें') : undefined,
        searchAll: pick(lang, 'Search everything for', 'सब में खोजें:'),
        open: pick(lang, 'Open', 'खोलें'),
        empty: pick(lang, 'No page matches. Press Enter to search everything.', 'कोई पृष्ठ नहीं मिला।'),
        more: pick(lang, 'More', 'और'),
        dock: pick(lang, 'Main places', 'मुख्य स्थान'),
        jump: pick(lang, 'Search or jump to a page', 'खोजें या पृष्ठ पर जाएँ'),
      }} />
    </div>
  );
}
