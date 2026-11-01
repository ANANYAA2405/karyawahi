'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { readLocation } from '@/lib/offline/geo';
import { enqueue, newClientId, sendProof, type QueuedProof } from '@/lib/offline/queue';
import { gpsText } from './GpsBadge';
import { NoteMic } from './voice';

const MAX_PHOTO = 5 * 1024 * 1024;

/**
 * Handing in proof from My day, with or without signal.
 *
 * On submit the phone's location is read once (src/lib/offline/geo.ts), then the proof goes to
 * /api/evidence/submit. With no connection — or if the send fails on the way — it is saved on
 * the phone instead (src/lib/offline/queue.ts) and listed as waiting to send; it goes when the
 * signal comes back. Every attempt carries the same client id, so the server records it once.
 *
 * The fields (photo, note) are passed in as children so the page keeps its own words. Under
 * them, where the browser can take dictation, a mic lets the note be spoken (src/components/voice.tsx).
 */
export function ProofForm({ taskId, schoolId, taskTitle, userId, lang, label, children }: {
  taskId: string; schoolId: string; taskTitle: string; userId: string; lang: Language; label: string; children: ReactNode;
}) {
  const router = useRouter();
  const idRef = useRef<string>('');
  const [gen, setGen] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'locating' | 'sending'>('idle');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'queued' | 'error'; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase !== 'idle') return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const note = String(data.get('note') ?? '').trim();
    const file = data.get('photo');
    const photo = file instanceof File && file.size > 0 ? file : null;
    setMsg(null);
    if (!note) { setMsg({ tone: 'error', text: pick(lang, 'Describe what the proof shows.', 'लिखें कि सबूत क्या दिखाता है।') }); return; }
    if (photo && photo.size > MAX_PHOTO) {
      setMsg({ tone: 'error', text: pick(lang, `The photo is ${(photo.size / 1048576).toFixed(1)} MB; the limit is 5 MB. Take it again.`, `फ़ोटो ${(photo.size / 1048576).toFixed(1)} MB है; सीमा 5 MB है। दोबारा लें।`) });
      return;
    }
    // The same id for every try of this proof, until it is accepted or saved.
    if (!idRef.current) idRef.current = newClientId();

    setPhase('locating');
    const fix = await readLocation();
    const item: QueuedProof = {
      id: idRef.current, userId, taskId, schoolId, taskTitle, note,
      photo, photoName: photo?.name ?? null,
      lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, gpsError: fix.error,
      savedAt: new Date().toISOString(), state: 'waiting', error: null, attempts: 0,
    };

    const keep = async () => {
      try {
        await enqueue(item);
        setMsg({ tone: 'queued', text: pick(lang,
          'No signal. The proof is saved on this phone and will be sent by itself when the connection is back.',
          'सिग्नल नहीं है। सबूत इस फ़ोन पर सहेजा गया है और कनेक्शन लौटते ही अपने आप भेजा जाएगा।') });
        idRef.current = '';
        setGen((g) => g + 1);
      } catch {
        setMsg({ tone: 'error', text: pick(lang, 'No signal, and the phone could not save the proof. Try again when you have signal.', 'सिग्नल नहीं है और फ़ोन सबूत सहेज नहीं सका। सिग्नल मिलने पर दोबारा प्रयास करें।') });
      }
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await keep();
      setPhase('idle');
      return;
    }
    setPhase('sending');
    const out = await sendProof(item, false);
    if (out.kind === 'sent') {
      const r = out.result;
      const where = gpsText(lang, r.gps.status, r.gps.distance_m);
      setMsg({ tone: 'ok', text: r.photo
        ? pick(lang, `Proof and photo submitted. Someone other than you has to check it. ${where}.`, `सबूत और फ़ोटो जमा हो गए। कोई और इनकी जाँच करेगा। ${where}।`)
        : pick(lang, `Proof submitted. Someone other than you has to check it. ${where}.`, `सबूत जमा हो गया। कोई और इसकी जाँच करेगा। ${where}।`) });
      idRef.current = '';
      setGen((g) => g + 1);
      router.refresh();
    } else if (out.kind === 'refused') {
      setMsg({ tone: 'error', text: out.error });
    } else {
      // Signed out, a dropped line or a server hiccup: keep it rather than lose it.
      await keep();
      if (out.kind === 'signed_out') {
        setMsg({ tone: 'queued', text: pick(lang, 'You are signed out. The proof is saved on this phone; sign in again and it will be sent.', 'आप साइन आउट हैं। सबूत इस फ़ोन पर सहेजा गया है; दोबारा साइन इन करने पर भेजा जाएगा।') });
      }
    }
    setPhase('idle');
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="school_id" value={schoolId} />
      {/* Remounted after each proof is handed in or saved, so the photo preview clears too. */}
      <div key={gen}>{children}</div>
      <NoteMic field="note" lang={lang} />
      <p className="mb-3 text-xs leading-snug text-ink-faint">
        {pick(lang,
          'When you press Hand in, the phone’s location is read once to check you are at the school. You are not tracked.',
          'जमा करें दबाने पर फ़ोन का स्थान एक बार पढ़ा जाता है, यह देखने के लिए कि आप विद्यालय पर हैं। आपका पीछा नहीं किया जाता।')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary min-h-11 px-5" disabled={phase !== 'idle'}>
          {phase === 'locating' ? pick(lang, 'Finding your location…', 'स्थान देखा जा रहा है…')
            : phase === 'sending' ? pick(lang, 'Sending…', 'भेजा जा रहा है…')
            : label}
        </button>
      </div>
      {msg ? (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-2 rounded-md border px-3 py-2 text-sm leading-relaxed ${
          msg.tone === 'ok' ? 'border-good/30 bg-good-light text-good'
          : msg.tone === 'queued' ? 'border-warn/30 bg-warn-light text-warn'
          : 'border-crit/30 bg-crit-light text-crit'}`}>
          {msg.tone === 'error' ? <span className="font-semibold">{pick(lang, 'Refused. ', 'अस्वीकृत। ')}</span> : null}{msg.text}
        </p>
      ) : null}
    </form>
  );
}
