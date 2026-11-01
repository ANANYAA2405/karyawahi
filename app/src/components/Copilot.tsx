'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { SourceChip } from './AiBriefing';
import { askClaude } from './ask-claude';
import { MicButton, SpeakButton } from './voice';
import { appendDictation } from '@/lib/voice-text';
import { FeedbackThumbs } from './Feedback';

/**
 * A Claude draft on a record: a button, then the draft in place. Renders what /api/ai/copilot
 * returns — the last draft (shown at once, with no model call), a fresh one, or an honest error.
 * Every draft says it was written by Claude and has to be checked; nothing here changes a record.
 */

type Task = 'explain_finding' | 'suggest_plan' | 'summarise_discussion' | 'explain_outcome' | 'report_narrative';
interface Draft { headline: string; paragraphs: string[]; points: { text: string; source_ids: string[] }[]; next_step: string; intervention_id: string; caveat: string }
interface Envelope { status: 'ok' | 'unconfigured' | 'error'; draft?: Draft; model?: string; generatedAt?: string; stale?: boolean; message?: string; audit?: { checked: number; unsupported: string[] }; interactionId?: string }

/** Mark the figures the auditor could not find in the records, wherever they appear. */
function Marked({ text, bad }: { text: string; bad: string[] }) {
  if (bad.length === 0) return <>{text}</>;
  const re = new RegExp(`(${bad.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(re).map((part, i) => (bad.includes(part)
    ? <mark key={i} className="rounded bg-warn-light px-0.5 text-warn ring-1 ring-warn/40">{part}</mark>
    : <span key={i}>{part}</span>))}</>;
}

const T = {
  en: {
    working: 'Claude is reading the record…', by: 'Drafted by Claude', check: 'check before you rely on it', redo: 'Write again',
    stale: 'The record has changed since this draft.', follow: 'Ask a follow-up', copy: 'Copy', copied: 'Copied', next: 'Next step',
    off: 'Claude is not connected on this server.', composer: 'Open the plan composer with', retry: 'Try again', hide: 'Hide',
    unsupported: 'Not found in the records — check these figures before using the draft:', audited: 'figures checked against the records',
  },
  hi: {
    working: 'Claude रिकॉर्ड पढ़ रहा है…', by: 'Claude द्वारा तैयार', check: 'भरोसा करने से पहले जाँचें', redo: 'फिर से लिखें',
    stale: 'इस मसौदे के बाद रिकॉर्ड बदला है।', follow: 'आगे पूछें', copy: 'कॉपी', copied: 'कॉपी हुआ', next: 'अगला कदम',
    off: 'इस सर्वर पर Claude जुड़ा नहीं है।', composer: 'योजना संरचना खोलें:', retry: 'फिर कोशिश करें', hide: 'छिपाएँ',
    unsupported: 'ये आँकड़े रिकॉर्ड में नहीं मिले — मसौदा उपयोग करने से पहले जाँचें:', audited: 'आँकड़े रिकॉर्ड से मिलाए गए',
  },
};

export function ClaudeDraft({ task, id, label, lang = 'en', configured = true, followUp, className = '' }: {
  task: Task; id: string; label: string; lang?: 'en' | 'hi'; configured?: boolean;
  /** The question "Ask a follow-up" starts the drawer with. */
  followUp?: string;
  className?: string;
}) {
  const t = T[lang];
  const [env, setEnv] = useState<Envelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const qs = `task=${task}&id=${encodeURIComponent(id)}&lang=${lang}`;

  // The last draft, if there is one, without calling the model.
  useEffect(() => {
    if (!configured) return;
    let live = true;
    fetch(`/api/ai/copilot?${qs}`).then((r) => r.json()).then((e: Envelope) => {
      if (live && e.status === 'ok' && e.draft) { setEnv(e); setOpen(true); }
    }).catch(() => {});
    return () => { live = false; };
  }, [qs, configured]);

  const run = useCallback(async (refresh: boolean) => {
    setBusy(true); setOpen(true);
    try {
      const r = await fetch(`/api/ai/copilot?${qs}${refresh ? '&refresh=1' : ''}`, { method: 'POST' });
      setEnv(await r.json() as Envelope);
    } catch {
      setEnv({ status: 'error', message: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }, [qs]);

  const d = env?.status === 'ok' ? env.draft : undefined;
  const bad = env?.audit?.unsupported ?? [];
  const asText = d ? [d.headline, ...d.paragraphs, ...d.points.map((p) => `• ${p.text}`), `${t.next}: ${d.next_step}`].join('\n\n') : '';

  return (
    <div className={className}>
      {!open || (!d && !busy && env?.status !== 'error' && env?.status !== 'unconfigured') ? (
        <button type="button" onClick={() => run(false)} disabled={!configured || busy} title={configured ? undefined : t.off}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-white px-3 py-1.5 text-sm font-medium text-brand shadow-card transition-colors hover:bg-brand-light disabled:opacity-50 no-print">
          <Icon name="sparkles" size={15} />{label}
        </button>
      ) : (
        <section className="rounded-2xl border border-brand/25 bg-gradient-to-b from-brand-light/60 to-white p-4 shadow-card" aria-live="polite">
          <header className="flex flex-wrap items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Icon name="sparkles" size={15} /></span>
            <span className="text-sm font-semibold text-ink">{label}</span>
            <span className="text-xs text-ink-faint">· {t.by}, {t.check}</span>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto text-xs text-ink-faint hover:text-ink no-print">{t.hide}</button>
          </header>

          {busy ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-ink-soft">{t.working}</p>
              <div className="skeleton h-4 w-4/5" /><div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-11/12" /><div className="skeleton h-3 w-2/3" />
            </div>
          ) : d ? (
            <div className="mt-3 space-y-3">
              {env?.stale ? <p className="rounded-lg bg-warn-light px-3 py-1.5 text-xs text-warn">{t.stale}</p> : null}
              {bad.length > 0 ? (
                <p role="alert" className="rounded-lg border border-warn/30 bg-warn-light px-3 py-1.5 text-xs text-warn">
                  <Icon name="alert" size={13} className="mr-1 inline" />{t.unsupported} <strong>{bad.join(', ')}</strong>
                </p>
              ) : null}
              <p className="text-md font-semibold leading-snug text-ink"><Marked text={d.headline} bad={bad} /></p>
              {d.paragraphs.map((p, i) => <p key={i} className="text-base leading-relaxed text-ink-soft"><Marked text={p} bad={bad} /></p>)}
              {d.points.length > 0 ? (
                <ul className="space-y-1.5">
                  {d.points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-base leading-snug text-ink">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      <span><Marked text={p.text} bad={bad} /> {p.source_ids.map((s) => <SourceChip key={s} id={s} />)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="rounded-xl bg-white px-3 py-2 text-base text-ink ring-1 ring-line"><span className="font-semibold">{t.next}: </span><Marked text={d.next_step} bad={bad} /></p>
              {task === 'suggest_plan' && d.intervention_id ? (
                <Link href={`/cases/${id}/plan?iv=${d.intervention_id}`} className="btn-primary btn-sm">{t.composer} {d.intervention_id}<Icon name="arrow-right" size={14} /></Link>
              ) : null}
              <p className="text-xs text-ink-faint">{d.caveat}</p>
              <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-2 no-print">
                {followUp ? <button type="button" onClick={() => askClaude(followUp)} className="btn-ghost btn-sm text-brand"><Icon name="send" size={14} />{t.follow}</button> : null}
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(asText); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="btn-ghost btn-sm"><Icon name="copy" size={14} />{copied ? t.copied : t.copy}</button>
                <button type="button" onClick={() => run(true)} className="btn-ghost btn-sm"><Icon name="refresh" size={14} />{t.redo}</button>
                <SpeakButton text={asText} lang={lang} size="sm" />
                {env?.audit && env.audit.checked > 0 && bad.length === 0 ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-2xs text-good"><Icon name="check-circle" size={12} />{env.audit.checked} {t.audited}</span>
                ) : null}
                {env?.model ? <span className={`${env?.audit && env.audit.checked > 0 && bad.length === 0 ? '' : 'ml-auto '}font-mono text-2xs text-ink-faint`}>{env.model}</span> : null}
              </footer>
              <FeedbackThumbs kind="claude_draft" target={`${task}:${id}`} aiInteractionId={env?.interactionId} lang={lang} />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-sm text-crit">{env?.message ?? t.off}</p>
              {env?.status === 'error' ? <button type="button" onClick={() => run(false)} className="btn-quiet btn-sm">{t.retry}</button> : null}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Questions that open the Claude drawer already asked. */
export function AskClaudeButtons({ questions, disabled = false }: { questions: string[]; disabled?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {questions.map((q) => (
        <li key={q}>
          <button type="button" onClick={() => askClaude(q)} disabled={disabled}
            className="flex w-full items-start gap-2 rounded-lg border border-line bg-white px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:border-brand/40 hover:text-ink disabled:opacity-50">
            <Icon name="sparkles" size={14} className="mt-0.5 shrink-0 text-brand" />{q}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Ask Claude about …" as a line you type into, with a few suggested questions under it. */
export function AskClaudeInline({ placeholder, questions = [], disabled = false, button }: {
  placeholder: string; questions?: string[]; disabled?: boolean; button: string;
}) {
  const [q, setQ] = useState('');
  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { askClaude(q.trim()); setQ(''); } }}
        className="flex items-center gap-2 rounded-full border border-brand/30 bg-white py-1 pl-3 pr-1 shadow-card focus-within:ring-2 focus-within:ring-brand/30">
        <Icon name="sparkles" size={16} className="shrink-0 text-brand" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} disabled={disabled}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint disabled:opacity-50" />
        <MicButton size="sm" onText={(x) => setQ((v) => appendDictation(v, x))} disabled={disabled} />
        <button type="submit" disabled={disabled || !q.trim()} className="btn-primary btn-sm rounded-full">{button}</button>
      </form>
      {questions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {questions.map((x) => (
            <button key={x} type="button" onClick={() => askClaude(x)} disabled={disabled}
              className="rounded-full border border-line bg-white/90 px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50">{x}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
