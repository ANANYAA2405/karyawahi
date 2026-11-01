import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listFeedback, feedbackSummary, mayReview, type FeedbackFilter } from '@/lib/feedback';
import { FEEDBACK_KINDS, FEEDBACK_TAGS, KIND_LABEL, TAG_LABEL, type FeedbackKind, type FeedbackTag } from '@/lib/feedback-shared';
import { pick } from '@/lib/i18n';
import { ROLE_LABELS } from '@domain/permissions';
import type { RoleCode } from '@domain/types';
import { PageHead, Callout, Card, CardHead, Empty, Grid, Stat, Bar, fmtDate, fmtInt } from '@/components/ui';
import { Pill } from '@/components/labels';

/**
 * What people said about the app. The state programme team and the demo administrator see the
 * counts, a simple picture (ratings by page and kind, the most common reasons on a thumbs down),
 * every piece of feedback with filters, and a CSV for the user-testing analysis
 * (docs/user-testing/analysis.md). Everyone else is told who can read it; their own feedback is
 * never shown to other users.
 */

type SP = { kind?: string; tone?: string; tag?: string; role?: string; page?: string };

export default async function FeedbackReviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!mayReview(session)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHead title={pick(lang, 'User feedback', 'उपयोगकर्ता सुझाव')} />
        <Callout tone="warn">
          {pick(
            lang,
            'Only the state programme team and the demo administrator can read feedback. You can still give feedback from any page with the Feedback button at the top.',
            'सुझाव केवल राज्य कार्यक्रम दल और डेमो प्रशासक पढ़ सकते हैं। आप ऊपर दिए "सुझाव दें" बटन से किसी भी पृष्ठ से सुझाव दे सकते हैं।',
          )}
        </Callout>
        <p className="text-sm"><Link href="/changes" className="link">{pick(lang, 'What we changed after testing', 'परीक्षण के बाद हमने क्या बदला')}</Link></p>
      </div>
    );
  }

  const filter: FeedbackFilter = { kind: sp.kind, tone: sp.tone, tag: sp.tag, role: sp.role, page: sp.page, limit: 300 };
  const rows = listFeedback(session, filter);
  const sum = feedbackSummary(session)!;
  const roleLabel = (r: string) => {
    const l = ROLE_LABELS[r as RoleCode];
    return l ? pick(lang, l.en, l.hi) : r;
  };
  const kindLabel = (k: string) => (KIND_LABEL[k as FeedbackKind] ? pick(lang, KIND_LABEL[k as FeedbackKind].en, KIND_LABEL[k as FeedbackKind].hi) : k);
  const tagLabel = (t: string) => (TAG_LABEL[t as FeedbackTag] ? pick(lang, TAG_LABEL[t as FeedbackTag].en, TAG_LABEL[t as FeedbackTag].hi) : t);

  const active = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === 'string' && v)) as Record<string, string>;
  /** A link that sets (or clears) one filter and keeps the others. */
  const href = (key: keyof SP, value: string | null) => {
    const next = new URLSearchParams(active);
    if (value) next.set(key, value); else next.delete(key);
    const q = next.toString();
    return q ? `/admin/feedback?${q}` : '/admin/feedback';
  };
  const exportHref = `/api/feedback/export${new URLSearchParams(active).toString() ? `?${new URLSearchParams(active).toString()}` : ''}`;
  const chip = (key: keyof SP, value: string | null, label: string) => {
    const on = (active[key] ?? null) === value;
    return (
      <Link key={`${key}-${value ?? 'all'}`} href={href(key, value)} aria-current={on ? 'true' : undefined}
        className={`chip min-h-8 px-3 text-xs ${on ? 'border-brand bg-brand text-white' : 'border-line-strong bg-white text-ink-soft hover:bg-paper-sunk'}`}>
        {label}
      </Link>
    );
  };

  const claudeUp = sum.claude.reduce((n, c) => n + c.up, 0);
  const claudeDown = sum.claude.reduce((n, c) => n + c.down, 0);
  const pageMax = Math.max(1, ...sum.byPage.map((p) => p.forms + p.up + p.down));
  const tagMax = Math.max(1, ...sum.tags.map((t) => t.c));
  const roles = sum.byRole.map((r) => r.role);

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/admin" className="link">{pick(lang, 'Administration', 'प्रशासन')}</Link>}
        title={pick(lang, 'User feedback', 'उपयोगकर्ता सुझाव')}
        sub={pick(
          lang,
          'What people said while using the app: thumbs up or down on Claude, and the feedback form on every page. Use it with the session notes from user testing to decide what to change, then record the change on the "What we changed" page.',
          'ऐप उपयोग करते हुए लोगों ने क्या कहा: Claude पर पसंद-नापसंद और हर पृष्ठ का सुझाव फ़ॉर्म। उपयोगकर्ता परीक्षण के नोट्स के साथ इसे देखकर तय करें कि क्या बदलना है, फिर बदलाव "हमने क्या बदला" पृष्ठ पर दर्ज करें।',
        )}
        right={
          <div className="flex flex-wrap gap-2">
            <Link href="/changes" className="btn-quiet">{pick(lang, 'What we changed', 'हमने क्या बदला')}</Link>
            <a href={exportHref} className="btn-primary" download>{pick(lang, 'Export CSV', 'CSV निकालें')}</a>
          </div>
        }
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Responses', 'उत्तर')} value={fmtInt(sum.total)} sub={`${fmtInt(sum.people)} ${pick(lang, 'people', 'लोग')}`} />
        <Stat label={pick(lang, 'Feedback forms', 'सुझाव फ़ॉर्म')} value={fmtInt(sum.forms)}
          sub={sum.formAvg !== null ? `${pick(lang, 'average ease', 'औसत आसानी')} ${sum.formAvg} / 5` : pick(lang, 'none yet', 'अभी कोई नहीं')} tone="brand" />
        <Stat label={pick(lang, 'Claude: useful', 'Claude: काम का')} value={fmtInt(claudeUp)} tone="good" href={href('tone', 'up')} />
        <Stat label={pick(lang, 'Claude: not useful', 'Claude: काम का नहीं')} value={fmtInt(claudeDown)} tone={claudeDown > 0 ? 'crit' : 'neutral'} href={href('tone', 'down')} />
      </Grid>

      <Callout tone="method" title={pick(lang, 'How the counts work', 'गिनती कैसे होती है')}>
        {pick(
          lang,
          'If someone rates the same Claude draft or answer twice, only their latest rating counts. Ease is 1 (very hard) to 5 (very easy). Pages are grouped by route, so every case page counts together. Comments are shown only here and in the CSV; they are never shown to other users.',
          'यदि कोई एक ही Claude मसौदे या उत्तर को दो बार रेट करे, तो केवल अंतिम रेटिंग गिनी जाती है। आसानी 1 (बहुत कठिन) से 5 (बहुत आसान) तक है। पृष्ठ मार्ग के अनुसार समूहित हैं, इसलिए सभी प्रकरण पृष्ठ एक साथ गिने जाते हैं। टिप्पणियाँ केवल यहाँ और CSV में दिखती हैं; अन्य उपयोगकर्ताओं को कभी नहीं।',
        )}
      </Callout>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title={pick(lang, 'By page', 'पृष्ठ के अनुसार')} hint={pick(lang, 'Forms with average ease, and thumbs on Claude, per page.', 'हर पृष्ठ पर फ़ॉर्म (औसत आसानी) और Claude पर पसंद-नापसंद।')} />
          {sum.byPage.length === 0 ? <Empty>{pick(lang, 'No feedback yet.', 'अभी कोई सुझाव नहीं।')}</Empty> : (
            <div className="overflow-x-auto">
              <table className="table min-w-[460px]">
                <thead>
                  <tr>
                    <th>{pick(lang, 'Page', 'पृष्ठ')}</th>
                    <th>{pick(lang, 'Forms', 'फ़ॉर्म')}</th>
                    <th>{pick(lang, 'Ease', 'आसानी')}</th>
                    <th>👍</th>
                    <th>👎</th>
                    <th aria-label={pick(lang, 'Share of all feedback', 'कुल सुझावों में हिस्सा')} />
                  </tr>
                </thead>
                <tbody>
                  {sum.byPage.slice(0, 15).map((p) => (
                    <tr key={p.route}>
                      <td className="font-mono text-xs"><Link href={href('page', p.route.replace(/\[id\].*$/, ''))} className="link">{p.route}</Link></td>
                      <td className="tnum">{fmtInt(p.forms)}</td>
                      <td className={`tnum ${p.formAvg !== null && p.formAvg < 3 ? 'text-crit' : ''}`}>{p.formAvg ?? '—'}</td>
                      <td className="tnum text-good">{fmtInt(p.up)}</td>
                      <td className={`tnum ${p.down > 0 ? 'text-crit' : ''}`}>{fmtInt(p.down)}</td>
                      <td><Bar value={p.forms + p.up + p.down} max={pageMax} width={80} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title={pick(lang, 'Claude, and why people said no', 'Claude, और नापसंद के कारण')} hint={pick(lang, 'Thumbs by kind, and the reasons ticked after a thumbs down.', 'प्रकार के अनुसार पसंद-नापसंद, और नापसंद के बाद चुने गए कारण।')} />
          <div className="card-pad space-y-4">
            <ul className="space-y-2">
              {sum.claude.map((c) => {
                const n = c.up + c.down;
                return (
                  <li key={c.kind} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 text-ink">{kindLabel(c.kind)}</span>
                    <span className="flex h-3 w-40 overflow-hidden rounded bg-paper-deep" role="img"
                      aria-label={`${c.up} ${pick(lang, 'useful', 'काम का')}, ${c.down} ${pick(lang, 'not useful', 'काम का नहीं')}`}>
                      {n > 0 ? <><span className="block h-full bg-good" style={{ width: `${(c.up / n) * 100}%` }} /><span className="block h-full bg-crit" style={{ width: `${(c.down / n) * 100}%` }} /></> : null}
                    </span>
                    <span className="tnum text-ink-soft">👍 {c.up} · 👎 {c.down}</span>
                  </li>
                );
              })}
            </ul>
            <div>
              <p className="label mb-2">{pick(lang, 'Top reasons', 'मुख्य कारण')}</p>
              {sum.tags.length === 0 ? <p className="text-sm text-ink-faint">{pick(lang, 'No reasons ticked yet.', 'अभी कोई कारण नहीं चुना गया।')}</p> : (
                <ul className="space-y-1.5">
                  {sum.tags.map((t) => (
                    <li key={t.tag} className="flex items-center gap-3 text-sm">
                      <Link href={href('tag', t.tag)} className="link w-40 shrink-0">{tagLabel(t.tag)}</Link>
                      <Bar value={t.c} max={tagMax} tone="crit" width={140} />
                      <span className="tnum text-ink-soft">{t.c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title={pick(lang, 'Every response', 'सभी उत्तर')}
          hint={`${fmtInt(rows.length)} ${pick(lang, 'shown, newest first', 'दिखाए, नए पहले')}`}
          right={Object.keys(active).length ? <Link href="/admin/feedback" className="btn-ghost btn-sm">{pick(lang, 'Clear filters', 'छँटाई हटाएँ')}</Link> : undefined}
        />
        <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 text-xs text-ink-faint">{pick(lang, 'Kind', 'प्रकार')}</span>
            {chip('kind', null, pick(lang, 'All', 'सभी'))}
            {FEEDBACK_KINDS.map((k) => chip('kind', k, kindLabel(k)))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 text-xs text-ink-faint">{pick(lang, 'Rating', 'रेटिंग')}</span>
            {chip('tone', null, pick(lang, 'All', 'सभी'))}
            {chip('tone', 'down', pick(lang, 'Negative (👎 or 1–2)', 'नकारात्मक (👎 या 1–2)'))}
            {chip('tone', 'mid', pick(lang, 'Neutral (3)', 'मध्यम (3)'))}
            {chip('tone', 'up', pick(lang, 'Positive (👍 or 4–5)', 'सकारात्मक (👍 या 4–5)'))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 text-xs text-ink-faint">{pick(lang, 'Reason', 'कारण')}</span>
            {chip('tag', null, pick(lang, 'All', 'सभी'))}
            {FEEDBACK_TAGS.map((t) => chip('tag', t, tagLabel(t)))}
          </div>
          {roles.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 text-xs text-ink-faint">{pick(lang, 'Role', 'भूमिका')}</span>
              {chip('role', null, pick(lang, 'All', 'सभी'))}
              {roles.map((r) => chip('role', r, roleLabel(r)))}
            </div>
          ) : null}
          {active.page ? <p className="text-xs text-ink-soft">{pick(lang, 'Page starts with', 'पृष्ठ आरंभ')}: <span className="font-mono">{active.page}</span></p> : null}
        </div>
        {rows.length === 0 ? (
          <Empty>
            {sum.total === 0
              ? pick(lang, 'No feedback yet. It appears here as soon as someone taps 👍 / 👎 under a Claude draft or sends the feedback form.', 'अभी कोई सुझाव नहीं। जैसे ही कोई Claude के मसौदे पर 👍 / 👎 दबाए या सुझाव फ़ॉर्म भेजे, यहाँ दिखेगा।')
              : pick(lang, 'Nothing matches these filters.', 'इन छँटाइयों से कुछ नहीं मिला।')}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const tags = (() => { try { return JSON.parse(r.tags) as string[]; } catch { return []; } })();
              const negative = r.kind === 'page' ? r.rating <= 2 : r.rating === -1;
              const positive = r.kind === 'page' ? r.rating >= 4 : r.rating === 1;
              return (
                <li key={r.id} className="px-4 py-3 sm:px-5" id={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={negative ? 'critical' : positive ? 'good' : 'neutral'}>
                      {r.kind === 'page' ? `${pick(lang, 'Ease', 'आसानी')} ${r.rating}/5` : r.rating === 1 ? '👍' : '👎'}
                    </Pill>
                    <Pill tone="pending">{kindLabel(r.kind)}</Pill>
                    {tags.map((t) => <Pill key={t} tone="warn">{tagLabel(t)}</Pill>)}
                    <span className="text-sm text-ink-soft">{roleLabel(r.role)} · {r.user_name}</span>
                    <span className="tnum ml-auto text-xs text-ink-faint">{fmtDate(r.created_at, true, lang)} · <span className="font-mono">{r.id}</span></span>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    <span className="font-mono">{r.page_path}</span>
                    {r.target && r.kind === 'claude_draft' ? <> · {pick(lang, 'draft', 'मसौदा')} <span className="font-mono">{r.target}</span></> : null}
                    {r.ai_interaction_id ? <> · {pick(lang, 'AI log', 'AI लॉग')} <span className="font-mono">{r.ai_interaction_id}</span></> : null}
                    {' · '}{r.language === 'hi' ? 'हिन्दी' : 'English'}
                  </p>
                  {r.trying ? <p className="mt-1 text-sm text-ink"><span className="text-ink-faint">{pick(lang, 'Trying to:', 'करना चाह रहे थे:')}</span> {r.trying}</p> : null}
                  {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm text-ink"><span className="text-ink-faint">{r.kind === 'page' ? pick(lang, 'Got in the way:', 'दिक्कत:') : pick(lang, 'Comment:', 'टिप्पणी:')}</span> {r.comment}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-sm text-ink-soft">
        {pick(lang, 'How to run test sessions and turn this into changes: docs/user-testing in the repository.', 'परीक्षण सत्र कैसे चलाएँ और इसे बदलावों में कैसे बदलें: रिपॉज़िटरी में docs/user-testing।')}
      </p>
    </div>
  );
}
