import type { Session } from '@/lib/session';
import { caseThread, mentionCandidates, watchState, canRecordDecision } from '@/lib/threads';
import { followCaseAction } from '@/lib/actions-threads';
import { pick } from '@/lib/i18n';
import { Card, CardHead, Empty, fmtDate } from '@/components/ui';
import { Pill, RoleName } from '@/components/labels';
import { ActionForm } from '@/components/ActionForm';
import { CaseThreadComposer } from '@/components/CaseThreadComposer';
import type { Language } from '@domain/types';

/**
 * The discussion on a case: comments, @mentions, decisions and who follows it.
 *
 * Mounted on /cases/[id] with one line. Everything it shows comes from scoped reads
 * (lib/threads.ts), so a viewer who cannot open the case sees nothing here either.
 */
export function CaseThread({ session, caseId, lang }: { session: Session; caseId: string; lang: Language }) {
  const comments = caseThread(session, caseId);
  const candidates = mentionCandidates(session, caseId);
  const watch = watchState(session, caseId);
  const canDecide = canRecordDecision(session);

  const followHint = watch.why === 'owner'
    ? pick(lang, 'You own this case, so you hear about new comments.', 'आप इस प्रकरण के स्वामी हैं, इसलिए नई टिप्पणियों की सूचना आपको मिलती है।')
    : watch.following
      ? pick(lang, 'You are following this case.', 'आप इस प्रकरण का अनुसरण कर रहे हैं।')
      : pick(lang, 'Follow to hear about new comments.', 'नई टिप्पणियों की सूचना के लिए अनुसरण करें।');

  return (
    <Card>
      <CardHead
        title={pick(lang, 'Discussion', 'चर्चा')}
        hint={`${comments.length} ${pick(lang, comments.length === 1 ? 'comment' : 'comments', 'टिप्पणियाँ')} · ${watch.followers} ${pick(lang, watch.followers === 1 ? 'person following' : 'people following', 'अनुसरणकर्ता')}. ${followHint}`}
        right={
          <ActionForm
            action={followCaseAction}
            hidden={{ case_id: caseId, follow: watch.following ? '0' : '1' }}
            tone="quiet"
            label={watch.following ? pick(lang, 'Unfollow', 'अनुसरण बंद करें') : pick(lang, 'Follow', 'अनुसरण करें')}
          />
        }
      />
      {comments.length === 0 ? (
        <Empty>{pick(lang, 'No comments yet. Start the discussion below.', 'अभी कोई टिप्पणी नहीं।')}</Empty>
      ) : (
        <ol className="divide-y divide-line">
          {comments.map((c) => (
            <li key={c.id} id={`comment-${c.id}`} className={`scroll-mt-36 px-4 py-3 sm:px-5 ${c.is_decision ? 'bg-brand-light/40' : ''}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-semibold text-ink">{c.author_name}</span>
                <span className="text-[12px] text-ink-faint"><RoleName role={c.author_role} lang={lang} /></span>
                <span className="tnum text-[12px] text-ink-faint">{fmtDate(c.created_at, true)}</span>
                {c.edited_at ? <span className="text-[11.5px] text-ink-faint">({pick(lang, 'edited', 'संपादित')} {fmtDate(c.edited_at, true)})</span> : null}
                {c.is_decision ? <Pill tone="active">{pick(lang, 'Decision', 'निर्णय')}</Pill> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{c.body}</p>
              {c.mentions.length > 0 ? (
                <p className="mt-1 text-[12px] text-ink-soft">
                  {pick(lang, 'Mentioned', 'उल्लेख')}: {c.mentions.map((m) => `@${m.name}`).join(', ')}
                </p>
              ) : null}
              {c.mine && !c.is_decision ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12.5px] text-brand">{pick(lang, 'Edit', 'बदलें')}</summary>
                  <div className="mt-2 rounded-md border border-line bg-paper-sunk p-3">
                    <CaseThreadComposer
                      lang={lang} caseId={caseId} candidates={candidates} mode="edit"
                      commentId={c.id} version={c.version} initialBody={c.body} initialMentions={c.mentions.map((m) => m.user_id)}
                    />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <div className="card-pad border-t border-line">
        <CaseThreadComposer lang={lang} caseId={caseId} candidates={candidates} canDecide={canDecide} />
      </div>
    </Card>
  );
}
