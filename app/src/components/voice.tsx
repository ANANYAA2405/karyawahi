'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { pick } from '@/lib/i18n';
import {
  appendDictation, chunkSpeech, dictationError, dictationErrorText, pickVoice, speechLocale, voiceLangFor,
  type DictationError, type VoiceLang,
} from '@/lib/voice-text';

/**
 * Voice in the browser, for field staff who would rather speak than type: dictation into a text
 * field (the Web Speech API's SpeechRecognition) and reading text aloud (speechSynthesis).
 *
 * Nothing here is required. Every control checks for the browser API after the page has loaded
 * and renders nothing when it is missing (Firefox, some in-app browsers), so the page is the same
 * as before. Nothing renders on the server either, so there is no hydration difference.
 *
 * Privacy: in Chrome the microphone audio goes to the browser vendor's speech service to be
 * turned into text. Karyavahi never receives audio — only the text, and only when the person
 * hands the form in. The mic says so where it first appears (NoteMic) and in its tooltip.
 *
 * The words read aloud, and the rules for choosing a voice, are in src/lib/voice-text.ts.
 */

// ---------------------------------------------------------------- browser feature detection
// SpeechRecognition is not in TypeScript's DOM library (and Chrome only has the webkit name),
// so these are the few members used here.
interface RecAlternative { transcript: string }
interface RecResult { readonly isFinal: boolean; readonly length: number; readonly [i: number]: RecAlternative }
interface RecEvent { readonly resultIndex: number; readonly results: { readonly length: number; readonly [i: number]: RecResult } }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof C === 'function' ? C : null;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
  return w.speechSynthesis && typeof w.speechSynthesis.speak === 'function' && typeof w.SpeechSynthesisUtterance === 'function'
    ? w.speechSynthesis : null;
}

/** The page language, from <html lang>, for components that are not handed one. */
export function usePageLang(): VoiceLang {
  const [lang, setLang] = useState<VoiceLang>('en');
  useEffect(() => { setLang(document.documentElement.lang === 'hi' ? 'hi' : 'en'); }, []);
  return lang;
}

const T = {
  listen: { en: 'Listen', hi: 'सुनें' },
  stop: { en: 'Stop', hi: 'रोकें' },
  speak: { en: 'Speak', hi: 'बोलें' },
  speakNote: { en: 'Speak the note', hi: 'बोलकर लिखें' },
  speakAria: { en: 'Speak instead of typing', hi: 'टाइप करने के बजाय बोलें' },
  stopListening: { en: 'Stop listening', hi: 'सुनना बंद करें' },
  listening: { en: 'Listening… speak now', hi: 'सुन रहा है… अब बोलें' },
  privacy: {
    en: 'Your speech is turned into text by the browser’s own speech service (in Chrome, Google’s). Karyavahi gets only the text, when you hand it in.',
    hi: 'आपकी बोली को ब्राउज़र की अपनी वाक्-सेवा (Chrome में Google की) लिखे शब्दों में बदलती है। Karyavahi को केवल लिखा हुआ मिलता है, जमा करने पर।',
  },
  noHindiVoice: { en: 'This phone has no Hindi voice, so another voice is reading.', hi: 'इस फ़ोन में हिन्दी आवाज़ नहीं है, इसलिए दूसरी आवाज़ पढ़ रही है।' },
} as const;
const say = (lang: VoiceLang, k: keyof typeof T) => pick(lang, T[k].en, T[k].hi);

// ---------------------------------------------------------------- icons (inline, decorative)
const PATH = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3m-4 0h8',
  speaker: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Zm11.5-1a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12',
  stop: 'M7 7h10v10H7z',
};
function VIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0"><path d={d} /></svg>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine !== false);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);
  return online;
}

