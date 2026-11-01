'use client';

import { useActionState, type ReactNode } from 'react';
import type { ActionState } from './ActionForm';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The composer's save form. Like ActionForm, but with two ways to finish: save the plan as a
 * draft, or save it and submit it for approval in one step. The button pressed travels as
 * `intent`, so the server decides what happens, and a refusal is shown beside the buttons.
 */
export function ComposeForm({
  action, hidden, children, submitLabel, draftLabel, pendingLabel,
}: {
  action: Action;
  hidden: Record<string, string>;
  children?: ReactNode;
  submitLabel: string;
  draftLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="intent" value="submit" className="btn-primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <button type="submit" name="intent" value="draft" className="btn-quiet" disabled={pending}>
          {draftLabel}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="mt-2 rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-sm leading-relaxed text-crit">
          <span className="font-semibold">Refused. </span>{state.error}
        </p>
      ) : null}
    </form>
  );
}
