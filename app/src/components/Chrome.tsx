'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Language } from '@domain/types';
import { Icon } from './Icon';
import { Logo } from './Brand';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from './primitives/sheet';
import { Menu, MenuContent, MenuItem, MenuTrigger, menuItemClass } from './primitives/menu';

/**
 * Client-side chrome: the grouped, collapsible sidebar; header breadcrumbs; the mobile drawer;
 * the user menu; the language switch. Everything here receives already-translated,
 * already-authorised data from the server-rendered Shell.
 */

export interface ClientNavItem { href: string; label: string; badge?: number }
export interface ClientNavSection extends ClientNavItem { icon: string; children: ClientNavItem[] }
export interface ClientNavGroup { key: string; label: string; sections: ClientNavSection[] }

const matches = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function activeHref(path: string, groups: ClientNavGroup[]): string | null {
  let best: string | null = null;
  for (const g of groups) for (const s of g.sections) {
    for (const h of [s.href, ...s.children.map((c) => c.href)]) {
      if (matches(path, h) && (!best || h.length > best.length)) best = h;
    }
  }
  return best;
}

function Count({ n, onDark = true }: { n?: number; onDark?: boolean }) {
  if (!n || n <= 0) return null;
  return <span className={`tnum ml-auto shrink-0 rounded-full px-1.5 text-2xs font-semibold leading-[18px] ${onDark ? 'bg-white/10 text-navy-100' : 'bg-paper-deep text-ink-soft'}`}>{n > 99 ? '99+' : n}</span>;
}

