import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { search, type SearchHit } from '@/lib/search';
import { pick } from '@/lib/i18n';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { q = '' } = await searchParams;
  const r = search(session, q);

  const groups: { key: string; title: string; icon: string; hits: SearchHit[] }[] = [
    { key: 'cases', title: pick(lang, 'Cases', 'प्रकरण'), icon: 'briefcase', hits: r.cases },
    { key: 'schools', title: pick(lang, 'Schools', 'विद्यालय'), icon: 'school', hits: r.schools },
    { key: 'interventions', title: pick(lang, 'Interventions', 'हस्तक्षेप'), icon: 'flask', hits: r.interventions },
    { key: 'tasks', title: pick(lang, 'Tasks', 'काम'), icon: 'clipboard', hits: r.tasks },
    { key: 'reports', title: pick(lang, 'Reports', 'रिपोर्ट'), icon: 'file', hits: r.reports },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead
        title={pick(lang, 'Search', 'खोज')}
        sub={pick(lang, 'Searches only the records you are authorised to see.', 'केवल वही रिकॉर्ड खोजे जाते हैं जिन्हें देखने की आपको अनुमति है।')}
      />
      <form action="/search" method="get" role="search" className="relative mb-6">
        <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="search" name="q" defaultValue={q} autoFocus minLength={2} maxLength={80}
          aria-label={pick(lang, 'Search', 'खोज')}
          placeholder={pick(lang, 'Case ID, school name, village, intervention, task…', 'प्रकरण आईडी, विद्यालय, गाँव, हस्तक्षेप…')}
          className="input h-12 pl-11 text-md"
        />
      </form>

      {q.trim().length < 2 ? (
        <div className="card card-pad text-base text-ink-soft">
          <p className="font-medium text-ink">{pick(lang, 'Try', 'उदाहरण')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {['CASE-0184', 'subtraction', 'Rampur', 'remedial', 'TaRL'].map((x) => (
              <Link key={x} href={`/search?q=${encodeURIComponent(x)}`} className="rounded-full border border-line-strong bg-white px-3 py-1 text-sm hover:border-brand hover:text-brand">{x}</Link>
            ))}
          </div>
        </div>
      ) : r.total === 0 ? (
        <div className="card px-6 py-12 text-center">
          <Icon name="search" size={28} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-medium text-ink">{pick(lang, `Nothing matches “${r.q}”`, `“${r.q}” से कुछ नहीं मिला`)}</p>
          <p className="mt-1 text-sm text-ink-soft">{pick(lang, 'Records outside your scope are never shown.', 'आपके दायरे से बाहर के रिकॉर्ड नहीं दिखाए जाते।')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-ink-faint">{r.total} {pick(lang, 'results', 'परिणाम')}</p>
          {groups.filter((g) => g.hits.length > 0).map((g) => (
            <section key={g.key} className="card overflow-hidden">
              <h2 className="flex items-center gap-2 border-b border-line bg-paper-sunk px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                <Icon name={g.icon} size={15} />{g.title}<span className="tnum">({g.hits.length})</span>
              </h2>
              <ul className="divide-y divide-line">
                {g.hits.map((h) => (
                  <li key={h.id}>
                    <Link href={h.href} className="flex items-center gap-3 px-4 py-3 hover:bg-paper-sunk">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium text-ink">{h.title}</p>
                        <p className="truncate text-sm text-ink-faint"><span className="font-mono">{h.id}</span> · {h.sub}</p>
                      </div>
                      <Icon name="chevron-right" size={16} className="text-ink-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
