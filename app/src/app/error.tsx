'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';

/**
 * A page that failed to render. This is a bug, not a refusal (refusals are shown next to the
 * button that caused them), so it says so, offers a retry, and gives the reference the server
 * logged so it can be found.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const hindi = typeof document !== 'undefined' && document.documentElement.lang === 'hi';
  return (
    <div className="mx-auto max-w-xl py-10" role="alert">
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-crit"><Icon name="alert" size={20} /></span>
          <div className="min-w-0 space-y-2">
            <h1 className="text-lg font-semibold text-ink">
              {hindi ? 'यह पृष्ठ नहीं खुल सका' : 'This page could not be shown'}
            </h1>
            <p className="text-base text-ink-soft">
              {hindi
                ? 'कुछ गलत हो गया। आपका कोई बदलाव अधूरा नहीं छूटा: हर बदलाव या तो पूरा सहेजा जाता है या बिल्कुल नहीं।'
                : 'Something went wrong on our side. No change of yours was left half-done: every change is saved completely or not at all.'}
            </p>
            {error.digest ? (
              <p className="text-xs text-ink-faint">
                {hindi ? 'संदर्भ' : 'Reference'} <span className="font-mono">{error.digest}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" onClick={reset} className="btn-primary">{hindi ? 'फिर से प्रयास करें' : 'Try again'}</button>
              <Link href="/" className="btn-quiet">{hindi ? 'मुख्य पृष्ठ' : 'Go to your home page'}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
