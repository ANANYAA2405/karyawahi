'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Language } from '@domain/types';
import { Icon } from './Icon';
import { Menu, MenuContent, MenuItem, MenuTrigger, menuItemClass } from './primitives/menu';

/**
 * Client-side chrome: the account menu and the language switch, plus the navigation types the
 * command palette and dock share. Everything here receives already-translated,
 * already-authorised data from the server-rendered Shell.
 */

export interface ClientNavItem { href: string; label: string; badge?: number }
export interface ClientNavSection extends ClientNavItem { icon: string; children: ClientNavItem[] }
export interface ClientNavGroup { key: string; label: string; sections: ClientNavSection[] }

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
