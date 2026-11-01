import 'server-only';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { one } from './db';
import { Refused } from './guard';

/**
 * Photos attached to proof.
 *
 * The browser shrinks a photo before sending it, but nothing it says about the file is trusted:
 * the server reads the first bytes to decide what kind of image it is, refuses anything else or
 * anything too large, and computes the SHA-256 itself. The file is stored under that hash, and
 * every time it is served the hash is computed again, so a file swapped on disk is refused rather
 * than shown as proof.
 */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const DIR = join(process.cwd(), '.data', 'evidence-files');

const KINDS = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', ext: 'webp', test: (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
] as const;

export interface CheckedPhoto { bytes: Uint8Array; sha256: string; mime: string; ext: string; name: string }

/** Check an uploaded photo and hash it. Throws a refusal the user can act on. */
export function checkPhoto(bytes: Uint8Array, name: string): CheckedPhoto {
  if (bytes.length === 0) throw new Refused('The photo is empty. Take it again.', 'bad_photo');
  if (bytes.length > PHOTO_MAX_BYTES) {
    throw new Refused(`The photo is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 5 MB.`, 'bad_photo');
  }
  const kind = KINDS.find((k) => k.test(bytes));
  if (!kind) throw new Refused('Only a JPEG, PNG or WebP photo can be attached as proof.', 'bad_photo');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), mime: kind.mime, ext: kind.ext, name: name.slice(0, 120) };
}

/** The proof a photo was already attached to, if any: the same picture cannot prove two things. */
export function photoAlreadyUsed(sha256: string): { evidence_id: string; task_id: string } | null {
  return one<{ evidence_id: string; task_id: string }>(
    `select f.evidence_id, e.task_id from evidence_files f join evidence e on e.id = f.evidence_id
      where f.sha256 = ? and e.status <> 'rejected' limit 1`, sha256,
  ) ?? null;
}

export function storePhoto(p: CheckedPhoto): void {
  mkdirSync(DIR, { recursive: true });
  const path = join(DIR, `${p.sha256}.${p.ext}`);
  if (!existsSync(path)) writeFileSync(path, p.bytes);
}

/** The stored photo for a piece of evidence, re-hashed. `intact` is false when the bytes on disk
 *  no longer match the hash recorded when it was submitted. */
export function readPhoto(evidenceId: string): { bytes: Buffer; mime: string; intact: boolean } | null {
  const row = one<{ sha256: string; mime: string }>('select sha256, mime from evidence_files where evidence_id = ?', evidenceId);
  if (!row) return null;
  const ext = KINDS.find((k) => k.mime === row.mime)?.ext ?? 'bin';
  const path = join(DIR, `${row.sha256}.${ext}`);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return { bytes, mime: row.mime, intact: createHash('sha256').update(bytes).digest('hex') === row.sha256 };
}
