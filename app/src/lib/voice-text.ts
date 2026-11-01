/**
 * The words the app reads aloud, and the small rules around speaking and dictation.
 *
 * Pure functions with no browser APIs, so the server can build the text for a page (My day, a
 * task) and the browser only has to say it, and so scripts/voice-test.mts can check them.
 * The browser side — the microphone and the reading voice — lives in src/components/voice.tsx.
 */

export type VoiceLang = 'en' | 'hi';

/** The locale handed to the browser's speech services: Indian Hindi or Indian English. */
export const speechLocale = (lang: VoiceLang): string => (lang === 'hi' ? 'hi-IN' : 'en-IN');

const DEVANAGARI = /[ऀ-ॿ]/g;

/**
 * Which voice should read a piece of text. Text that is mostly Devanagari is Hindi whatever the
 * page language is (a Claude answer in Hindi on an English page); otherwise the page language.
 */
export function voiceLangFor(text: string, pageLang: VoiceLang): VoiceLang {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return pageLang;
  const deva = (letters.match(DEVANAGARI) ?? []).length;
  if (deva / letters.length >= 0.3) return 'hi';
  return deva === 0 && pageLang === 'hi' && letters.length > 40 ? 'en' : pageLang;
}

export interface VoiceInfo { lang: string; name: string; localService?: boolean; default?: boolean }

