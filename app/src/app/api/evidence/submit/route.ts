import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { isCrossSite } from '@/lib/http';
import { Refused } from '@/lib/guard';
import { submitEvidence } from '@/lib/write';

/**
 * Proof handed in from My day, including proof the phone saved while it had no signal and is
 * sending now (from the page or from the service worker's background sync).
 *
 * Same rules as the server action: the guarded write layer decides who may hand in proof for
 * which task. What this route adds is a plain HTTP answer a retry loop can read:
 *
 *   200 { ok, evidence_id, duplicate, gps }  stored (or already stored under this client_id)
 *   401                                      signed out: keep it on the phone until they sign in
 *   4xx { error, code }                      refused for a reason a retry will not change
 *   5xx                                      try again later
 *
 * A retry with the same client_id never adds a second row (see submitEvidence).
 */
export const runtime = 'nodejs';

const MAX_BODY = 8 * 1024 * 1024; // the photo itself is refused over 5 MB by checkPhoto

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  if (isCrossSite(req)) return json({ error: 'Cross-site request refused.', code: 'cross_site' }, 403);
  const s = await getSession();
  if (!s) return json({ error: 'Sign in again to send this proof.', code: 'signed_out' }, 401);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json({ error: 'The proof is too large to send; the photo limit is 5 MB.', code: 'too_large' }, 413);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'The proof could not be read.', code: 'bad_form' }, 400); }
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const file = form.get('photo');
  const photo = file instanceof File && file.size > 0
    ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || 'photo.jpg' }
    : null;
  const taskId = str('task_id');

  try {
    const r = submitEvidence(s, {
      taskId,
      note: str('note'),
      schoolId: str('school_id') || null,
      location: { lat: str('lat'), lng: str('lng'), accuracy: str('accuracy') },
      locationError: str('gps_error') || null,
      clientId: str('client_id') || null,
      savedOfflineAt: str('saved_offline_at') || null,
      photo,
    });
    revalidatePath('/today');
    revalidatePath(`/tasks/${taskId}`);
    return json({
      ok: true, evidence_id: r.evidenceId, duplicate: r.duplicate, photo: !!photo,
      gps: { status: r.gps.status, distance_m: r.gps.distance_m, accuracy_m: r.gps.fix && Number.isFinite(r.gps.fix.accuracy) ? Math.round(r.gps.fix.accuracy) : null },
    });
  } catch (e) {
    if (e instanceof Refused) {
      const status = e.code === 'not_found' ? 404 : e.code === 'not_owner' || e.code === 'role' ? 403 : 422;
      return json({ error: e.message, code: e.code }, status);
    }
    console.error('[evidence/submit]', e);
    return json({ error: 'The server could not save the proof. It will be tried again.', code: 'server_error' }, 500);
  }
}