// ---------------------------------------------------------------- dictation
export interface Dictation {
  /** null until checked in the browser; false when this browser cannot take dictation. */
  supported: boolean | null;
  listening: boolean;
  /** Words heard so far that the browser may still change. */
  interim: string;
  error: DictationError | null;
  start(): void;
  stop(): void;
  toggle(): void;
  clearError(): void;
}

/**
 * Speech to text in Hindi (hi-IN) or Indian English (en-IN). Each finished phrase goes to
 * `onFinal`; interim words are exposed for a live preview. One phrase per tap (continuous mode
 * repeats words on Android Chrome), and the microphone is released when the component goes.
 */
export function useDictation(lang: VoiceLang, onFinal: (text: string) => void): Dictation {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  useEffect(() => { finalRef.current = onFinal; }, [onFinal]);

  useEffect(() => {
    setSupported(!!recognitionCtor());
    const release = () => { const r = recRef.current; recRef.current = null; r?.abort(); };
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) { setError('unsupported'); return; }
    // Chrome sends the audio to its speech service, so there is no dictation without a connection.
    if (navigator.onLine === false) { setError('offline'); return; }
    recRef.current?.abort();
    setError(null);
    setInterim('');
    const rec = new Ctor();
    rec.lang = speechLocale(lang);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let done = '';
      let mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? '';
        if (r?.isFinal) done += t; else mid += t;
      }
      if (done.trim()) finalRef.current(done.trim());
      setInterim(mid.trim());
    };
    rec.onerror = (e) => { const k = dictationError(e.error); if (k) setError(k); };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
      setError('other');
    }
  }, [lang]);

  const stop = useCallback(() => { recRef.current?.stop(); }, []);
  const toggle = useCallback(() => { if (recRef.current) recRef.current.stop(); else start(); }, [start]);
  const clearError = useCallback(() => setError(null), []);
  return { supported, listening, interim, error, start, stop, toggle, clearError };
}

/** Put dictated words into a form field, so React (if it controls the field) sees the change too. */
function appendToField(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const next = appendDictation(el.value, text);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const MIC_SIZE = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'min-h-11 px-4',
} as const;

/** The microphone button itself. Red, with a pulse (when motion is allowed), while listening. */
function MicControl({ d, lang, size, withLabel, label, disabled, className = '' }: {
  d: Dictation; lang: VoiceLang; size: keyof typeof MIC_SIZE; withLabel?: boolean; label?: string; disabled?: boolean; className?: string;
}) {
  const online = useOnline();
  const title = !online ? dictationErrorText(lang, 'offline') : `${say(lang, 'speakAria')}. ${say(lang, 'privacy')}`;
  return (
    <button
      type="button" data-voice="mic" onClick={d.toggle} disabled={disabled}
      aria-pressed={d.listening}
      aria-label={d.listening ? say(lang, 'stopListening') : (label ?? say(lang, 'speakAria'))}
      title={d.listening ? say(lang, 'stopListening') : title}
      className={`relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 disabled:opacity-50 ${MIC_SIZE[size]} ${
        d.listening ? 'border-crit bg-crit text-white' : online ? 'border-line-strong bg-white text-ink-soft hover:border-brand/50 hover:text-brand' : 'border-line bg-paper-sunk text-ink-faint'
      } ${className}`}
    >
      {d.listening ? <span aria-hidden className="absolute inset-0 rounded-full ring-4 ring-crit/30 motion-safe:animate-pulse" /> : null}
      <VIcon d={d.listening ? PATH.stop : PATH.mic} size={size === 'sm' ? 15 : 18} />
      {withLabel ? <span className="text-sm">{d.listening ? say(lang, 'stopListening') : (label ?? say(lang, 'speak'))}</span> : null}
    </button>
  );
}

/**
 * A mic for a text box the parent controls (the Claude input): the words heard are passed to
 * `onText`. While listening, or after a problem, a small note floats above the button.
 */
