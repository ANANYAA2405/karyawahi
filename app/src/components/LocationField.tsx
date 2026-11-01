'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { readLocation } from '@/lib/offline/geo';
import { newClientId } from '@/lib/offline/queue';

/**
 * Put inside a proof form that posts to a server action (the task page). When the form is
 * submitted it holds the submit, reads the phone's location once, writes lat / lng / accuracy
 * (or why there is none) and a client id into hidden fields, and lets the submit go on. The
 * server works out the distance to the school and the GPS status from those numbers.
 */
export function LocationField({ lang }: { lang: Language }) {
  const ref = useRef<HTMLDivElement>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    let ready = false;
    const set = (name: string, value: string) => { const el = form.querySelector<HTMLInputElement>(`input[data-kv-loc="${name}"]`); if (el) el.value = value; };
    const onSubmit = (e: SubmitEvent) => {
      if (ready) { ready = false; return; } // second pass: the fields are filled, let the action run
      e.preventDefault();
      e.stopPropagation();
      const submitter = e.submitter as HTMLButtonElement | null;
      setLocating(true);
      readLocation().then((fix) => {
        set('lat', fix.lat === null ? '' : String(fix.lat));
        set('lng', fix.lng === null ? '' : String(fix.lng));
        set('accuracy', fix.accuracy === null ? '' : String(fix.accuracy));
        set('gps_error', fix.error ?? '');
        const id = form.querySelector<HTMLInputElement>('input[data-kv-loc="client_id"]');
        if (id && !id.value) id.value = newClientId();
        setLocating(false);
        ready = true;
        if (submitter && submitter.form === form) form.requestSubmit(submitter); else form.requestSubmit();
      });
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  return (
    <div ref={ref} className="mb-2">
      {['lat', 'lng', 'accuracy', 'gps_error', 'client_id'].map((n) => (
        <input key={n} type="hidden" name={n} data-kv-loc={n} defaultValue="" />
      ))}
      <p className="text-xs leading-snug text-ink-faint">
        {locating
          ? pick(lang, 'Finding your location…', 'स्थान देखा जा रहा है…')
          : pick(lang, 'The phone’s location is read once when you submit, to check you are at the school. You are not tracked.', 'जमा करते समय फ़ोन का स्थान एक बार पढ़ा जाता है, यह देखने के लिए कि आप विद्यालय पर हैं। आपका पीछा नहीं किया जाता।')}
      </p>
    </div>
  );
}
