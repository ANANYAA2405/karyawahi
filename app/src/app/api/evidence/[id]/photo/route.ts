import { getSession } from '@/lib/session';
import { one } from '@/lib/db';
import { evidencePred } from '@/lib/scope';
import { readPhoto } from '@/lib/evidence-files';

/**
 * The photo attached to a piece of proof. Served only to someone who can see that proof, and
 * re-hashed on the way out: if the file on disk no longer matches the hash recorded when it was
 * submitted, it is refused rather than shown as proof.
 */
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response('Sign in first.', { status: 401 });
  const { id } = await params;
  const p = evidencePred(s, 'e');
  const visible = one<{ id: string }>(`select e.id from evidence e where e.id = ? and (${p.sql})`, id, ...p.params);
  if (!visible) return new Response('Not found.', { status: 404 });
  const photo = readPhoto(id);
  if (!photo) return new Response('No photo is attached to this proof.', { status: 404 });
  if (!photo.intact) return new Response('This photo no longer matches the hash recorded when it was submitted.', { status: 409 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
}
