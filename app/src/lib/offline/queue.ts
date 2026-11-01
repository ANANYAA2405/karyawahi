/**
 * Proof waiting on the phone to be sent. Browser only.
 *
 * When a field worker hands in proof with no signal (or the line drops mid-send), the note,
 * the shrunk photo and the GPS fix are kept in IndexedDB under an id made up on the phone. They
 * are sent when the connection returns: on the `online` event, on every page load, and by the
 * service worker's background sync where the browser has it (public/sw.js reads this same
 * database). The server keeps one row per (submitter, id), so a proof sent twice — by the page
 * and the worker at once, or because the answer was lost — is still one piece of proof.
 *
 * Each item belongs to the person who saved it. Only that person's items are listed or sent,
 * so a phone shared between two people never sends one person's proof under the other's name.
 *
 * Keep the database layout in step with public/sw.js.
 */

export const DB_NAME = 'karyavahi-offline';
const DB_VERSION = 1;
const PROOFS = 'proofs';
const META = 'meta';
export const QUEUE_EVENT = 'kv-proof-queue';
export const SYNC_TAG = 'kv-proof-sync';

export type QueueState = 'waiting' | 'sending' | 'refused' | 'signed_out';

export interface QueuedProof {
  id: string;
  userId: string;
  taskId: string;
  schoolId: string;
  /** The task's title in the language it was saved in, to list it while offline. */
  taskTitle: string;
  note: string;
  photo: Blob | null;
  photoName: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  gpsError: string | null;
  savedAt: string;
  state: QueueState;
  error: string | null;
  attempts: number;
}

export interface SendResult {
  ok: true; evidence_id: string; duplicate: boolean; photo: boolean;
  gps: { status: string; distance_m: number | null; accuracy_m: number | null };
}

/** An id for a new piece of proof: random, URL-safe, accepted by the server's check. */
export function newClientId(): string {
  try { if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* old browser */ }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROOFS)) db.createObjectStore(PROOFS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => { try { window.dispatchEvent(new Event(QUEUE_EVENT)); } catch { /* not in a page */ } };

/** Who is signed in on this phone, so the service worker sends only their proof. */
export async function setCurrentUser(userId: string | null): Promise<void> {
  await withStore(META, 'readwrite', (s) => { if (userId) s.put({ key: 'user', value: userId }); else s.delete('user'); });
}

export async function listQueued(userId: string): Promise<QueuedProof[]> {
  const all = (await withStore<QueuedProof[]>(PROOFS, 'readonly', (s) => s.getAll() as IDBRequest<QueuedProof[]>)) ?? [];
  return all.filter((p) => p.userId === userId).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

export async function enqueue(p: QueuedProof): Promise<void> {
  await withStore(PROOFS, 'readwrite', (s) => s.put(p));
  changed();
  // Background sync, where the browser has it, sends it even if the page is closed by then.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sync = (reg as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)?.sync;
    await sync?.register(SYNC_TAG);
  } catch { /* not available: the online event and the next page load send it */ }
}

export async function removeQueued(id: string): Promise<void> {
  await withStore(PROOFS, 'readwrite', (s) => s.delete(id));
  changed();
}

async function patch(id: string, change: Partial<QueuedProof>): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROOFS, 'readwrite');
      const st = tx.objectStore(PROOFS);
      const g = st.get(id);
      g.onsuccess = () => { if (g.result) st.put({ ...g.result, ...change }); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  changed();
}

/** The form the server reads, from a queued (or just-taken) proof. */
export function toFormData(p: QueuedProof, offline: boolean): FormData {
  const f = new FormData();
  f.set('client_id', p.id);
  f.set('task_id', p.taskId);
  f.set('school_id', p.schoolId);
  f.set('note', p.note);
  if (p.lat !== null && p.lng !== null) {
    f.set('lat', String(p.lat));
    f.set('lng', String(p.lng));
    if (p.accuracy !== null) f.set('accuracy', String(p.accuracy));
  }
  if (p.gpsError) f.set('gps_error', p.gpsError);
  if (offline) f.set('saved_offline_at', p.savedAt);
  if (p.photo) f.set('photo', p.photo, p.photoName ?? 'photo.jpg');
  return f;
}

export type Outcome =
  | { kind: 'sent'; result: SendResult }
  | { kind: 'refused'; error: string }
  | { kind: 'signed_out'; error: string }
  | { kind: 'retry'; error: string };

/** One attempt to send. Never throws: the outcome says whether to keep, drop or retry it. */
export async function sendProof(p: QueuedProof, offline: boolean, timeoutMs = 90_000): Promise<Outcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/evidence/submit', { method: 'POST', body: toFormData(p, offline), signal: ctl.signal, credentials: 'same-origin' });
    const body = await res.json().catch(() => ({} as { error?: string }));
    if (res.ok && body.ok) return { kind: 'sent', result: body as SendResult };
    if (res.status === 401) return { kind: 'signed_out', error: body.error ?? 'Signed out.' };
    if (res.status >= 400 && res.status < 500 && ![408, 425, 429].includes(res.status)) return { kind: 'refused', error: body.error ?? `Refused (${res.status}).` };
    return { kind: 'retry', error: body.error ?? `Server error ${res.status}.` };
  } catch (e) {
    return { kind: 'retry', error: (e as Error).name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

let flushing: Promise<SendResult[]> | null = null;

/**
 * Send everything this person has waiting. One flush at a time per page, and across the page
 * and the service worker where Web Locks exist; the server's client-id check covers the rest.
 */
export function flushQueue(userId: string): Promise<SendResult[]> {
  if (flushing) return flushing;
  const run = async (): Promise<SendResult[]> => {
    const sent: SendResult[] = [];
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return sent;
    for (const p of await listQueued(userId)) {
      if (p.state === 'refused') continue;
      await patch(p.id, { state: 'sending' });
      const out = await sendProof(p, true);
      if (out.kind === 'sent') {
        await removeQueued(p.id);
        sent.push(out.result);
      } else if (out.kind === 'refused') {
        await patch(p.id, { state: 'refused', error: out.error, attempts: p.attempts + 1 });
      } else if (out.kind === 'signed_out') {
        await patch(p.id, { state: 'signed_out', error: out.error, attempts: p.attempts + 1 });
        break;
      } else {
        await patch(p.id, { state: 'waiting', error: out.error, attempts: p.attempts + 1 });
        break; // no line: the rest would fail the same way
      }
    }
    return sent;
  };
  const locks = (navigator as Navigator & { locks?: { request<T>(name: string, cb: () => Promise<T>): Promise<T> } }).locks;
  flushing = (locks ? locks.request('kv-proof-flush', run) : run()).finally(() => { flushing = null; });
  return flushing;
}

/** Put a refused proof back in line, for when the reason has been dealt with. */
export async function retryQueued(id: string): Promise<void> {
  await patch(id, { state: 'waiting', error: null });
}
