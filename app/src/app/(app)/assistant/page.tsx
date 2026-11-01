import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { QUESTIONS, answer } from '@/lib/assistant';
import { may } from '@/lib/guard';
import { aiStatus } from '@/lib/ai/config';
import { pick } from '@/lib/i18n';
import { scopeName } from '@/lib/repo';
import { PageHead, Callout, Mono } from '@/components/ui';
import { ChatPanel } from '@/components/Chat';
import { Icon } from '@/components/Icon';

/**
 * Karyavahi AI. The conversation on the left is a live model working through controlled,
 * scope-checked tools. The panel on the right keeps the original "instant answers": a fixed
 * set of questions computed straight from the database with no model at all — they still work
 * when the AI is not configured, and they are a useful cross-check when it is.
 */

const STARTERS = [
  'What should I prioritise this week?',
  'Why is Class 3 numeracy declining, and where?',
  'Which cases are waiting on my approval, and what do I need to decide?',
  'Why are tasks overdue in my area, and what is blocking them?',
  'Compare the options for CASE-0184',
  'Prepare an agenda for tomorrow’s review meeting',
];

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'ai.assistant')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title="Claude" />
        <Callout tone="warn">{pick(lang, 'Not available to your role.', 'आपकी भूमिका के लिए उपलब्ध नहीं।')}</Callout>
      </div>
    );
  }

  const st = aiStatus();
  const a = sp.q ? answer(session, sp.q, lang) : null;

  return (
    <div>
      <PageHead
        title={pick(lang, 'Ask Claude', 'Claude से पूछें')}
        sub={pick(lang, 'Ask in your own words. Answers come only from records in your scope, cite the ids they used, and say what is uncertain or missing.', 'अपने शब्दों में पूछें। उत्तर केवल आपके दायरे के रिकॉर्ड से आते हैं और स्रोत बताते हैं।')}
        right={
          <span className={`chip ${st.configured ? 'border-good/30 bg-good-light text-good' : 'border-warn/30 bg-warn-light text-warn'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${st.configured ? 'bg-good' : 'bg-warn'}`} />
            {st.configured ? `Connected · ${st.model}` : 'Not connected'}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card p-4 sm:p-5">
          <ChatPanel withHistory starters={STARTERS} configured={st.configured} context={{ path: '/assistant' }} userKey={session.user_id} scopeLabel={scopeName(session.scope_type, session.scope_id)} />
        </div>

        <aside className="space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-line bg-paper-sunk px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Icon name="database" size={15} />{pick(lang, 'Instant answers', 'तुरंत उत्तर')}</p>
              <p className="mt-0.5 text-xs leading-snug text-ink-faint">{pick(lang, 'Computed directly from the database. No AI involved.', 'सीधे डेटाबेस से गणना। AI नहीं।')}</p>
            </div>
            <ul className="divide-y divide-line">
              {QUESTIONS.map((q) => (
                <li key={q.id}>
                  <Link href={`/assistant?q=${q.id}`} className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm ${sp.q === q.id ? 'bg-brand-light font-medium text-brand' : 'text-ink-soft hover:bg-paper-sunk hover:text-ink'}`}>
                    {pick(lang, q.label.en, q.label.hi)}<Icon name="chevron-right" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {a ? (
            <div className="card p-4">
              <p className="text-sm font-semibold text-ink">{a.question}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{a.summary}</p>
              {a.rows.length > 0 ? (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                  {a.rows.slice(0, 12).map((r, i) => (
                    <li key={`${r.label}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{r.href ? <Link href={r.href} className="link">{r.label}</Link> : r.label}</span>
                      <span className="tnum shrink-0 font-medium text-ink-soft">{r.value}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {a.caveat ? <p className="mt-3 text-xs leading-snug text-warn">{a.caveat}</p> : null}
              {a.citations.length > 0 ? <p className="mt-3 text-xs leading-relaxed text-ink-faint">{a.citations.slice(0, 16).map((c) => <Mono key={c}>{c} </Mono>)}</p> : null}
            </div>
          ) : null}

          <Callout tone="method" title={pick(lang, 'How Claude is kept honest', 'Claude को ईमानदार कैसे रखा जाता है')}>
            {pick(lang,
              'The model reads only through server-side tools that apply your scope. It has no tool that writes, approves or closes. Ids it cites but did not retrieve are flagged. Every interaction is logged in the AI activity log.',
              'मॉडल केवल सर्वर उपकरणों से आपके दायरे में पढ़ता है। कोई लिखने/स्वीकृत करने वाला उपकरण नहीं। हर बातचीत AI लॉग में दर्ज होती है।')}
          </Callout>
        </aside>
      </div>
    </div>
  );
}