export function MicButton({ onText, lang: langProp, size = 'md', disabled, className = '' }: {
  onText: (text: string) => void; lang?: VoiceLang; size?: 'sm' | 'md'; disabled?: boolean; className?: string;
}) {
  const pageLang = usePageLang();
  const lang = langProp ?? pageLang;
  const d = useDictation(lang, onText);
  const { error, clearError } = d;
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 7000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  if (!d.supported) return null;
  return (
    <span className={`relative inline-flex ${className}`}>
      <MicControl d={d} lang={lang} size={size} disabled={disabled} />
      {d.listening || d.error ? (
        <span role={d.error ? 'alert' : 'status'} onClick={clearError}
          className={`absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[80vw] rounded-lg border px-3 py-2 text-left text-xs leading-snug shadow-card ${
            d.error ? 'border-crit/30 bg-crit-light text-crit' : 'border-line bg-white text-ink-soft'}`}>
          {d.error ? dictationErrorText(lang, d.error) : (
            <>
              <span className="flex items-center gap-1.5 font-semibold text-crit">
                <span aria-hidden className="h-2 w-2 rounded-full bg-crit motion-safe:animate-pulse" />{say(lang, 'listening')}
              </span>
              {d.interim ? <span className="mt-1 block text-ink">“{d.interim}”</span> : null}
              <span className="mt-1 block text-2xs text-ink-faint">{say(lang, 'privacy')}</span>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A large "Speak the note" button for a form field it sits beside (found by `field`, the
 * field's name, in the same form). Words are added to whatever is already typed, so speaking
 * and typing mix. Shows what it is hearing, what went wrong, and where the speech goes.
 */
export function NoteMic({ field = 'note', lang, className = '' }: { field?: string; lang: VoiceLang; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const onText = useCallback((text: string) => {
    const form = boxRef.current?.closest('form');
    const el = form?.querySelector<HTMLTextAreaElement | HTMLInputElement>(`textarea[name="${field}"], input[name="${field}"]`);
    if (el) appendToField(el, text);
  }, [field]);
  const d = useDictation(lang, onText);
  if (!d.supported) return null;
  return (
    <div ref={boxRef} className={`mb-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <MicControl d={d} lang={lang} size="lg" withLabel label={say(lang, 'speakNote')} />
        {d.listening ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-crit">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-crit motion-safe:animate-pulse" />{say(lang, 'listening')}
          </span>
        ) : null}
      </div>
      {d.listening && d.interim ? <p className="mt-1.5 text-sm italic text-ink-soft">“{d.interim}”</p> : null}
      {d.error ? <p role="alert" className="mt-1.5 rounded-md border border-crit/30 bg-crit-light px-3 py-1.5 text-sm text-crit">{dictationErrorText(lang, d.error)}</p> : null}
      <p className="mt-1.5 text-xs leading-snug text-ink-faint">{say(lang, 'privacy')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- reading aloud
// One voice for the whole page: starting one Listen button stops any other. Which button owns
// the voice is shared through a tiny store so the others show "Listen" again.
let owner: string | null = null;
let token = 0;
const subs = new Set<() => void>();
const setOwner = (id: string | null) => { owner = id; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let pageHideHooked = false;

export interface Speaker {
  supported: boolean | null;
  speaking: boolean;
  /** Set when Hindi was asked for and the phone has no Hindi voice. */
  noVoice: boolean;
  speak(text: string, lang: VoiceLang): boolean;
  stop(): void;
}

/**
 * Text to speech, a little slower than normal for clarity, with a Hindi voice for Hindi when
 * the phone has one. Stops when the component goes, when the route changes, and when the page
 * is hidden.
 */
export function useSpeak(): Speaker {
  const id = useId();
  const speaking = useSyncExternalStore(subscribe, () => owner === id, () => false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [noVoice, setNoVoice] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const s = synth();
    setSupported(!!s);
    if (!s) return;
    // Chrome fills the voice list late; asking once makes it start loading.
    s.getVoices();
    if (!pageHideHooked) {
      pageHideHooked = true;
      window.addEventListener('pagehide', () => { synth()?.cancel(); setOwner(null); });
    }
    return () => { if (owner === id) { s.cancel(); setOwner(null); } };
  }, [id]);

  // A new page: stop reading the old one.
  useEffect(() => () => { if (owner === id) { synth()?.cancel(); setOwner(null); } }, [path, id]);

  const stop = useCallback(() => {
    if (owner !== id) return;
    synth()?.cancel();
    setOwner(null);
  }, [id]);

  const speak = useCallback((text: string, lang: VoiceLang) => {
    const s = synth();
    if (!s) return false;
    const chunks = chunkSpeech(text);
    if (!chunks.length) return false;
    s.cancel();
    const voices = s.getVoices();
    const voice = pickVoice(voices, lang);
    setNoVoice(lang === 'hi' && !voice && voices.length > 0);
    const mine = ++token;
    setOwner(id);
    const finish = () => { if (owner === id && token === mine) setOwner(null); };
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = speechLocale(lang);
      if (voice) u.voice = voice;
      u.rate = 0.9;
      u.pitch = 1;
      if (i === chunks.length - 1) u.onend = finish;
      u.onerror = (ev) => { if (ev.error !== 'interrupted' && ev.error !== 'canceled') finish(); };
      s.speak(u);
    });
    // A paused engine (Chrome after a tab switch) would otherwise stay silent.
    if (s.paused) s.resume();
    return true;
  }, [id]);

  return { supported, speaking, noVoice, speak, stop };
}

const SPEAK_SIZE = {
  sm: 'btn-ghost btn-sm px-2 text-xs',
  md: 'btn-quiet min-h-11 px-3 text-sm',
  lg: 'btn-quiet min-h-12 px-4 text-base',
} as const;

/**
 * "सुनें / Listen": reads `text` aloud, and becomes "Stop" while it does. The voice follows
 * the text (Devanagari is read in Hindi); the button's own words follow `lang` or the page.
 * `subject` names what is read, for screen readers ("Listen: Class 3 assessment").
 */
export function SpeakButton({ text, lang: langProp, label, subject, size = 'md', className = '' }: {
  text: string; lang?: VoiceLang; label?: string; subject?: string; size?: keyof typeof SPEAK_SIZE; className?: string;
}) {
  const pageLang = usePageLang();
  const lang = langProp ?? pageLang;
  const sp = useSpeak();
  if (!sp.supported || !text.trim()) return null;
  const words = sp.speaking ? say(lang, 'stop') : (label ?? say(lang, 'listen'));
  const aria = sp.speaking ? say(lang, 'stop') : `${label ?? say(lang, 'listen')}${subject ? `: ${subject}` : ''}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <button type="button" data-voice="speak" aria-pressed={sp.speaking} aria-label={aria} title={aria}
        onClick={() => (sp.speaking ? sp.stop() : sp.speak(text, voiceLangFor(text, lang)))}
        className={`${SPEAK_SIZE[size]} ${sp.speaking ? 'border-brand/40 bg-brand-light text-brand' : ''}`}>
        {sp.speaking ? (
          <span aria-hidden className="flex h-4 items-end gap-0.5">
            <span className="h-2 w-0.5 rounded bg-current motion-safe:animate-pulse" />
            <span className="h-4 w-0.5 rounded bg-current motion-safe:animate-pulse [animation-delay:150ms]" />
            <span className="h-3 w-0.5 rounded bg-current motion-safe:animate-pulse [animation-delay:300ms]" />
          </span>
        ) : <VIcon d={PATH.speaker} size={size === 'sm' ? 14 : 18} />}
        {words}
      </button>
      {sp.noVoice && sp.speaking ? <span role="status" className="text-xs text-ink-faint">{say(lang, 'noHindiVoice')}</span> : null}
    </span>
  );
}
