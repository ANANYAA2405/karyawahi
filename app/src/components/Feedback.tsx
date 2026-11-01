'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FEEDBACK_TAGS, TAG_LABEL, COMMENT_MAX, TRYING_MAX, type FeedbackKind, type FeedbackTag } from '@/lib/feedback-shared';

/**
 * Feedback from the people using the app, in two forms:
 *
 *   FeedbackThumbs  👍 / 👎 under a Claude draft or chat answer; a thumbs down asks for a few
 *                   quick reasons and an optional comment
 *   FeedbackButton  "Feedback / सुझाव दें" in the top bar of every signed-in page, opening a
 *                   three-question form: how easy was this, what were you trying to do, what got
 *                   in the way
 *
 * Both post to /api/feedback, which takes the user from the session. Field staff read Hindi
 * first, so every word here is in both languages, and the buttons are large enough for a thumb.
 */

type Lang = 'en' | 'hi';
const pick = (lang: Lang, en: string, hi: string) => (lang === 'hi' ? hi : en);

/** The page's language, from <html lang>, for components that are not handed one. */
function usePageLang(given?: Lang): Lang {
  const [lang, setLang] = useState<Lang>(given ?? 'en');
  useEffect(() => {
    if (given) { setLang(given); return; }
    setLang(document.documentElement.lang === 'hi' ? 'hi' : 'en');
  }, [given]);
  return lang;
}

async function post(body: Record<string, unknown>, lang: Lang): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: pick(lang, 'No signal. Nothing was sent — try again when you are back online.', 'नेटवर्क नहीं है। कुछ नहीं भेजा गया — नेटवर्क आने पर फिर भेजें।') };
  }
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, language: lang }) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({})) as { error?: string; code?: string };
    if (r.status === 429) return { ok: false, error: pick(lang, 'That is a lot of feedback at once. Please wait a few minutes and send the rest.', 'एक साथ बहुत सुझाव आ गए। कुछ मिनट रुककर बाकी भेजें।') };
    return { ok: false, error: j.error ?? pick(lang, 'Could not send. Try again.', 'भेजा नहीं जा सका। फिर कोशिश करें।') };
  } catch {
    return { ok: false, error: pick(lang, 'Could not reach the server. Try again.', 'सर्वर से संपर्क नहीं हुआ। फिर कोशिश करें।') };
  }
}

// ---------------------------------------------------------------- thumbs on Claude