/**
 * The best installed voice for a language: an exact Indian locale first (hi-IN, en-IN), then
 * any voice of that language, preferring one on the phone (works offline) over a network one.
 * Null when the phone has none — the caller still sets the utterance language and lets the
 * browser do what it can.
 */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], lang: VoiceLang): V | null {
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const exact = speechLocale(lang).toLowerCase();
  const base = lang;
  const score = (v: V): number => {
    const l = norm(v.lang);
    let s = l === exact ? 100 : l.split('-')[0] === base ? 50 : /hindi/i.test(v.name) && lang === 'hi' ? 40 : 0;
    if (s === 0) return 0;
    if (v.localService) s += 5;
    if (/google/i.test(v.name)) s += 2; // Chrome's Google voices are the clearest of the defaults.
    return s;
  };
  let best: V | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

/**
 * Text a voice can read: markdown, record-id citations and stray symbols removed. Chat answers
 * cite records like [CASE-0184, TSK-00012]; read aloud those are noise, and they are still on
 * the screen for anyone who wants them.
 */
export function speakable(markdown: string): string {
  return markdown
    .replace(/\r/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|[\s:|-]+\|\s*$/gm, '') // table rules
    .replace(/\|/g, ', ')
    .replace(/\[(?:[A-Z]+-[A-Z0-9-]+)(?:,\s*[A-Z]+-[A-Z0-9-]+)*\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.।?!])/g, '$1')
    .replace(/(,\s*){2,}/g, ', ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Split text into pieces a browser will read without cutting off. Chrome stops long utterances
 * after about fifteen seconds, so each piece is a sentence or two, never longer than `max`.
 */
export function chunkSpeech(text: string, max = 220): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const push = (s: string) => { if (s.trim()) out.push(s.trim()); };
  for (const s of sentences) {
    if (s.length > max) {
      push(cur); cur = '';
      // A very long sentence: break at commas, then at spaces.
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(', ', max);
        if (cut < max / 3) cut = rest.lastIndexOf(' ', max);
        if (cut < 1) cut = max;
        push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      cur = rest;
      continue;
    }
    if ((cur ? cur.length + 1 : 0) + s.length > max) { push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  push(cur);
  return out;
}

/** Add dictated words to what is already typed, with one space between and none doubled. */
export function appendDictation(prev: string, add: string): string {
  const a = add.trim();
  if (!a) return prev;
  if (!prev.trim()) return a;
  return /\s$/.test(prev) ? `${prev}${a}` : `${prev} ${a}`;
}

export type DictationError = 'unsupported' | 'denied' | 'no-speech' | 'offline' | 'no-mic' | 'language' | 'other';

/** The browser's recognition error codes, grouped into what the person can do about them. */
export function dictationError(code: string): DictationError | null {
  switch (code) {
    case 'aborted': return null; // we stopped it ourselves
    case 'not-allowed':
    case 'service-not-allowed': return 'denied';
    case 'no-speech': return 'no-speech';
    case 'network': return 'offline';
    case 'audio-capture': return 'no-mic';
    case 'language-not-supported': return 'language';
    default: return 'other';
  }
}

const p = (lang: VoiceLang, en: string, hi: string) => (lang === 'hi' ? hi : en);

/** What to do about each dictation problem, in the page language. */
export function dictationErrorText(lang: VoiceLang, e: DictationError): string {
  switch (e) {
    case 'unsupported': return p(lang, 'This browser cannot turn speech into text. Type instead.', 'यह ब्राउज़र बोली को लिखे शब्दों में नहीं बदल सकता। टाइप करें।');
    case 'denied': return p(lang, 'The microphone is blocked. Allow it in the browser’s site settings, or type instead.', 'माइक्रोफ़ोन की अनुमति नहीं है। ब्राउज़र की साइट सेटिंग में अनुमति दें, या टाइप करें।');
    case 'no-speech': return p(lang, 'Nothing was heard. Tap the microphone and speak again.', 'कुछ सुनाई नहीं दिया। माइक दबाकर फिर से बोलें।');
    case 'offline': return p(lang, 'Speaking a note needs an internet connection. Type it for now; it will be saved on the phone.', 'बोलकर लिखने के लिए इंटरनेट चाहिए। अभी टाइप करें; यह फ़ोन पर सहेजा जाएगा।');
    case 'no-mic': return p(lang, 'No microphone was found on this device.', 'इस उपकरण में माइक्रोफ़ोन नहीं मिला।');
    case 'language': return p(lang, 'This browser cannot take dictation in this language.', 'यह ब्राउज़र इस भाषा में बोली नहीं लिख सकता।');
    default: return p(lang, 'The speech could not be turned into text. Try again, or type.', 'बोली को लिखा नहीं जा सका। फिर कोशिश करें, या टाइप करें।');
  }
}

// ---------------------------------------------------------------- read-aloud text for My day

export interface SpokenTask {
  title: string;
  /** School name, or null for a task across all plan schools. */
  school: string | null;
  dueIn: number;
  /** The due date already formatted for the language. */
  dueDate: string;
  pieces: number;
  proofCount: number;
  /** What kind of proof, in the language ("उपस्थिति रजिस्टर का फ़ोटो"). */
  proofLabel: string;
  rejection?: string | null;
  /** All proof is in and someone else is checking it. */
  waiting?: boolean;
  crossSource?: boolean;
}

/** When the task is due, as a spoken phrase. */
export function spokenDue(lang: VoiceLang, dueIn: number, dueDate: string): string {
  if (dueIn < -1) return p(lang, `${-dueIn} days late`, `${-dueIn} दिन की देरी`);
  if (dueIn === -1) return p(lang, '1 day late', '1 दिन की देरी');
  if (dueIn === 0) return p(lang, 'due today', 'आज देय');
  if (dueIn === 1) return p(lang, 'due tomorrow', 'कल देय');
  return p(lang, `due on ${dueDate}`, `${dueDate} तक देय`);
}

/** One task read aloud: title, school, when it is due, and what proof is still needed. */
export function taskSpeech(lang: VoiceLang, t: SpokenTask): string {
  const parts: string[] = [];
  parts.push(`${t.title.replace(/[.।]\s*$/, '')}${p(lang, '.', '।')}`);
  parts.push(t.school
    ? p(lang, `School: ${t.school}.`, `विद्यालय: ${t.school}।`)
    : p(lang, 'For all the plan schools.', 'सभी योजना विद्यालयों के लिए।'));
  const due = spokenDue(lang, t.dueIn, t.dueDate);
  if (!t.waiting) parts.push(`${due.charAt(0).toUpperCase()}${due.slice(1)}${p(lang, '.', '।')}`);
  const left = Math.max(0, t.proofCount - t.pieces);
  if (t.waiting) {
    parts.push(p(lang, 'All the proof is in. Someone else is checking it.', 'सारे सबूत जमा हैं। कोई और उनकी जाँच कर रहा है।'));
  } else if (left === 0) {
    parts.push(p(lang, `Proof needed: ${t.proofLabel}. All ${t.proofCount} handed in.`, `आवश्यक सबूत: ${t.proofLabel}। सभी ${t.proofCount} जमा हैं।`));
  } else if (t.pieces === 0) {
    parts.push(p(lang,
      `Proof needed: ${t.proofCount} ${t.proofLabel}${t.proofCount === 1 ? '' : ', in all'}. None handed in yet.`,
      `आवश्यक सबूत: ${t.proofCount} ${t.proofLabel}। अभी कोई जमा नहीं।`));
  } else {
    parts.push(p(lang,
      `Proof needed: ${t.proofLabel}. ${t.pieces} of ${t.proofCount} handed in, ${left} more to go.`,
      `आवश्यक सबूत: ${t.proofLabel}। ${t.proofCount} में से ${t.pieces} जमा, ${left} और चाहिए।`));
  }
  if (t.crossSource) parts.push(p(lang, 'This is the independent check.', 'यह स्वतंत्र जाँच है।'));
  if (t.rejection) parts.push(p(lang, `It was sent back because: ${t.rejection.replace(/[.।]\s*$/, '')}.`, `लौटाने का कारण: ${t.rejection.replace(/[.।]\s*$/, '')}।`));
  return parts.join(' ');
}

export interface SpokenDay {
  name: string;
  /** Today's date, formatted for the language. */
  date: string;
  /** The one-line summary already shown under the greeting. */
  summary: string;
  tasks: SpokenTask[];
}

/** The whole of My day read aloud: greeting, summary, then each open task in order. */
export function daySpeech(lang: VoiceLang, d: SpokenDay): string {
  const open = d.tasks.filter((t) => !t.waiting);
  const parts: string[] = [
    p(lang, `Namaste, ${d.name}. Today is ${d.date}.`, `नमस्ते, ${d.name}। आज ${d.date} है।`),
    d.summary,
  ];
  open.forEach((t, i) => {
    parts.push(`${p(lang, `Task ${i + 1}`, `काम ${i + 1}`)}: ${taskSpeech(lang, t)}`);
  });
  const waiting = d.tasks.length - open.length;
  if (waiting > 0) {
    parts.push(p(lang,
      `${waiting} more ${waiting === 1 ? 'task is' : 'tasks are'} handed in and being checked.`,
      `${waiting} और काम जमा हैं, उनकी जाँच हो रही है।`));
  }
  return parts.join(' ');
}
