'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { QUEUE_EVENT, flushQueue, setCurrentUser } from '@/lib/offline/queue';

/**
 * Offline support for field staff, on every signed-in page.
 *
 * - Registers public/sw.js, in production builds only and only for the field roles that land on
 *   My day. For anyone else (and in development) it removes any worker and saved pages an earlier
 *   field sign-in on this browser left behind.
 * - Tells the worker who is signed in, so pages saved for one person are dropped when another
 *   signs in on the same phone.
 * - On My day, asks the worker to keep a copy of the page, the task pages it links to, and the
 *   scripts and styles they need, so they open without signal.
 * - Sends proof waiting on the phone: on load and whenever the connection comes back.
 * - Says so when the page on screen is the saved copy ("offline — last updated …"), or when the
 *   signal drops while a live page is open.
 */
export function OfflineSupport({ userId, field, lang }: { userId: string; field: boolean; lang: Language }) {
  const router = useRouter();
  const pathname = usePathname();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [hidden, setHidden] = useState(false);

  // The worker, and who it is working for.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production' || !field) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if (typeof caches !== 'undefined') caches.keys().then((ks) => ks.filter((k) => k.startsWith('kv-')).forEach((k) => caches.delete(k))).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).then((reg) => {
      reg.active?.postMessage({ type: 'hello', userId });
    }).catch(() => { /* no worker: the page still works online, and the queue still sends on load */ });
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'proof-sent') { window.dispatchEvent(new Event(QUEUE_EVENT)); router.refresh(); }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [field, userId, router]);

  // Keep My day and its task pages for offline use, with what they need to run.
  useEffect(() => {
    if (!field || pathname !== '/today' || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    if (document.querySelector('meta[name="kv-offline-copy"]')) return; // this is already the saved copy
    const t = setTimeout(() => {
      navigator.serviceWorker.ready.then((reg) => {
        const pages = ['/today', ...new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/tasks/"]'))
          .map((a) => new URL(a.href).pathname).filter((p) => /^\/tasks\/[A-Za-z0-9-]+$/.test(p)))].slice(0, 40);
        const assets = performance.getEntriesByType('resource').map((r) => r.name)
          .filter((u) => u.startsWith(location.origin) && u.includes('/_next/static/'));
        reg.active?.postMessage({ type: 'keep', userId, pages, assets });
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [field, pathname, userId]);

  // Proof waiting on the phone goes as soon as there is a line.
  useEffect(() => {
    if (!field) return;
    const send = () => {
      flushQueue(userId).then((sent) => { if (sent.length) router.refresh(); }).catch(() => {});
    };
    setCurrentUser(userId).catch(() => {}).finally(send);
    window.addEventListener('online', send);
    return () => window.removeEventListener('online', send);
  }, [field, userId, router]);

  // Is this the saved copy, and is there signal?
  useEffect(() => {
    setSavedAt(document.querySelector('meta[name="kv-offline-copy"]')?.getAttribute('content') ?? null);
    setOffline(!navigator.onLine);
    setHidden(false);
    const on = () => { setOffline(false); setHidden(false); };
    const off = () => { setOffline(true); setHidden(false); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [pathname]);

  if ((!savedAt && !offline) || hidden) return null;
  const when = savedAt ? (() => {
    try { return new Date(Number(savedAt) || savedAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }); } catch { return savedAt; }
  })() : null;
  const back = !!when && !offline; // the saved copy is on screen, but the signal has returned

  return (
    <div role="status" data-testid="offline-banner"
      className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-lg border border-warn/40 bg-amber-light px-3.5 py-2 text-sm text-warn shadow-card no-print sm:bottom-6">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {back
            ? pick(lang, `Signal is back — this copy is from ${when}`, `सिग्नल लौट आया — यह प्रति ${when} की है`)
            : when
              ? pick(lang, `Offline — last updated ${when}`, `ऑफ़लाइन — अंतिम अपडेट ${when}`)
              : pick(lang, 'Offline — no signal', 'ऑफ़लाइन — सिग्नल नहीं')}
        </p>
        {back ? null : (
          <p className="text-xs leading-snug text-ink-soft">
            {pick(lang, 'Proof you hand in is kept on this phone and sent when the signal returns.', 'जमा किया सबूत इस फ़ोन पर रहेगा और सिग्नल लौटने पर भेजा जाएगा।')}
          </p>
        )}
      </div>
      {back ? (
        <button type="button" className="btn-quiet min-h-9 shrink-0 px-3" onClick={() => location.reload()}>{pick(lang, 'Refresh', 'ताज़ा करें')}</button>
      ) : (
        <button type="button" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-warn hover:bg-warn/10" onClick={() => setHidden(true)}
          aria-label={pick(lang, 'Hide this notice', 'यह सूचना छिपाएँ')}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}