export function FeedbackThumbs({ kind, target, aiInteractionId, lang: given, className = '' }: {
  kind: Exclude<FeedbackKind, 'page'>;
  /** claude_answer: the AI log id; claude_draft: "task:RECORD-ID". */
  target: string;
  aiInteractionId?: string;
  lang?: Lang;
  className?: string;
}) {
  const lang = usePageLang(given);
  const path = usePathname();
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const [asking, setAsking] = useState(false);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (rating: 1 | -1) => {
    setBusy(true); setError(null);
    const r = await post({ kind, target, aiInteractionId, rating, pagePath: path, tags: rating === -1 ? tags : [], comment: rating === -1 ? comment : '' }, lang);
    setBusy(false);
    if (r.ok) { setSent(rating); setAsking(false); } else setError(r.error);
  };

  const thumb = (rating: 1 | -1) => {
    const on = sent === rating || (rating === -1 && asking);
    return (
      <button
        type="button" disabled={busy}
        onClick={() => (rating === 1 ? void send(1) : (setAsking((a) => !a), setError(null)))}
        aria-pressed={on}
        aria-label={rating === 1 ? pick(lang, 'Useful', 'काम का है') : pick(lang, 'Not useful', 'काम का नहीं')}
        title={rating === 1 ? pick(lang, 'Useful', 'काम का है') : pick(lang, 'Not useful', 'काम का नहीं')}
        className={`grid h-10 w-10 place-items-center rounded-full border text-lg leading-none transition-colors disabled:opacity-50 ${on ? (rating === 1 ? 'border-good/40 bg-good-light' : 'border-crit/40 bg-crit-light') : 'border-line bg-white hover:bg-paper-sunk'}`}
      >
        <span aria-hidden>{rating === 1 ? '👍' : '👎'}</span>
      </button>
    );
  };

  return (
    <div className={`no-print ${className}`} data-feedback={kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">
          {sent ? pick(lang, 'Thank you — noted.', 'धन्यवाद — दर्ज हो गया।') : pick(lang, 'Was this useful?', 'क्या यह काम का था?')}
        </span>
        {thumb(1)}
        {thumb(-1)}
      </div>
      {asking ? (
        <div className="mt-2 space-y-2 rounded-xl border border-line bg-white p-3">
          <p className="text-sm font-medium text-ink">{pick(lang, 'What was wrong? Tap any that apply.', 'क्या कमी थी? जो लागू हो, चुनें।')}</p>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on}
                  onClick={() => setTags((xs) => (on ? xs.filter((x) => x !== t) : [...xs, t]))}
                  className={`min-h-10 rounded-full border px-3.5 text-sm transition-colors ${on ? 'border-brand bg-brand-light font-medium text-brand' : 'border-line bg-white text-ink-soft hover:border-brand/40'}`}>
                  {pick(lang, TAG_LABEL[t].en, TAG_LABEL[t].hi)}
                </button>
              );
            })}
          </div>
          <label className="block text-sm text-ink-soft">
            {pick(lang, 'Anything else? (optional)', 'और कुछ? (वैकल्पिक)')}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={COMMENT_MAX} rows={2}
              placeholder={pick(lang, 'Please do not write names or phone numbers.', 'कृपया नाम या फ़ोन नंबर न लिखें।')}
              className="input mt-1 w-full text-base" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void send(-1)} disabled={busy} className="btn-primary min-h-10">
              {busy ? pick(lang, 'Sending…', 'भेज रहे हैं…') : pick(lang, 'Send', 'भेजें')}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="btn-ghost min-h-10">{pick(lang, 'Cancel', 'रद्द करें')}</button>
            <span className="tnum ml-auto text-2xs text-ink-faint">{comment.length}/{COMMENT_MAX}</span>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1.5 text-xs text-crit">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the feedback form

function BubbleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </svg>
  );
}

const EASE: { n: number; en: string; hi: string }[] = [
  { n: 1, en: 'Very hard', hi: 'बहुत कठिन' },
  { n: 2, en: 'Hard', hi: 'कठिन' },
  { n: 3, en: 'OK', hi: 'ठीक' },
  { n: 4, en: 'Easy', hi: 'आसान' },
  { n: 5, en: 'Very easy', hi: 'बहुत आसान' },
];

