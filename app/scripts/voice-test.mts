/**
 * Voice: the words read aloud and the rules around speaking and dictation (src/lib/voice-text.ts).
 *
 * The browser half (microphone, speech synthesis) cannot be driven here; scripts/voice-e2e.cjs
 * checks it in a real browser with fake speech objects. This file checks the pure parts: the
 * Hindi read-aloud text for a task and for the day, which voice is chosen, how answers are
 * cleaned and split for speaking, and how dictated words join what was typed.
 *
 *   npx tsx --conditions=react-server scripts/voice-test.mts
 */
import type { SpokenTask } from '../src/lib/voice-text';
const {
  appendDictation, chunkSpeech, daySpeech, dictationError, dictationErrorText, pickVoice, speakable,
  speechLocale, spokenDue, taskSpeech, voiceLangFor,
} = await import('../src/lib/voice-text');

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};
const DEVA = /[ऀ-ॿ]/;
const latinWords = (s: string) => (s.match(/[A-Za-z]{2,}/g) ?? []);

console.log('--- locales ---');
ok('Hindi dictation and voice use hi-IN', speechLocale('hi') === 'hi-IN');
ok('English uses Indian English', speechLocale('en') === 'en-IN');

console.log('\n--- a task read aloud in Hindi ---');
const task: SpokenTask = {
  title: 'कक्षा 3 का त्वरित आकलन करें', school: 'PS Rampur', dueIn: -3, dueDate: '28 अक्टू॰ 2026',
  pieces: 1, proofCount: 3, proofLabel: 'त्वरित आकलन पत्रक', rejection: 'फ़ोटो धुंधला है।',
};
const hi = taskSpeech('hi', task);
console.log(`       “${hi}”`);
ok('starts with the title', hi.startsWith('कक्षा 3 का त्वरित आकलन करें।'));
ok('names the school', hi.includes('विद्यालय: PS Rampur।'));
ok('says it is late, in Hindi', hi.includes('3 दिन की देरी'));
ok('says what proof is needed and how much is left', hi.includes('आवश्यक सबूत: त्वरित आकलन पत्रक') && hi.includes('3 में से 1 जमा, 2 और चाहिए'));
ok('says why it came back, without a doubled full stop', hi.includes('लौटाने का कारण: फ़ोटो धुंधला है।') && !hi.includes('।।'));
ok('the only English words are the data (the school name)', latinWords(hi).every((w) => ['PS', 'Rampur'].includes(w)), latinWords(hi).join(','));
ok('Hindi sentences end with a danda, not a full stop', !/[^\d]\.\s/.test(hi));

const fresh = taskSpeech('hi', { ...task, dueIn: 0, pieces: 0, rejection: null, school: null });
ok('due today, nothing handed in yet, all plan schools', fresh.includes('आज देय') && fresh.includes('अभी कोई जमा नहीं') && fresh.includes('सभी योजना विद्यालयों के लिए'), fresh);
const waiting = taskSpeech('hi', { ...task, waiting: true, pieces: 3, rejection: null });
ok('a task being checked says so and does not read a deadline', waiting.includes('कोई और उनकी जाँच कर रहा है') && !waiting.includes('देरी'), waiting);
ok('the independent check is mentioned', taskSpeech('hi', { ...task, crossSource: true }).includes('यह स्वतंत्र जाँच है'));
ok('spoken due dates', spokenDue('hi', 1, 'x') === 'कल देय' && spokenDue('hi', 5, '6 नव॰') === '6 नव॰ तक देय' && spokenDue('hi', -1, 'x') === '1 दिन की देरी');

const en = taskSpeech('en', { ...task, title: 'Run the Class 3 spot assessment', proofLabel: 'Spot-assessment sheet', rejection: 'Photo is blurred.' });
ok('English: title, school, lateness, proof left', en.startsWith('Run the Class 3 spot assessment.') && en.includes('School: PS Rampur.') && en.includes('3 days late') && en.includes('1 of 3 handed in, 2 more to go'), en);
ok('English is not mixed with Hindi', !DEVA.test(en));

console.log('\n--- the whole day in Hindi ---');
const day = daySpeech('hi', {
  name: 'सुनीता', date: '1 नव॰ 2026', summary: 'आपके 2 खुले कामों में से 1 पर आज ध्यान चाहिए।',
  tasks: [task, { ...task, title: 'उपस्थिति रजिस्टर का फ़ोटो भेजें', dueIn: 4, rejection: null }, { ...task, waiting: true, rejection: null }],
});
console.log(`       “${day.slice(0, 160)}…”`);
ok('greets by name and gives the date', day.startsWith('नमस्ते, सुनीता। आज 1 नव॰ 2026 है।'));
ok('reads the summary', day.includes('आपके 2 खुले कामों में से 1 पर आज ध्यान चाहिए।'));
ok('numbers the open tasks in order', day.indexOf('काम 1:') > 0 && day.indexOf('काम 2:') > day.indexOf('काम 1:') && !day.includes('काम 3:'));
ok('mentions the tasks being checked once, at the end', day.trim().endsWith('1 और काम जमा हैं, उनकी जाँच हो रही है।'), day.slice(-80));

