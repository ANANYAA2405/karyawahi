'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from './session';
import { Refused } from './guard';
import { createApiKey, revokeApiKey } from './api/keys';

/**
 * Server actions for /admin/api-keys. Thin wrappers: the permission check, the area check and
 * the audit rows all live in lib/api/keys.ts.
 *
 * The new key travels back once, in the action's response, so the page can show it a single
 * time. It is not stored anywhere the page could read it again.
 */

export interface CreateKeyState { error?: string; ok?: string; token?: string; keyId?: string; at?: number }
type State = { error?: string; ok?: string };

const str = (f: FormData, k: string): string => String(f.get(k) ?? '').trim();

export async function createApiKeyAction(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const s = await requireSession();
  const scopeType = str(form, 'scope_type');
  const scopeId = scopeType === 'state' ? str(form, 'state_id') : scopeType === 'district' ? str(form, 'district_id') : str(form, 'block_id');
  try {
    const { id, token } = createApiKey(s, { name: str(form, 'name'), scopeType, scopeId });
    revalidatePath('/admin/api-keys');
    return { token, keyId: id, at: Date.now() };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message, at: Date.now() };
    return { error: `The key could not be made: ${(e as Error).message}`, at: Date.now() };
  }
}

export async function revokeApiKeyAction(_prev: State, form: FormData): Promise<State> {
  const s = await requireSession();
  try {
    revokeApiKey(s, str(form, 'key_id'));
    revalidatePath('/admin/api-keys');
    return { ok: 'Key revoked. It stops working on its next request.' };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    return { error: `The key could not be revoked: ${(e as Error).message}` };
  }
}
