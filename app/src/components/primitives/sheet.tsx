'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * A panel that slides in from the side of the screen: the mobile navigation, the AI drawer.
 * Built on Radix Dialog, in the shadcn/ui way (the wrapper lives here, styled with our tokens),
 * so it traps focus while open, returns focus to the button that opened it, closes on Escape
 * and on the backdrop, and locks the page behind it from scrolling.
 */

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  side = 'right', label, description, className = '', children, ...props
}: {
  side?: 'left' | 'right';
  /** Read out when the sheet opens; drawn only by whatever header the children supply. */
  label: string;
  description?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<typeof Dialog.Content>, 'className' | 'children'>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40 data-[state=open]:animate-fade-in no-print" />
      <Dialog.Content
        {...props}
        // Without a description, say so explicitly; Radix otherwise warns that one is missing.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={`fixed inset-y-0 z-50 flex flex-col shadow-pop outline-none no-print motion-safe:data-[state=open]:animate-slide-in ${side === 'left' ? 'left-0' : 'right-0'} ${className}`}
      >
        <Dialog.Title className="sr-only">{label}</Dialog.Title>
        {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
