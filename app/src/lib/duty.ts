import 'server-only';
import { one } from './db';
import type { Pred } from './scope';

/**
 * Separation of duties for proof: nobody checks work they took part in.
 *
 * "Took part" is wider than "submitted this piece". A person is too close to a task's proof when
 * they submitted it, own the task now, held it before it was reassigned, or handed in any other
 * piece of proof for it. Checking only the submitter left a gap: after a reassignment the
 * previous owner (who delivered part of the work) could accept the new owner's proof, and a
 * task's owner could accept proof someone else uploaded for it.
 *
 * The same rule feeds the write (verifyEvidence refuses) and every queue and badge that says
 * "proof waiting on you", so the app never offers a check it would then refuse.
 */

const REASSIGNED = `select 1 from audit_events ak where ak.entity_type = 'task' and ak.entity_id = %TASK% and ak.action = 'task.reassigned'
                      and json_extract(ak.before, '$.owner_user_id') = ?`;

/** Evidence rows (alias `e`) this user did not take part in, so may check. */
export function independentOf(userId: string, alias = 'e'): Pred {
  return {
    sql: `(${alias}.submitted_by <> ?
      and not exists (select 1 from tasks tk where tk.id = ${alias}.task_id and (tk.owner_user_id = ? or tk.reassigned_from = ?))
      and not exists (select 1 from evidence ek where ek.task_id = ${alias}.task_id and ek.submitted_by = ?)
      and not exists (${REASSIGNED.replace('%TASK%', `${alias}.task_id`)}))`,
    params: [userId, userId, userId, userId, userId],
  };
}

export type Involvement = 'submitted' | 'owner' | 'former_owner' | 'delivered';

/** How this user took part in the task behind a piece of proof, or null when they did not. */
export function involvement(userId: string, e: { task_id: string; submitted_by: string }): Involvement | null {
  if (e.submitted_by === userId) return 'submitted';
  const t = one<{ owner_user_id: string | null; reassigned_from: string | null }>(
    'select owner_user_id, reassigned_from from tasks where id = ?', e.task_id,
  );
  if (t?.owner_user_id === userId) return 'owner';
  if (t?.reassigned_from === userId) return 'former_owner';
  if (one(REASSIGNED.replace('%TASK%', '?'), e.task_id, userId)) return 'former_owner';
  if (one('select 1 from evidence where task_id = ? and submitted_by = ?', e.task_id, userId)) return 'delivered';
  return null;
}

export const INVOLVEMENT_MESSAGE: Record<Involvement, string> = {
  submitted: 'You cannot verify evidence you submitted yourself.',
  owner: 'This task is assigned to you, so someone else must check its proof.',
  former_owner: 'You held this task before it was reassigned, so someone else must check its proof.',
  delivered: 'You handed in proof for this task yourself, so someone else must check it.',
};
