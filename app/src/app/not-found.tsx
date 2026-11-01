import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pick } from '@/lib/i18n';
import { Icon } from '@/components/Icon';

/**
 * No such page or record. Records outside the user's area say "outside your scope" on their own
 * page instead of coming here, so this means the address is wrong or the record does not exist.
 */
export default async function NotFound() {
  const lang = await getLanguage();
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-ink-faint"><Icon name="search" size={20} /></span>
          <div className="min-w-0 space-y-2">
            <h1 className="text-lg font-semibold text-ink">{pick(lang, 'Nothing at this address', 'इस पते पर कुछ नहीं मिला')}</h1>
            <p className="text-base text-ink-soft">
              {pick(
                lang,
                'The page or record does not exist. Check the id, or search for the case, school or report by name.',
                'यह पृष्ठ या रिकॉर्ड मौजूद नहीं है। पहचान संख्या जाँचें, या प्रकरण, विद्यालय या रिपोर्ट नाम से खोजें।',
              )}
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/search" className="btn-primary">{pick(lang, 'Search', 'खोजें')}</Link>
              <Link href="/" className="btn-quiet">{pick(lang, 'Go to your home page', 'मुख्य पृष्ठ')}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
