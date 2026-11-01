'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * A menu that opens from a button: the account menu. Built on Radix DropdownMenu, in the
 * shadcn/ui way, so its items are real menu items: arrow keys move between them, typing a letter
 * jumps, Escape closes and focus returns to the button.
 */

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className = '', children, ...props }: { className?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<typeof DropdownMenu.Content>, 'className' | 'children'>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end" sideOffset={8} {...props}
        className={`z-50 overflow-hidden rounded-xl border border-line bg-white shadow-pop outline-none motion-safe:data-[state=open]:animate-fade-in ${className}`}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

/** The look every item shares, including the keyboard-highlighted state. */
export const menuItemClass =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-base text-ink-soft outline-none ' +
  'data-[highlighted]:bg-paper-sunk data-[highlighted]:text-ink';

/**
 * One item. `asChild` puts the item's behaviour on the link or button inside it. `keepOpen`
 * is for a button that submits a form: the page is about to change, and closing the menu first
 * would remove the form before the browser sends it.
 */
export function MenuItem({ keepOpen = false, ...props }: { keepOpen?: boolean } & ComponentPropsWithoutRef<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item {...props} onSelect={keepOpen ? (e) => e.preventDefault() : props.onSelect} />;
}
