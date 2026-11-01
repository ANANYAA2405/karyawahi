'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from './session';
import { Refused } from './guard';
import { previewRoundImport, commitRoundImport, type ImportPreview, type CommitResult } from './write-import';

/**
 * Server actions for the round import. Thin wrappers, like actions.ts: every check — role,
 * round window, the uploader's area, each row, the same-file-twice rule — happens in
 * write-import.ts, on the file text sent here, never on anything the browser worked out.
 */

const MAX_BYTES = 6 * 1024 * 1024;

function tooBig(text: string): string | null {
  return text.length > MAX_BYTES ? 'That file is larger than 6 MB. Split it by district and upload each part.' : null;
}

export async function previewImportAction(fileName: string, text: string): Promise<{ error?: string; preview?: ImportPreview }> {
  const s = await requireSession();
  const big = tooBig(text);
  if (big) return { error: big };
  try {
    return { preview: previewRoundImport(s, fileName, text) };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    return { error: `The file could not be checked: ${(e as Error).message}` };
  }
}

export async function commitImportAction(
  fileName: string, text: string, fingerprint: string,
): Promise<{ error?: string; result?: CommitResult }> {
  const s = await requireSession();
  const big = tooBig(text);
  if (big) return { error: big };
  try {
    const result = commitRoundImport(s, fileName, text, fingerprint);
    revalidatePath('/import');
    revalidatePath('/cases');
    revalidatePath('/findings');
    revalidatePath('/hotspots');
    revalidatePath('/', 'layout');
    return { result };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    return { error: `The import could not be saved: ${(e as Error).message}` };
  }
}
