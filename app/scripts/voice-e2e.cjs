/**
 * Voice in a real browser, at phone size, for a headmaster using the app in Hindi.
 *
 * Headless Chrome has no microphone and no voices, so the page gets fake Web Speech objects
 * (installed before any page script runs): a SpeechRecognition that "hears" a Hindi sentence,
 * and a speechSynthesis that records what it was asked to say. Then:
 *
 *  - My day: "मेरा दिन सुनें" reads the day in Hindi, with the Hindi voice, a little slower;
 *    each task has its own Listen; starting one stops the other;
 *  - the proof note's mic fills the note with the Hindi transcript (asked for in hi-IN), shows
 *    that it is listening (aria-pressed), says plainly when there is no connection or the
 *    microphone is blocked, and does not pulse when the phone asks for reduced motion;
 *  - the task page: Listen reads the task in Hindi; the proof note's mic works there too;
 *  - the Claude drawer: a mic in the input; a Hindi answer is read with the Hindi voice;
 *  - a browser without the speech APIs shows no voice controls at all, and nothing breaks;
 *  - no page errors anywhere.
 *
 * Fresh database and fresh server first:
 *   KV_BASE=http://localhost:3101 node scripts/voice-e2e.cjs
 * Screenshots go to $KARYAVAHI_SHOTS (default /tmp/karyavahi-shots).
 */
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
let chromium, launchOpts = {};
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); launchOpts = { channel: 'chrome' }; }
const SHOTS = process.env.KARYAVAHI_SHOTS ?? '/tmp/karyavahi-shots';
require('node:fs').mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.KV_BASE ?? 'http://localhost:3000';

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { fails++; console.log(`  FAIL ${label} ${extra}`); }
};
const q1 = (sql, ...p) => {
  const d = new DatabaseSync(join(process.cwd(), '.data', 'karyavahi.db'), { readOnly: true });
  try { return d.prepare(sql).get(...p); } finally { d.close(); }
};

const HEARD = 'कक्षा तीन के बीस बच्चों का आकलन किया गया';
const ANSWER = 'इस सप्ताह **3 काम** विलंबित हैं [TSK-00012]। सबसे पहले रामपुर संकुल के विद्यालयों पर ध्यान दें।';

/** Fake Web Speech, installed before the app's scripts. Records what the app asks of it. */
function fakeSpeech(heard) {
  window.__spoken = [];
  window.__recLangs = [];
  window.__cancels = 0;
  window.__deny = false;
  const voices = [
    { lang: 'en-IN', name: 'Fake English', localService: true, default: true, voiceURI: 'en' },
    { lang: 'hi-IN', name: 'Fake Hindi', localService: true, default: false, voiceURI: 'hi' },
  ];
  class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; }
  }
  const synthFake = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    speak(u) {
      window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate });
      setTimeout(() => { if (u.onend) u.onend({}); }, 4000);
    },
    cancel() { window.__cancels++; },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synthFake, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });

  class FakeRecognition {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; this.timers = []; }
    start() {
      window.__recLangs.push(this.lang);
      const result = (t, fin) => { const r = [{ transcript: t }]; r.isFinal = fin; return r; };
      if (window.__deny) {
        this.timers.push(setTimeout(() => { if (this.onerror) this.onerror({ error: 'not-allowed' }); if (this.onend) this.onend(); }, 100));
        return;
      }
      this.timers.push(setTimeout(() => { if (this.onresult) this.onresult({ resultIndex: 0, results: [result('कक्षा तीन', false)] }); }, 400));
      this.timers.push(setTimeout(() => { if (this.onresult) this.onresult({ resultIndex: 0, results: [result(heard, true)] }); }, 1200));
      this.timers.push(setTimeout(() => { if (this.onend) this.onend(); }, 1300));
    }
    stop() { this.timers.forEach(clearTimeout); setTimeout(() => { if (this.onend) this.onend(); }, 0); }
    abort() { this.stop(); }
  }
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
}

/** A browser with none of the speech APIs (Firefox, many in-app browsers). */
function noSpeech() {
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis', 'SpeechSynthesisUtterance']) {
    try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch { /* ignore */ }
  }
}

