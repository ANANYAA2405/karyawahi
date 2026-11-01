'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { QUEUE_EVENT, flushQueue, listQueued, removeQueued, retryQueued, type QueuedProof } from '@/lib/offline/queue';

/**
 * Proof saved on this phone and not yet sent, at the top of My day.
 *
 * Read from IndexedDB in the browser, so nothing renders on the server and nothing shows when
 * the queue is empty. Waiting items go by themselves when the signal returns (OfflineSupport
 * flushes on load and on `online`); one the server refused for a reason a retry will not fix
 * (the task was cancelled, the photo was already used) stays here with that reason until the
 * person removes it.
 */
export function ProofQueue({ userId, lang }: { userId: string; lang: Language }) {
  const [items, setItems] = useState<QueuedProof[]>([]);
  const [online, setOnline] = useState(true);

  const load = useCallback(() => { listQueued(userId).then(setItems).catch(() => setItems([])); }, [userId]);
  useEffect(() => {
    load();
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener(QUEUE_EVENT, load);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener(QUEUE_EVENT, load); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [load]);

  if (items.length === 0) return null;
  const time = (iso: string) => {
    try { return new Date(iso).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }); } catch { return iso; }
  };

  return (
    <section aria-labelledby="g-queue" className="rounded-xl border border-warn/30 bg-warn-light/60 p-4">
      <h2 id="g-queue" className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-[0.06em] text-warn">
        {pick(lang, 'Waiting to send', 'भेजने की प्रतीक्षा में')}<span className="tnum font-normal">{items.length}</span>
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {online
          ? pick(lang, 'Saved on this phone. Sending now that there is signal.', 'इस फ़ोन पर सहेजा गया। सिग्नल है, भेजा जा रहा है।')
          : pick(lang, 'Saved on this phone. It will be sent by itself when the signal comes back.', 'इस फ़ोन पर सहेजा गया। सिग्नल लौटते ही अपने आप भेजा जाएगा।')}
      </p>
      <div role="list" className="mt-3 space-y-2" data-testid="proof-queue">
        {items.map((p) => (
          <div role="listitem" key={p.id} data-queue-state={p.state} className="rounded-lg border border-line bg-white px-3 py-2.5">
            <p className="text-md font-medium leading-snug text-ink">{p.taskTitle}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{p.note}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
              <span>{pick(lang, 'Saved', 'सहेजा')} {time(p.savedAt)}</span>
              {p.photo ? <span>{pick(lang, 'with photo', 'फ़ोटो सहित')}</span> : null}
              <span>{p.lat !== null ? pick(lang, 'location recorded', 'स्थान दर्ज') : pick(lang, 'no location', 'स्थान नहीं')}</span>
            </p>
            {p.state === 'refused' ? (
              <div className="mt-2 rounded-md border border-crit/30 bg-crit-light px-2.5 py-2 text-sm text-crit">
                <p><span className="font-semibold">{pick(lang, 'Not accepted:', 'स्वीकार नहीं:')}</span> {p.error}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-quiet min-h-10 px-3" onClick={() => retryQueued(p.id).then(() => flushQueue(userId))}>{pick(lang, 'Try again', 'फिर से भेजें')}</button>
                  <button type="button" className="btn-quiet min-h-10 px-3" onClick={() => { if (window.confirm(pick(lang, 'Remove this proof from the phone? It has not been sent.', 'यह सबूत फ़ोन से हटाएँ? यह भेजा नहीं गया है।'))) removeQueued(p.id); }}>{pick(lang, 'Remove', 'हटाएँ')}</button>
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-sm font-medium text-warn">
                {p.state === 'sending' ? pick(lang, 'Sending…', 'भेजा जा रहा है…')
                  : p.state === 'signed_out' ? pick(lang, 'Sign in again to send it.', 'भेजने के लिए दोबारा साइन इन करें।')
                  : pick(lang, 'Waiting to send', 'भेजने की प्रतीक्षा में')}
              </p>
            )}
          </div>
        ))}
      </div>
      {online ? (
        <button type="button" className="btn-quiet mt-3 min-h-11 px-4" onClick={() => flushQueue(userId)}>{pick(lang, 'Send now', 'अभी भेजें')}</button>
      ) : null}
    </section>
  );
}
