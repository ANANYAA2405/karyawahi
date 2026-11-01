'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './Icon';
import type { ClientNavGroup } from './Chrome';
import { askClaude } from './ask-claude';

/**
 * The command shell: a search box that is also the whole menu, and a small dock of the places a
 * role uses most. Together they replace the sidebar. The palette lists every page this role may
 * open (the same list the server built from the permission matrix), jumps straight to a record
 * when an id is typed (CASE-0184, SCH-00002, TSK-01401…), hands a question to Claude, and
 * otherwise searches everything.
 */

export interface CommandLabels {
  trigger: string; placeholder: string; searchAll: string; open: string; empty: string; more: string; dock: string; jump: string;
  /** "Ask Claude"; absent when this role has no Claude or none is connected. */
  ask?: string;
}

interface Entry { href: string; label: string; group: string; icon: string; badge?: number }

const OPEN_EVENT = 'kv:open-command';
/** Open the palette from anywhere on the page (the dock's "More" uses this). */
export const openCommand = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Record ids people type, and where each one lives. */
const ID_ROUTES: [RegExp, (id: string) => string, string][] = [
  [/^CASE-\d{4}$/i, (id) => `/cases/${id.toUpperCase()}`, 'Case'],
  [/^TSK-\d{5}$/i, (id) => `/tasks/${id.toUpperCase()}`, 'Task'],
  [/^SCH-\d{5}$/i, (id) => `/schools/${id.toUpperCase()}`, 'School'],
  [/^FND-\d{5}$/i, (id) => `/findings/${id.toUpperCase()}`, 'Finding'],
  [/^(CMP|GRV)-\d+$/i, (id) => `/complaints/${id.toUpperCase()}`, 'Complaint'],
];

function entriesOf(groups: ClientNavGroup[]): Entry[] {
  const out: Entry[] = [];
  for (const g of groups) for (const s of g.sections) {
    out.push({ href: s.href, label: s.label, group: g.label, icon: s.icon, badge: s.badge });
    for (const c of s.children) out.push({ href: c.href, label: c.label, group: s.label, icon: s.icon, badge: c.badge });
  }
  return out.filter((e, i, a) => a.findIndex((x) => x.href === e.href) === i);
}