console.log('\n--- which voice reads ---');
const voices = [
  { lang: 'en-US', name: 'Samantha', localService: true },
  { lang: 'hi-IN', name: 'Google हिन्दी', localService: false },
  { lang: 'hi-IN', name: 'Lekha', localService: true },
  { lang: 'en-IN', name: 'Rishi', localService: true },
  { lang: 'en_GB', name: 'Daniel', localService: true },
];
ok('Hindi page: a hi-IN voice on the phone first', pickVoice(voices, 'hi')?.name === 'Lekha');
ok('English: the Indian English voice', pickVoice(voices, 'en')?.name === 'Rishi');
ok('Hindi with only a network Hindi voice still gets it', pickVoice(voices.filter((v) => v.name !== 'Lekha'), 'hi')?.name === 'Google हिन्दी');
ok('a bare "hi" locale counts as Hindi', pickVoice([{ lang: 'hi', name: 'x' }], 'hi')?.name === 'x');
ok('no Hindi voice: null, so the caller falls back', pickVoice(voices.filter((v) => !v.lang.startsWith('hi')), 'hi') === null);
ok('an empty voice list (Chrome before voiceschanged) is null', pickVoice([], 'hi') === null);
ok('underscored locales are understood', pickVoice([{ lang: 'en_GB', name: 'Daniel' }], 'en')?.name === 'Daniel');

console.log('\n--- the language a text is read in ---');
ok('a Hindi answer on an English page is read in Hindi', voiceLangFor('इस सप्ताह 3 काम विलंबित हैं, CASE-0184 देखें।', 'en') === 'hi');
ok('an English answer on an English page stays English', voiceLangFor('Three tasks are late this week.', 'en') === 'en');
ok('Hindi text with a few English names stays Hindi', voiceLangFor('विद्यालय: PS Rampur। आज देय।', 'hi') === 'hi');
ok('a long English answer on a Hindi page is read in English', voiceLangFor('Three tasks are late this week; the Rampur cluster has two of them.', 'hi') === 'en');
ok('a short label follows the page', voiceLangFor('OK', 'hi') === 'hi' && voiceLangFor('', 'hi') === 'hi');

console.log('\n--- answers cleaned for speaking ---');
const md = '## सारांश\n\n**3 काम** विलंबित हैं [TSK-00012, TSK-00013].\n\n- पहला: `CASE-0184`\n- दूसरा\n\n| a | b |\n|---|---|\n| 1 | 2 |';
const sp = speakable(md);
ok('no markdown symbols left', !/[*#`|]/.test(sp), sp);
ok('bracketed record citations are dropped', !sp.includes('TSK-00012') && sp.includes('3 काम विलंबित हैं.'), sp);
ok('list items and headings keep their words', sp.includes('सारांश') && sp.includes('पहला: CASE-0184') && sp.includes('दूसरा'));

console.log('\n--- split for the browser ---');
const long = Array.from({ length: 12 }, (_, i) => `यह वाक्य संख्या ${i + 1} है।`).join(' ');
const parts = chunkSpeech(long, 80);
ok('long text becomes several pieces', parts.length > 1, String(parts.length));
ok('no piece is longer than the limit', parts.every((x) => x.length <= 80), parts.map((x) => x.length).join(','));
ok('nothing is lost', parts.join(' ').replace(/\s+/g, ' ') === long);
ok('pieces break at the danda', parts.every((x) => x.endsWith('।')));
const run = 'शब्द '.repeat(120).trim();
const runParts = chunkSpeech(run, 100);
ok('a sentence with no stop is still split, at spaces', runParts.length > 1 && runParts.every((x) => x.length <= 100) && runParts.join(' ').replace(/\s+/g, ' ') === run);
ok('empty text: nothing to say', chunkSpeech('  \n ').length === 0);

console.log('\n--- dictation ---');
ok('dictated words join typed words with one space', appendDictation('कक्षा 3', 'बीस बच्चे') === 'कक्षा 3 बीस बच्चे');
ok('into an empty box, just the words', appendDictation('', '  बीस बच्चे ') === 'बीस बच्चे');
ok('no doubled space after a trailing one', appendDictation('पहला ', 'दूसरा') === 'पहला दूसरा');
ok('silence changes nothing', appendDictation('पहला', '   ') === 'पहला');
ok('permission refused', dictationError('not-allowed') === 'denied' && dictationError('service-not-allowed') === 'denied');
ok('no connection', dictationError('network') === 'offline');
ok('nothing heard', dictationError('no-speech') === 'no-speech');
ok('our own stop is not an error', dictationError('aborted') === null);
ok('unknown codes are a general error', dictationError('bad-grammar') === 'other');
const offlineHi = dictationErrorText('hi', 'offline');
ok('the offline message says, in Hindi, that a connection is needed', offlineHi.includes('इंटरनेट चाहिए'), offlineHi);
ok('every message exists in both languages', (['unsupported', 'denied', 'no-speech', 'offline', 'no-mic', 'language', 'other'] as const)
  .every((e) => DEVA.test(dictationErrorText('hi', e)) && !DEVA.test(dictationErrorText('en', e))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
