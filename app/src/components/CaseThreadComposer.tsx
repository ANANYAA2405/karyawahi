'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { postCommentAction, editCommentAction } from '@/lib/actions-threads';
import type { MentionCandidate } from '@/lib/threads';
import type { Language } from '@domain/types';

/**
 * Writing or editing a comment on a case, with an @mention picker.
 *
 * Type "@" and a few letters to see matching people, or use the "Mention someone" list. The
 * picker only offers people who can open this case (the server works that list out); the
 * server checks again on post and refuses the comment if anyone mentioned cannot see the case.
 */

const t = (lang: Language, en: string, hi: string) => (lang === 'hi' ? hi : en);
type State = { error?: string; ok?: string; at?: number };

const ROLE_SHORT: Record<string, string> = {
  beo: 'BEO', brc: 'BRC', crc: 'CRC', headmaster: 'Headmaster', deo: 'DEO',
  state_admin: 'State team', auditor: 'Auditor', demo_admin: 'Demo admin',
};

export function CaseThreadComposer({
  lang, caseId, candidates, canDecide = false, mode = 'new', commentId, version, initialBody = '', initialMentions = [],
}: {
  lang: Language;
  caseId: string;
  candidates: MentionCandidate[];
  canDecide?: boolean;
  mode?: 'new' | 'edit';
  commentId?: string;
  version?: number;
  initialBody?: string;
  initialMentions?: string[];
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(mode === 'new' ? postCommentAction : editCommentAction, {});
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<string[]>(initialMentions);
  const [query, setQuery] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // A successful new comment clears the box; an edit keeps what was saved.
  useEffect(() => {
    if (state.ok && mode === 'new') { setBody(''); setMentions([]); setQuery(null); }
  }, [state.at, state.ok, mode]);

  function onType(value: string, caret: number) {
    setBody(value);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
  }

  function choose(c: MentionCandidate) {
    const el = area.current;
    const caret = el ? el.selectionStart : body.length;
    const before = body.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    const start = m ? caret - m[2].length - 1 : caret;
    const insert = `@${c.name} `;
    const next = body.slice(0, start) + insert + body.slice(caret);
    setBody(next);
    setMentions((xs) => (xs.includes(c.id) ? xs : [...xs, c.id]));
    setQuery(null);
    requestAnimationFrame(() => { el?.focus(); const at = start + insert.length; el?.setSelectionRange(at, at); });
  }

  const matches = query === null ? [] : candidates
    .filter((c) => !mentions.includes(c.id) && c.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const label = mode === 'new' ? t(lang, 'Add to the discussion', 'चर्चा में जोड़ें') : t(lang, 'Edit your comment', 'अपनी टिप्पणी बदलें');

  return (
    <form action={formAction} className="space-y-2" data-testid={mode === 'new' ? 'thread-composer' : `thread-edit-${commentId}`}>
      <input type="hidden" name="case_id" value={caseId} />
      <input type="hidden" name="mentions" value={mentions.join(',')} />
      {mode === 'edit' ? <><input type="hidden" name="comment_id" value={commentId} /><input type="hidden" name="version" value={String(version)} /></> : null}

      <label className="block">
        <span className="label">{label}</span>
        <div className="relative mt-1">
          <textarea
            ref={area} name="body" rows={mode === 'new' ? 3 : 4} className="input resize-y" value={body} required maxLength={4000}
            placeholder={t(lang, 'Write an update or a question. Type @ to mention someone.', 'अपडेट या प्रश्न लिखें। किसी का उल्लेख करने के लिए @ लिखें।')}
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(null); }}
          />
          {matches.length > 0 ? (
            <ul role="listbox" aria-label={t(lang, 'People who can see this case', 'जो यह प्रकरण देख सकते हैं')}
              className="absolute left-2 z-20 mt-1 w-72 overflow-hidden rounded-md border border-line-strong bg-white shadow-lg">
              {matches.map((c) => (
                <li key={c.id} role="option" aria-selected="false">
                  <button type="button" className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-paper-sunk"
                    onClick={() => choose(c)}>
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="text-[11.5px] text-ink-faint">{ROLE_SHORT[c.role] ?? c.role} · {c.scope}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
          <span>{t(lang, 'Mention someone', 'उल्लेख करें')}</span>
          <select className="input w-auto py-1 text-[12.5px]" value="" aria-label={t(lang, 'Mention someone', 'उल्लेख करें')}
            onChange={(e) => { const c = byId.get(e.target.value); if (c) choose(c); }}>
            <option value="">{t(lang, `choose (${candidates.length} can see this case)`, `चुनें (${candidates.length})`)}</option>
            {candidates.filter((c) => !mentions.includes(c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {ROLE_SHORT[c.role] ?? c.role}</option>
            ))}
          </select>
        </label>
        {mentions.map((id) => (
          <span key={id} className="chip border-brand/30 bg-brand-light text-brand">
            @{byId.get(id)?.name ?? id}
            <button type="button" className="ml-1 text-ink-faint hover:text-crit" aria-label={t(lang, 'Remove mention', 'उल्लेख हटाएँ')}
              onClick={() => setMentions((xs) => xs.filter((x) => x !== id))}>×</button>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending || !body.trim()}>
          {pending ? t(lang, 'Saving…', 'सहेजा जा रहा है…') : mode === 'new' ? t(lang, 'Post comment', 'टिप्पणी भेजें') : t(lang, 'Save changes', 'बदलाव सहेजें')}
        </button>
        {mode === 'new' && canDecide ? (
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <input type="checkbox" name="decision" />
            {t(lang, 'Record this as a decision (added to the case history; cannot be edited later)', 'इसे निर्णय के रूप में दर्ज करें (प्रकरण इतिहास में जुड़ेगा)')}
          </label>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-[13px] leading-relaxed text-crit">
          <span className="font-semibold">{t(lang, 'Refused. ', 'अस्वीकृत। ')}</span>{state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-md border border-good/30 bg-good-light px-3 py-2 text-[13px] leading-relaxed text-good">{state.ok}</p>
      ) : null}
    </form>
  );
}