export function CommandTrigger({ label }: { label: string }) {
  const [mac, setMac] = useState(true);
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  return (
    <button type="button" onClick={openCommand}
      className="group flex h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-line bg-white/80 px-3.5 text-left text-base text-ink-faint transition-colors hover:border-line-strong hover:bg-white">
      <Icon name="search" size={16} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <kbd className="hidden rounded-md border border-line bg-paper-sunk px-1.5 py-0.5 font-sans text-2xs text-ink-faint sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  );
}

export function CommandPalette({ groups, labels }: { groups: ClientNavGroup[]; labels: CommandLabels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const all = useMemo(() => entriesOf(groups), [groups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);
  useEffect(() => { if (!open) { setQ(''); setAt(0); } }, [open]);

  const term = q.trim();
  const idHit = ID_ROUTES.find(([re]) => re.test(term));
  const matches = term ? all.filter((e) => `${e.label} ${e.group}`.toLowerCase().includes(term.toLowerCase())) : all;
  // A typed question goes to Claude first; a word or two is more likely a page, so Claude follows the pages.
  const ask = term && labels.ask && !idHit ? [{ key: 'ask', href: '', label: `${labels.ask}: “${term}”`, hint: 'Claude', icon: 'sparkles' }] : [];
  const question = /\s\S+\s|\?$/.test(term);
  const rows: { key: string; href: string; label: string; hint: string; icon: string; badge?: number }[] = [
    ...(idHit ? [{ key: 'id', href: idHit[1](term), label: `${labels.open} ${term.toUpperCase()}`, hint: idHit[2], icon: 'arrow-right' }] : []),
    ...(question ? ask : []),
    ...matches.map((e) => ({ key: e.href, href: e.href, label: e.label, hint: e.group, icon: e.icon, badge: e.badge })),
    ...(question ? [] : ask),
    ...(term ? [{ key: 'search', href: `/search?q=${encodeURIComponent(term)}`, label: `${labels.searchAll} “${term}”`, hint: '', icon: 'search' }] : []),
  ];
  const go = (href: string) => {
    setOpen(false);
    if (!href) askClaude(term);
    else router.push(href);
  };

  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/30 data-[state=open]:animate-fade-in" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-white shadow-pop outline-none motion-safe:data-[state=open]:animate-fade-in">
          <Dialog.Title className="sr-only">{labels.jump}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Icon name="search" size={18} className="text-ink-faint" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.placeholder}
              aria-label={labels.placeholder} role="combobox" aria-expanded="true" aria-controls="kv-command-list"
              aria-activedescendant={rows[at] ? `kv-cmd-${at}` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAt((v) => Math.min(rows.length - 1, v + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((v) => Math.max(0, v - 1)); }
                else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); go(rows[at].href); }
              }}
              className="h-14 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-faint" />
            <kbd className="rounded-md border border-line bg-paper-sunk px-1.5 py-0.5 text-2xs text-ink-faint">Esc</kbd>
          </div>
          <ul ref={list} id="kv-command-list" role="listbox" className="max-h-[56vh] overflow-y-auto p-2">
            {rows.length === 0 ? <li className="px-3 py-6 text-center text-base text-ink-faint">{labels.empty}</li> : rows.map((r, i) => (
              <li key={r.key} id={`kv-cmd-${i}`} role="option" aria-selected={i === at} data-active={i === at}>
                <button type="button" onClick={() => go(r.href)} onMouseMove={() => setAt(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${i === at ? 'bg-brand-light' : ''}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${i === at ? 'bg-white text-brand' : 'bg-paper-sunk text-ink-soft'}`}><Icon name={r.icon} size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{r.label}</span>
                    {r.hint ? <span className="block truncate text-xs text-ink-faint">{r.hint}</span> : null}
                  </span>
                  {r.badge ? <span className="tnum rounded-full bg-crit px-1.5 text-2xs font-semibold leading-[18px] text-white">{r.badge > 99 ? '99+' : r.badge}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface DockItem { href: string; label: string; icon: string; badge?: number }

const isOn = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/**
 * The dock: a role's main places within a thumb's reach, floating at the bottom of the screen on
 * a desktop and a full-width tab bar on a phone. "More" opens the palette with every page.
 */
export function Dock({ items, labels }: { items: DockItem[]; labels: Pick<CommandLabels, 'more' | 'dock'> }) {
  const path = usePathname();
  const best = items.reduce<string | null>((b, it) => (isOn(path, it.href) && (!b || it.href.length > b.length) ? it.href : b), null);
  return (
    <nav aria-label={labels.dock}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur no-print sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:pb-0 sm:shadow-pop">
      <ul className="mx-auto flex max-w-lg items-stretch sm:max-w-none sm:gap-1 sm:p-1.5">
        {items.map((it) => {
          const on = best === it.href;
          return (
            <li key={it.href} className="flex-1 sm:flex-none">
              <Link href={it.href} aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-2xs font-medium transition-colors sm:min-h-0 sm:min-w-[76px] sm:rounded-xl sm:py-2 ${on ? 'text-brand sm:bg-brand-light' : 'text-ink-soft hover:text-ink sm:hover:bg-paper-sunk'}`}>
                <Icon name={it.icon} size={20} />
                <span className="max-w-[84px] truncate">{it.label}</span>
                {it.badge ? <span className="tnum absolute right-[calc(50%-24px)] top-1 min-w-[18px] rounded-full bg-crit px-1 text-center text-2xs font-semibold leading-[18px] text-white">{it.badge > 99 ? '99+' : it.badge}</span> : null}
              </Link>
            </li>
          );
        })}
        <li className="flex-1 sm:flex-none">
          <button type="button" onClick={openCommand}
            className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-2 text-2xs font-medium text-ink-soft hover:text-ink sm:min-h-0 sm:min-w-[76px] sm:rounded-xl sm:py-2 sm:hover:bg-paper-sunk">
            <Icon name="grid" size={20} />
            <span>{labels.more}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
