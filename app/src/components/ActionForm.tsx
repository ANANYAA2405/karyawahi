'use client';

import { useActionState, type ReactNode } from 'react';

/**
 * A form wired to a server action.
 *
 * Refusals are shown, not swallowed. When the server says a BEO cannot decide a district-lever
 * plan, or that closing needs a verified outcome first, that sentence appears next to the
 * button the user pressed — the rule is part of the interface, not a hidden failure.
 */

export interface ActionState { error?: string; ok?: string }
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({
  action, children, label, tone = 'primary', hidden = {}, confirm, disabled, disabledReason, className = '',
}: {
  action: Action;
  children?: ReactNode;
  label: string;
  tone?: 'primary' | 'quiet' | 'danger' | 'good';
  hidden?: Record<string, string>;
  /** Text shown in a confirmation step before the action can be submitted. */
  confirm?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const btn = { primary: 'btn-primary', quiet: 'btn-quiet', danger: 'btn-danger', good: 'btn-good' }[tone];

  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {confirm ? <p className="mb-2 text-sm leading-snug text-ink-soft">{confirm}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btn} disabled={pending || disabled}>
          {pending ? 'Working…' : label}
        </button>
        {disabled && disabledReason ? (
          <span className="text-sm text-ink-faint">{disabledReason}</span>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="mt-2 rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-sm leading-relaxed text-crit">
          <span className="font-semibold">Refused. </span>{state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-2 rounded-md border border-good/30 bg-good-light px-3 py-2 text-sm leading-relaxed text-good">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

/** A reason box. Some moves cannot be made without one, and the server enforces that. */
export function ReasonBox({
  name = 'reason', label, placeholder, required = false, rows = 3,
}: { name?: string; label: string; placeholder?: string; required?: boolean; rows?: number }) {
  return (
    <label className="mb-2 block">
      <span className="label">
        {label}{required ? <span className="text-crit"> *</span> : <span className="text-ink-faint"> (optional)</span>}
      </span>
      <textarea
        name={name} rows={rows} required={required} placeholder={placeholder}
        className="input mt-1 resize-y"
      />
    </label>
  );
}

/** Collapsed action, so a destructive or reason-bearing step takes a deliberate click first. */
export function Disclose({ label, children, tone = 'quiet' }: { label: string; children: ReactNode; tone?: 'quiet' | 'danger' }) {
  return (
    <details className="group">
      <summary className={`btn ${tone === 'danger' ? 'border-crit/40 bg-crit-light text-crit' : 'border-line-strong bg-white text-ink-soft'} cursor-pointer list-none group-open:mb-3`}>
        {label}
      </summary>
      <div className="rounded-md border border-line bg-paper-sunk p-3">{children}</div>
    </details>
  );
}
