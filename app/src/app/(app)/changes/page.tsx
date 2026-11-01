import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { loadChanges } from '@/lib/changes';
import { mayReview } from '@/lib/feedback';
import { pick } from '@/lib/i18n';
import { ROLE_LABELS } from '@domain/permissions';
import { PageHead, Callout, Card, fmtDate } from '@/components/ui';
import { Pill } from '@/components/labels';

/**
 * What we changed after testing. Every signed-in user can read it: the people who gave feedback
 * should be able to see what came of it. Entries come from app/data/changes.json, written by the
 * team after each round of testing (docs/user-testing/analysis.md). Feedback ids, where an entry
 * has them, link to the review page for reviewers; everyone else sees only how many there were.
 */
export default async function ChangesPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const { entries } = loadChanges();
  const real = entries.filter((e) => !e.placeholder);
  const placeholders = entries.filter((e) => e.placeholder);
  const reviewer = mayReview(session);
  const roleLabel = (r: string) => {
    const l = ROLE_LABELS[r as keyof typeof ROLE_LABELS];
    return l ? pick(lang, l.en, l.hi) : r;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHead
        title={pick(lang, 'What we changed after testing', 'परीक्षण के बाद हमने क्या बदला')}
        sub={pick(
          lang,
          'Improvements made because of what block officers, coordinators, headmasters and teachers told us — in testing sessions and with the Feedback button. What people said is paraphrased, and we name roles, never people.',
          'खंड अधिकारियों, समन्वयकों, प्रधानाध्यापकों और शिक्षकों ने जो बताया — परीक्षण सत्रों में और "सुझाव दें" बटन से — उसके कारण किए गए सुधार। लोगों की बात अपने शब्दों में लिखी है, और हम भूमिका बताते हैं, कभी नाम नहीं।',
        )}
        meta={<span>{real.length} {pick(lang, real.length === 1 ? 'change so far' : 'changes so far', 'बदलाव अब तक')}</span>}
      />

      {placeholders.map((e) => (
        <Callout key={e.id} tone="method" title={pick(lang, 'Nothing to report yet', 'अभी बताने को कुछ नहीं')}>
          <p>{pick(lang, e.said, e.said_hi ?? e.said)}</p>
          <p className="mt-1">{pick(lang, e.changed, e.changed_hi ?? e.changed)}</p>
        </Callout>
      ))}

      {real.length > 0 ? (
        <ol className="space-y-4">
          {real.map((e) => (
            <li key={e.id}>
              <Card>
                <div className="card-pad space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tnum text-sm font-medium text-ink">{fmtDate(e.date, false, lang)}</span>
                    {e.roles.map((r) => <Pill key={r} tone="active">{roleLabel(r)}</Pill>)}
                    <span className="ml-auto font-mono text-2xs text-ink-faint">{e.id}</span>
                  </div>
                  <div>
                    <p className="label">{pick(lang, 'What users said', 'उपयोगकर्ताओं ने क्या कहा')}</p>
                    <p className="mt-0.5 text-base text-ink">{pick(lang, e.said, e.said_hi ?? e.said)}</p>
                    {e.who ? <p className="mt-0.5 text-sm text-ink-soft">— {pick(lang, e.who, e.who_hi ?? e.who)}</p> : null}
                  </div>
                  <div>
                    <p className="label">{pick(lang, 'What we changed', 'हमने क्या बदला')}</p>
                    <p className="mt-0.5 text-base text-ink">{pick(lang, e.changed, e.changed_hi ?? e.changed)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {e.link ? <Link href={e.link} className="link">{pick(lang, 'See the page', 'पृष्ठ देखें')} →</Link> : null}
                    {e.feedback_ids.length > 0 ? (
                      reviewer ? (
                        <span className="text-ink-soft">
                          {pick(lang, 'Based on feedback', 'आधार सुझाव')}:{' '}
                          {e.feedback_ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<Link href={`/admin/feedback#${id}`} className="link font-mono text-xs">{id}</Link></span>)}
                        </span>
                      ) : (
                        <span className="text-ink-soft">{pick(lang, `Based on ${e.feedback_ids.length} piece(s) of in-app feedback`, `${e.feedback_ids.length} ऐप सुझावों के आधार पर`)}</span>
                      )
                    ) : null}
                    {e.session_refs.length > 0 ? (
                      <span className="text-ink-faint">{pick(lang, 'Testing sessions', 'परीक्षण सत्र')}: {e.session_refs.join(', ')}</span>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="text-sm text-ink-soft">
        {pick(lang, 'Something still gets in the way? Tell us with the Feedback button at the top of any page.', 'अब भी कोई दिक्कत है? किसी भी पृष्ठ के ऊपर दिए "सुझाव दें" बटन से बताइए।')}
        {reviewer ? <> · <Link href="/admin/feedback" className="link">{pick(lang, 'Read the feedback', 'सुझाव पढ़ें')}</Link></> : null}
      </p>
    </div>
  );
}