export function FeedbackButton({ lang }: { lang: Lang }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [trying, setTrying] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => { setRating(null); setTrying(''); setComment(''); setError(null); setDone(false); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) { setError(pick(lang, 'Please choose how easy it was (1 to 5).', 'कृपया चुनें कि कितना आसान था (1 से 5)।')); return; }
    setBusy(true); setError(null);
    const r = await post({ kind: 'page', rating, pagePath: path, trying, comment }, lang);
    setBusy(false);
    if (r.ok) setDone(true); else setError(r.error);
  };

  const label = pick(lang, 'Feedback', 'सुझाव दें');
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Dialog.Trigger asChild>
        <button type="button" className="btn-ghost gap-1.5 px-2 no-print" title={pick(lang, 'Feedback — tell us what to improve', 'सुझाव दें — बताइए क्या सुधारें')} aria-label={label} data-feedback-open="">
          <BubbleIcon size={19} />
          <span className="hidden text-sm font-medium lg:inline">{label}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40 data-[state=open]:animate-fade-in no-print" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl bg-ivory shadow-pop outline-none no-print sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4 sm:rounded-t-2xl">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">{pick(lang, 'Tell us how it went', 'बताइए, कैसा रहा')}</Dialog.Title>
              <p className="mt-0.5 text-sm text-ink-soft">
                {pick(lang, 'Three short questions. Only the state programme team reads the answers, and they are used to improve the app.', 'तीन छोटे प्रश्न। उत्तर केवल राज्य कार्यक्रम दल पढ़ता है, और इनसे ऐप को बेहतर बनाया जाता है।')}
              </p>
            </div>
            <Dialog.Close className="btn-ghost h-11 w-11 shrink-0 justify-center p-0 text-xl" aria-label={pick(lang, 'Close', 'बंद करें')}>×</Dialog.Close>
          </header>

          {done ? (
            <div className="space-y-4 px-5 py-6 text-center">
              <p className="text-3xl" aria-hidden>🙏</p>
              <p className="text-lg font-semibold text-ink">{pick(lang, 'Thank you. Your feedback was saved.', 'धन्यवाद। आपका सुझाव दर्ज हो गया।')}</p>
              <p className="text-sm text-ink-soft">
                {pick(lang, 'Changes made because of feedback are listed on one page.', 'सुझावों के कारण किए गए बदलाव एक पृष्ठ पर लिखे जाते हैं।')}{' '}
                <Link href="/changes" className="link" onClick={() => setOpen(false)}>{pick(lang, 'What we changed after testing', 'परीक्षण के बाद हमने क्या बदला')}</Link>
              </p>
              <Dialog.Close className="btn-primary min-h-12 w-full justify-center text-base">{pick(lang, 'Close', 'बंद करें')}</Dialog.Close>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5 px-5 py-5">
              <fieldset>
                <legend className="text-base font-semibold text-ink">1. {pick(lang, 'How easy was this page to use?', 'यह पृष्ठ उपयोग करना कितना आसान था?')}</legend>
                <div className="mt-2 grid grid-cols-5 gap-2" role="radiogroup" aria-label={pick(lang, 'How easy, 1 to 5', 'कितना आसान, 1 से 5')}>
                  {EASE.map((e) => (
                    <button key={e.n} type="button" role="radio" aria-checked={rating === e.n} onClick={() => setRating(e.n)}
                      className={`flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 transition-colors ${rating === e.n ? 'border-brand bg-brand-light text-brand ring-2 ring-brand/30' : 'border-line bg-white text-ink hover:border-brand/40'}`}>
                      <span className="tnum text-xl font-semibold">{e.n}</span>
                      <span className="text-center text-2xs leading-tight text-ink-soft">{pick(lang, e.en, e.hi)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="text-base font-semibold text-ink">2. {pick(lang, 'What were you trying to do?', 'आप क्या करने की कोशिश कर रहे थे?')}</span>
                <textarea value={trying} onChange={(e) => setTrying(e.target.value)} maxLength={TRYING_MAX} rows={2}
                  placeholder={pick(lang, 'For example: hand in proof for today’s task', 'जैसे: आज के कार्य का प्रमाण जमा करना')}
                  className="input mt-1.5 w-full text-base" />
              </label>
              <label className="block">
                <span className="text-base font-semibold text-ink">3. {pick(lang, 'What got in the way?', 'किस बात से दिक्कत हुई?')}</span>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={COMMENT_MAX} rows={3}
                  placeholder={pick(lang, 'Anything confusing, slow or missing. Please do not write names or phone numbers.', 'जो उलझन भरा, धीमा या अधूरा लगा। कृपया नाम या फ़ोन नंबर न लिखें।')}
                  className="input mt-1.5 w-full text-base" />
                <span className="tnum mt-1 block text-right text-2xs text-ink-faint">{comment.length}/{COMMENT_MAX}</span>
              </label>
              {error ? <p role="alert" className="rounded-lg border border-crit/30 bg-crit-light px-3 py-2 text-sm text-crit">{error}</p> : null}
              <button type="submit" disabled={busy} className="btn-primary min-h-12 w-full justify-center text-base">
                {busy ? pick(lang, 'Sending…', 'भेज रहे हैं…') : pick(lang, 'Send feedback', 'सुझाव भेजें')}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