function NavBody({ groups, collapsed }: { groups: ClientNavGroup[]; collapsed: boolean }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          {collapsed ? <div className="mx-3 mb-2 h-px bg-white/10" aria-hidden /> : <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.1em] text-navy-300">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.sections.map((s) => {
              const inSection = active === s.href || s.children.some((c) => c.href === active);
              const total = (s.badge ?? 0) + s.children.reduce((n, c) => n + (c.badge ?? 0), 0);
              return (
                <li key={s.href}>
                  <Link
                    href={s.href} aria-current={active === s.href ? 'page' : undefined} title={collapsed ? s.label : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                      inSection ? 'bg-white/[0.07] font-medium text-white' : 'text-navy-200 hover:bg-white/[0.05] hover:text-white'}`}
                  >
                    {inSection ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-soft" aria-hidden /> : null}
                    <Icon name={s.icon} size={17} className={inSection ? 'text-white' : 'text-navy-300 group-hover:text-navy-100'} />
                    {collapsed ? (total > 0 ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-amber" aria-label={`${total} pending`} /> : null) : (
                      <>
                        <span className="truncate">{s.label}</span>
                        <Count n={total} />
                      </>
                    )}
                  </Link>
                  {inSection && !collapsed && s.children.length > 0 ? (
                    <ul className="mb-1 ml-[22px] mt-0.5 space-y-px border-l border-white/10 pl-3">
                      {s.children.map((c) => (
                        <li key={c.href}>
                          <Link href={c.href} aria-current={active === c.href ? 'page' : undefined}
                            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${active === c.href ? 'font-medium text-white' : 'text-navy-300 hover:text-white'}`}>
                            <span className="truncate">{c.label}</span><Count n={c.badge} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar: 240px expanded, 72px collapsed; the choice is remembered on this device. */
export function Sidebar({ groups, homeHref, footer, scope }: { groups: ClientNavGroup[]; homeHref: string; footer: ReactNode; scope: { name: string; role: string } }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem('kv_sidebar') === 'collapsed'); }, []);
  const toggle = () => setCollapsed((c) => { localStorage.setItem('kv_sidebar', c ? 'open' : 'collapsed'); return !c; });
  return (
    <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-navy transition-[width] duration-200 lg:flex no-print ${collapsed ? 'w-[72px]' : 'w-[240px]'}`}>
      <div className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center' : 'gap-2.5 px-4'}`}>
        <Link href={homeHref} className="flex min-w-0 items-center gap-2.5" aria-label="Karyavahi home">
          <Logo size={30} />
          {!collapsed ? (
            <span className="min-w-0 leading-tight">
              <span className="block text-md font-semibold tracking-tight text-white">Karyavahi</span>
              <span className="block truncate text-2xs text-navy-300">Education accountability</span>
            </span>
          ) : null}
        </Link>
      </div>
      {!collapsed ? (
        <div className="mx-3 mb-3 rounded-lg bg-white/[0.04] px-3 py-2">
          <p className="truncate text-sm font-medium text-white" title={scope.name}>{scope.name}</p>
          <p className="truncate text-2xs text-navy-300">{scope.role}</p>
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 overflow-y-auto pb-4 ${collapsed ? 'px-2' : 'px-2.5'}`}><NavBody groups={groups} collapsed={collapsed} /></div>
      <div className={`shrink-0 border-t border-white/10 ${collapsed ? 'px-2 py-3' : 'px-4 py-3'}`}>
        {!collapsed ? footer : null}
        <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
          className={`mt-2 flex w-full items-center gap-2 rounded-md py-1.5 text-xs text-navy-300 hover:bg-white/[0.05] hover:text-white ${collapsed ? 'justify-center' : 'px-2'}`}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={15} />{collapsed ? null : 'Collapse'}
        </button>
      </div>
    </aside>
  );
}

/** Header breadcrumb: Section › Page, taken from the navigation so it matches the sidebar. */
export function HeaderTitle({ groups }: { groups: ClientNavGroup[] }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  const sec = groups.flatMap((g) => g.sections).find((s) => s.href === active || s.children.some((c) => c.href === active));
  const child = sec?.children.find((c) => c.href === active);
  const deeper = active && path !== active ? path.slice(active.length + 1).split('/')[0] : null;
  if (!sec) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link href={sec.href} className={`truncate ${child || deeper ? 'text-ink-faint hover:text-ink' : 'font-semibold text-ink'}`}>{sec.label}</Link>
      {child ? (<><Icon name="chevron-right" size={13} className="text-ink-faint" /><Link href={child.href} className={`truncate ${deeper ? 'text-ink-faint hover:text-ink' : 'font-semibold text-ink'}`}>{child.label}</Link></>) : null}
      {deeper ? (<><Icon name="chevron-right" size={13} className="text-ink-faint" /><span className="truncate font-semibold text-ink">{decodeURIComponent(deeper)}</span></>) : null}
    </nav>
  );
}

export function MobileDrawer({ groups, label, footer }: { groups: ClientNavGroup[]; label: string; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className="btn-ghost -ml-2 px-2 lg:hidden">
          <Icon name="menu" size={20} label={label} />
        </button>
      </SheetTrigger>
      <SheetContent side="left" label="Karyavahi navigation" className="w-[280px] max-w-[85vw] overflow-y-auto bg-navy px-3 py-4 lg:hidden">
        <div className="mb-4 flex items-center justify-between px-1">
          <span className="flex items-center gap-2"><Logo size={28} /><span className="text-md font-semibold text-white">Karyavahi</span></span>
          <SheetClose className="rounded-md p-1.5 text-navy-200 hover:bg-white/10 hover:text-white"><Icon name="x" size={20} label="Close menu" /></SheetClose>
        </div>
        <NavBody groups={groups} collapsed={false} />
        {footer ? <div className="mt-auto border-t border-white/10 px-2 pt-3">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

export function UserMenu({ name, role, scope, email, children }: { name: string; role: string; scope: string; email: string; children?: ReactNode }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Menu>
      <MenuTrigger aria-label="Account menu" className="flex items-center gap-2 rounded-lg p-1 hover:bg-paper-deep data-[state=open]:bg-paper-deep">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-navy text-xs font-semibold text-white">{initials}</span>
      </MenuTrigger>
      <MenuContent className="w-72">
        <div className="border-b border-line px-4 py-3">
          <p className="text-base font-semibold text-ink">{name}</p>
          <p className="text-xs text-ink-faint">{email}</p>
          <p className="mt-1.5 text-xs text-ink-soft"><span className="font-medium text-ink">{role}</span> · {scope}</p>
        </div>
        <div className="p-1.5">{children}</div>
      </MenuContent>
    </Menu>
  );
}

/** A link in the account menu. */
export function UserMenuLink({ href, children }: { href: string; children: ReactNode }) {
  return <MenuItem asChild><Link href={href} className={menuItemClass}>{children}</Link></MenuItem>;
}

/** A form button in the account menu (sign out). The page changes, so the menu stays open
 *  until it does rather than removing the form before the browser sends it. */
export function UserMenuForm({ action, danger = false, children }: { action: string; danger?: boolean; children: ReactNode }) {
  return (
    <form action={action} method="post">
      <MenuItem asChild keepOpen>
        <button type="submit" className={`${menuItemClass} ${danger ? 'data-[highlighted]:bg-crit-light data-[highlighted]:text-crit' : ''}`}>{children}</button>
      </MenuItem>
    </form>
  );
}

export function LanguageToggle({ current, compact = false }: { current: Language; compact?: boolean }) {
  const label = current === 'en' ? 'हिंदी में बदलें' : 'Switch to English';
  const body = <><Icon name="globe" size={16} />{current === 'en' ? 'हिंदी' : 'English'}</>;
  return (
    <form action="/api/language" method="post">
      <input type="hidden" name="to" value={current === 'en' ? 'hi' : 'en'} />
      {compact ? (
        // In the account menu: a real menu item, reachable with the arrow keys.
        <MenuItem asChild keepOpen><button type="submit" className={menuItemClass} aria-label={label}>{body}</button></MenuItem>
      ) : (
        <button type="submit" className="btn-ghost btn-sm" aria-label={label}>{body}</button>
      )}
    </form>
  );
}

/** A details/summary section that remembers nothing — used for long optional panels. */
export function Expand({ summary, children, count }: { summary: string; children: React.ReactNode; count?: number }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-base font-medium text-ink-soft hover:text-ink sm:px-5">
        <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
        {summary}
        {count !== undefined ? <span className="tnum text-ink-faint">({count})</span> : null}
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}
