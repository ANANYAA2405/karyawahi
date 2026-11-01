import Link from 'next/link';
import type { Language } from '@domain/types';
import { t, pick } from '@/lib/i18n';
import { realDataVersion } from '@/lib/ext/realdata';

/**
 * The words in the demo strip at the top of every signed-in page, and the link to /sources.
 * With the real-data layer on it says what is real (schools) and what is not (learning
 * results); without it, the original "fictional seed data" wording.
 */
export function DemoBannerText({ lang }: { lang: Language }) {
  const real = !!realDataVersion();
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5">
      <span>{t(lang, real ? 'demoBannerReal' : 'demoBanner')}</span>
      <Link href="/sources" className="underline decoration-warn/40 underline-offset-2 hover:decoration-warn">{pick(lang, 'Sources', 'स्रोत')}</Link>
    </span>
  );
}