function seedChat({ key, answer }) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ active: 'c1', convos: [{ id: 'c1', title: 'विलंबित काम', updated: Date.now(), msgs: [
      { role: 'user', content: 'इस सप्ताह कौन से काम विलंबित हैं?' },
      { role: 'assistant', content: answer, sources: ['TSK-00012'], model: 'fake-model' },
    ] }] }));
  } catch { /* ignore */ }
}

(async () => {
  await fetch(`${BASE}/demo`).catch(() => {});
  const T = q1(`select t.id, t.owner_user_id, u.email, t.title_hi
                  from tasks t join users u on u.id = t.owner_user_id
                 where t.owner_role = 'headmaster' and t.status in ('in_progress','acknowledged','assigned','sent_back')
                 order by t.id limit 1`);
  if (!T) { console.log('  FAIL no open headmaster task in the database'); process.exit(1); }

  const browser = await chromium.launch(launchOpts);
  require('./no-google-maps.cjs').blockGoogleMaps(browser);
  const errors = [];
  const { isBlockedGoogle } = require('./no-google-maps.cjs');
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${String(e)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !isBlockedGoogle(m)) errors.push(`${page.url()}: console: ${m.text()}`); });
  };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' };
  const signInAs = async (ctx) => {
    const r = await ctx.request.post(`${BASE}/api/sign-in`, { form: { email: T.email }, maxRedirects: 0 });
    await ctx.addCookies([{ name: 'kv_lang', value: 'hi', url: BASE }]);
    return r.status();
  };

  // ------------------------------------------------------------------ with speech
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(fakeSpeech, HEARD);
  await ctx.addInitScript(seedChat, { key: `kv_ai_chat_v1:${T.owner_user_id}`, answer: ANSWER });
  ok('the headmaster signs in', [302, 303].includes(await signInAs(ctx)));
  const page = await ctx.newPage();
  watch(page);

  console.log('--- My day, in Hindi ---');
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  const dayBtn = page.locator('[data-voice="speak"][aria-label^="मेरा दिन सुनें"]');
  await dayBtn.waitFor({ timeout: 5000 }).catch(() => {});
  ok('a "मेरा दिन सुनें" button is on My day', (await dayBtn.count()) === 1);
  ok('it is a big touch target (at least 44px tall)', ((await dayBtn.boundingBox())?.height ?? 0) >= 44, JSON.stringify(await dayBtn.boundingBox()));
  const perTask = page.locator('li [data-voice="speak"][aria-label^="सुनें:"]');
  ok('each task card has its own Listen, named after the task', (await perTask.count()) >= 1, String(await perTask.count()));
  ok('the per-task Listen is at least 44px tall', ((await perTask.first().boundingBox())?.height ?? 0) >= 44);

  await dayBtn.click();
  await page.waitForTimeout(200);
  let spoken = await page.evaluate(() => window.__spoken);
  ok('Listen asked the browser to speak', spoken.length > 0, JSON.stringify(spoken).slice(0, 200));
  ok('in Hindi (hi-IN) with the Hindi voice', spoken.length > 0 && spoken.every((s) => s.lang === 'hi-IN' && s.voice === 'Fake Hindi'), JSON.stringify(spoken.slice(0, 2)));
  ok('a little slower than normal', spoken.every((s) => s.rate > 0.7 && s.rate < 1));
  const said = spoken.map((s) => s.text).join(' ');
  ok('the words are Hindi: greeting, summary, the first task', /नमस्ते/.test(said) && /काम 1:/.test(said) && /[ऀ-ॿ]/.test(said), said.slice(0, 160));
  ok('it says what proof is needed', /आवश्यक सबूत/.test(said));
  ok('no piece is too long for Chrome to finish', spoken.every((s) => s.text.length <= 220));
  ok('while reading, the button says रोकें and is pressed', (await page.locator('[data-voice="speak"][aria-pressed="true"]').count()) === 1
    && (await page.locator('[data-voice="speak"][aria-pressed="true"]').innerText()).includes('रोकें'));

  const cancelsBefore = await page.evaluate(() => window.__cancels);
  await page.evaluate(() => { window.__spoken = []; });
  await perTask.first().click();
  await page.waitForTimeout(200);
  spoken = await page.evaluate(() => window.__spoken);
  ok('a task\'s Listen reads just that task, in Hindi', spoken.length > 0 && !/नमस्ते/.test(spoken.map((s) => s.text).join(' ')) && spoken[0].lang === 'hi-IN');
  ok('starting it stopped the day reading (one voice at a time)', (await page.evaluate(() => window.__cancels)) > cancelsBefore
    && (await page.locator('[data-voice="speak"][aria-pressed="true"]').count()) === 1
    && (await dayBtn.getAttribute('aria-pressed')) === 'false');

  console.log('\n--- speaking the proof note on My day ---');
  const handIn = page.locator('details summary', { hasText: 'सबूत जमा करें' }).first();
  await handIn.click();
  const form = page.locator('details[open] form').first();
  const mic = form.locator('[data-voice="mic"]');
  await mic.waitFor({ timeout: 5000 }).catch(() => {});
  ok('the proof form has a mic', (await mic.count()) === 1);
  ok('it is labelled in Hindi and big enough to tap', (await mic.getAttribute('aria-label')) === 'बोलकर लिखें' && ((await mic.boundingBox())?.height ?? 0) >= 44);
  ok('the form says where the speech goes', (await form.innerText()).includes('ब्राउज़र की अपनी वाक्-सेवा'));
  await form.locator('textarea[name="note"]').fill('सुबह');
  await mic.click();
  await page.waitForTimeout(150);
  ok('while listening it is pressed and says so', (await mic.getAttribute('aria-pressed')) === 'true' && (await form.innerText()).includes('सुन रहा है'));
  ok('the pulse is off when the phone asks for reduced motion', await mic.evaluate((b) => [...b.querySelectorAll('span')].every((s) => getComputedStyle(s).animationName === 'none')));
  await page.waitForTimeout(600);
  ok('words still being heard are shown', (await form.innerText()).includes('कक्षा तीन'));
  await page.waitForTimeout(1000);
  ok('it asked for Hindi dictation (hi-IN)', (await page.evaluate(() => window.__recLangs)).at(-1) === 'hi-IN');
  ok('the note now holds what was typed plus the Hindi transcript', (await form.locator('textarea[name="note"]').inputValue()) === `सुबह ${HEARD}`,
    await form.locator('textarea[name="note"]').inputValue());
  ok('and the mic is released', (await mic.getAttribute('aria-pressed')) === 'false');
  await page.screenshot({ path: `${SHOTS}/voice-myday-390.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/voice-myday-top-390.png`, fullPage: false });

  await ctx.setOffline(true);
  await mic.click();
  await page.waitForTimeout(200);
  ok('offline: it says plainly that dictation needs a connection', (await form.innerText()).includes('बोलकर लिखने के लिए इंटरनेट चाहिए'));
  ok('offline: it did not try to listen', (await mic.getAttribute('aria-pressed')) === 'false');
  await ctx.setOffline(false);
  await page.evaluate(() => { window.__deny = true; });
  await mic.click();
  await page.waitForTimeout(400);
  ok('microphone blocked: it says how to allow it', (await form.innerText()).includes('माइक्रोफ़ोन की अनुमति नहीं है'));
  await page.evaluate(() => { window.__deny = false; });

  console.log('\n--- the task page ---');
  await page.goto(`${BASE}/tasks/${T.id}`, { waitUntil: 'networkidle' });
  const taskListen = page.locator('[data-voice="speak"]').first();
  await taskListen.waitFor({ timeout: 5000 }).catch(() => {});
  ok('the task page has Listen', (await taskListen.count()) === 1);
  await page.evaluate(() => { window.__spoken = []; });
  await taskListen.click();
  await page.waitForTimeout(200);
  spoken = await page.evaluate(() => window.__spoken);
  const taskSaid = spoken.map((s) => s.text).join(' ');
  ok('it reads the task title in Hindi with the Hindi voice', taskSaid.includes(T.title_hi.trim().replace(/[.।]$/, '')) && spoken.every((s) => s.lang === 'hi-IN' && s.voice === 'Fake Hindi'), taskSaid.slice(0, 160));
  ok('it says the school and the proof needed', /विद्यालय/.test(taskSaid) && /आवश्यक सबूत/.test(taskSaid));
  await page.locator('details summary', { hasText: 'सबूत जमा करें' }).first().click();
  const tForm = page.locator('details[open] form').first();
  const tMic = tForm.locator('[data-voice="mic"]');
  await tMic.waitFor({ timeout: 5000 }).catch(() => {});
  ok('the task page\'s proof form has a mic', (await tMic.count()) === 1);
  await tMic.click();
  await page.waitForTimeout(1600);
  ok('it fills the proof note with the Hindi transcript', (await tForm.locator('textarea[name="note"]').inputValue()) === HEARD);
  ok('the location field and the submit button are still there', (await tForm.locator('input[data-kv-loc]').count()) >= 1 && (await tForm.locator('button[type="submit"]').count()) === 1);

  console.log('\n--- the Claude drawer ---');
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  const trigger = page.locator('button[title="इस पृष्ठ के बारे में Claude से पूछें"]');
  ok('the drawer can be opened', (await trigger.count()) === 1);
  await trigger.click();
  const drawer = page.locator('[role="dialog"]');
  await drawer.waitFor({ timeout: 5000 });
  const cMic = drawer.locator('form [data-voice="mic"]');
  await cMic.waitFor({ timeout: 5000 }).catch(() => {});
  ok('the Claude input has a mic', (await cMic.count()) === 1);
  ok('its tooltip says where the speech goes', ((await cMic.getAttribute('title')) ?? '').includes('वाक्-सेवा'));
  const input = drawer.locator('textarea[aria-label="Ask Claude"]');
  if (await cMic.isEnabled()) {
    await cMic.click();
    await page.waitForTimeout(1600);
    ok('the mic puts the Hindi question in the input', (await input.inputValue()) === HEARD, await input.inputValue());
  } else {
    ok('Claude is not connected here, so the mic is disabled with the input', await input.isDisabled());
  }
  const ansListen = drawer.locator('[data-voice="speak"]');
  ok('the answer has a Listen button', (await ansListen.count()) >= 1);
  await page.evaluate(() => { window.__spoken = []; });
  await ansListen.first().click();
  await page.waitForTimeout(200);
  spoken = await page.evaluate(() => window.__spoken);
  const ansSaid = spoken.map((s) => s.text).join(' ');
  ok('the Hindi answer is read with the Hindi voice', spoken.length > 0 && spoken.every((s) => s.lang === 'hi-IN' && s.voice === 'Fake Hindi'), JSON.stringify(spoken).slice(0, 200));
  ok('without markdown or record-id citations', ansSaid.includes('3 काम विलंबित हैं') && !ansSaid.includes('**') && !ansSaid.includes('TSK-00012'), ansSaid);
  await page.screenshot({ path: `${SHOTS}/voice-drawer-390.png`, fullPage: false });
  const cancelsOpen = await page.evaluate(() => window.__cancels);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('closing the drawer stops the reading', (await page.evaluate(() => window.__cancels)) > cancelsOpen);
  await ctx.close();

  // ------------------------------------------------------------------ without speech
  console.log('\n--- a browser without the speech APIs ---');
  const bare = await browser.newContext(phone);
  await bare.addInitScript(noSpeech);
  await signInAs(bare);
  const p2 = await bare.newPage();
  watch(p2);
  await p2.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  await p2.locator('details summary', { hasText: 'सबूत जमा करें' }).first().click();
  await p2.waitForTimeout(500);
  ok('My day: no voice controls, the rest as before', (await p2.locator('[data-voice]').count()) === 0 && (await p2.locator('details[open] textarea[name="note"]').count()) === 1);
  ok('no privacy line about speech either', !(await p2.locator('body').innerText()).includes('वाक्-सेवा'));
  await p2.goto(`${BASE}/tasks/${T.id}`, { waitUntil: 'networkidle' });
  await p2.locator('details summary', { hasText: 'सबूत जमा करें' }).first().click();
  await p2.waitForTimeout(500);
  ok('task page: no voice controls, the proof form is there', (await p2.locator('[data-voice]').count()) === 0 && (await p2.locator('details[open] textarea[name="note"]').count()) === 1);
  await p2.locator('button[title="इस पृष्ठ के बारे में Claude से पूछें"]').click();
  await p2.locator('[role="dialog"]').waitFor({ timeout: 5000 });
  await p2.waitForTimeout(500);
  ok('Claude drawer: no mic and no Listen, the input is there', (await p2.locator('[data-voice]').count()) === 0 && (await p2.locator('[role="dialog"] textarea').count()) === 1);
  await bare.close();

  console.log('\n--- errors ---');
  ok('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));

  await browser.close();
  console.log(fails === 0 ? '\nall voice checks passed' : `\n${fails} voice check(s) failed`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
