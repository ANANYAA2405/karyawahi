import { getLanguage } from '@/lib/session';

/**
 * Shown while a page renders. Every page reads the database per request, so without this the
 * screen stays on the previous page with no sign that anything is happening. The shape follows
 * the common layout: a title, a row of figures, and two panels.
 */
export default async function Loading() {
  const lang = await getLanguage();
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">{lang === 'hi' ? 'लोड हो रहा है…' : 'Loading…'}</span>
      <div className="space-y-2">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-7 w-80 max-w-full" />
        <div className="skeleton h-3 w-56 max-w-full" />
      </div>
      <div className="card grid grid-cols-2 divide-x divide-line overflow-hidden sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`space-y-2 p-4 ${i > 1 ? 'hidden sm:block' : ''}`}>
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-4 w-40" />
            {[0, 1, 2, 3].map((j) => <div key={j} className="skeleton h-10 w-full" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
