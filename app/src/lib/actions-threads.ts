'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from './session';
import { Refused } from './guard';
import { postComment, editComment, setFollowing } from './write-threads';

/**
 * Server actions for case threads. Thin wrappers, like actions.ts: scope, authorship, the
 * version check and the mention rules all live in write-threads.ts.
 */

type State = { error?: string; ok?: string; at?: number };

const str = (f: FormData, k: string): string => String(f.get(k) ?? '').trim();
const ids = (f: FormData, k: string): string[] => str(f, k).split(',').map((x) => x.trim()).filter(Boolean);

async function attempt(fn: () => void, ok: string): Promise<State> {
  try {
    fn();
    return { ok, at: Date.now() };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message, at: Date.now() };
    return { error: `The change could not be saved: ${(e as Error).message}`, at: Date.now() };
  }
}

export async function postCommentAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const decision = str(form, 'decision') === 'on';
  let mentioned = 0;
  const res = await attempt(() => {
    mentioned = postComment(s, { caseId, body: String(form.get('body') ?? ''), mentions: ids(form, 'mentions'), decision }).mentioned.length;
  }, '');
  revalidatePath(`/cases/${caseId}`);
  if (res.error) return res;
  return {
    at: res.at,
    ok: decision
      ? 'Decision recorded. It is now part of the case history.'
      : `Comment posted${mentioned ? `; ${mentioned} ${mentioned === 1 ? 'person was' : 'people were'} notified of the mention` : ''}.`,
  };
}

export async function editCommentAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const res = await attempt(() => {
    editComment(s, {
      commentId: str(form, 'comment_id'), body: String(form.get('body') ?? ''),
      mentions: ids(form, 'mentions'), expectedVersion: Number(str(form, 'version')),
    });
  }, 'Comment updated.');
  revalidatePath(`/cases/${caseId}`);
  return res;
}

export async function followCaseAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  const caseId = str(form, 'case_id');
  const following = str(form, 'follow') === '1';
  const res = await attempt(
    () => { setFollowing(s, caseId, following); },
    following ? 'You are following this case. New comments will reach your notifications.' : 'You have unfollowed this case.',
  );
  revalidatePath(`/cases/${caseId}`);
  return res;
}
