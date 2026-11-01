import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { getLanguage, getSession } from '@/lib/session';
import { navGroups, homeFor, GROUP_LABEL, type BadgeKey } from '@/lib/nav';
import { t, pick } from '@/lib/i18n';
import { nowIso, today } from '@/lib/clock';
import { countUnread } from '@/lib/feed';
import { countEvidenceToCheck, countTasks, approvalQueue } from '@/lib/cases';
import { scopeName } from '@/lib/repo';
import { ROLE_LABELS } from '@domain/permissions';
import { Sidebar, HeaderTitle, MobileDrawer, UserMenu, UserMenuLink, UserMenuForm, LanguageToggle, type ClientNavGroup } from './Chrome';
import { Icon } from './Icon';
import { fmtDate } from './ui';
import { AssistantDrawer } from './Chat';
import { may } from '@/lib/guard';
import { aiStatus } from '@/lib/ai/config';
import { listComplaints } from '@/lib/complaints';
import { verificationQueue, canDecide } from '@/lib/onboarding';

/**
 * The application frame: a deep-navy, grouped, collapsible sidebar and a quiet 64px header
 * (breadcrumb · scope · search · AI · notifications · account). Content gets 32px side padding.
 *
 * The demo disclosure stays impossible to miss — a thin strip above the header — and the demo
 * date sits in the sidebar footer, because most queues are measured from it.
 */

export default async function Shell({ children }: { children: ReactNode }) {
  const session = await getSession();
  const lang = await getLanguage();
  if (!session) return <>{children}</>;

  const role = ROLE_LABELS[session.role];
  const roleLabel = pick(lang, role?.en ?? session.role, role?.hi ?? session.role);
  const scope = scopeName(session.scope_type, session.scope_id);
  const badges: Record<BadgeKey, number> = {
    approvals: approvalQueue(session, { limit: 200 }).length,
    evidence: countEvidenceToCheck(session),
    tasks: countTasks(session, { ownerUserId: session.user_id, status: ['assigned', 'acknowledged', 'in_progress', 'sent_back'] }),
    notifications: countUnread(session),
    complaints: listComplaints(session, { queue: 'mine', limit: 500 }).length,
    accounts: verificationQueue(session).filter((r) => r.status === 'approval_pending' && canDecide(session, r).allowed).length,
  };
  const groups: ClientNavGroup[] = navGroups(session).map((g) => ({
    key: g.key, label: GROUP_LABEL[g.key],
    sections: g.sections.map((s) => ({
      href: s.href, icon: s.icon, label: t(lang, s.key), badge: s.badge ? badges[s.badge] : undefined,
      children: s.children.map((c) => ({ href: c.href, label: t(lang, c.key), badge: c.badge ? badges[c.badge] : undefined })),
    })),
  }));

  const footer = (
    <div className="space-y-1 text-xs text-navy-300">
      <p className="flex items-center gap-1.5" title={`Demo clock: ${nowIso()}`}>
        <Icon name="calendar" size={13} />{t(lang, 'demoClock')}: <span className="tnum font-medium text-white">{fmtDate(today())}</span>
      </p>
      <p className="flex items-center gap-1.5"><Icon name="info" size={13} />{pick(lang, 'Fictional demo data', 'काल्पनिक डेमो डेटा')}</p>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar groups={groups} homeHref={homeFor(session)} footer={footer} scope={{ name: scope, role: roleLabel }} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-amber-light px-4 py-1 text-center text-2xs font-semibold uppercase tracking-[0.1em] text-warn no-print" role="note">
          {t(lang, 'demoBanner')}
        </div>
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-ivory/95 px-4 backdrop-blur sm:px-6 lg:px-8 no-print">
          <MobileDrawer groups={groups} label={pick(lang, 'Open navigation', 'नेविगेशन खोलें')} footer={footer} />
          <div className="min-w-0 flex-1">
            <HeaderTitle groups={groups} />
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft xl:inline-flex" title={roleLabel}>
            <Icon name="pin" size={13} className="text-ink-faint" />{scope}
          </span>
          <form action="/search" method="get" role="search" className="relative hidden md:block">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input type="search" name="q" aria-label={pick(lang, 'Search cases, schools, interventions', 'खोजें')}
              placeholder={pick(lang, 'Search…', 'खोजें…')}
              className="h-9 w-52 rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 xl:w-64" />
          </form>
          <Link href="/search" className="btn-ghost px-2 md:hidden"><Icon name="search" size={19} label={t(lang, 'navSearch')} /></Link>
          {may(session, 'ai.assistant') ? <Suspense fallback={null}><AssistantDrawer configured={aiStatus().configured} userKey={session.user_id} /></Suspense> : null}
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
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 print-full">{children}</main>
      </div>
    </div>
  );
}
