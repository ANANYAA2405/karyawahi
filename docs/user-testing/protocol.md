# Test protocol — Karyavahi user sessions

Plain-language guide for running a 20–30 minute session with one person. Two people from the
team per session is best: one **facilitator** (talks, gives tasks) and one **note-taker** (fills
in `session-sheet.csv`, says nothing).

---

## 1. What we want to learn

1. Can each kind of user do their most important job in the app **without help**?
2. Where do they get stuck, slow down, or do the wrong thing?
3. Do they **trust and understand** what Claude writes? Is it useful, is the Hindi clear?
4. Does the phone flow (My day, proof with a photo, no signal) work for a headmaster in a real
   school setting?
5. What would make them actually use it every week?

We are testing **the app, not the person**. Say this to them, and believe it.

---

## 2. Who to recruit

| Group | How many | Real job | Stand-in if you cannot reach one |
| --- | --- | --- | --- |
| Block / district officers | 2–3 | BEO, DEO, or a block-level programme officer | A teacher-educator, DIET faculty, or anyone who has reviewed school data for a block |
| Cluster / block coordinators | 3–4 | CRC, BRC | A teacher who has done school visits or mentoring |
| Headmasters or teachers | 3–4 | Headmaster, head teacher, senior teacher | A teacher at any government or low-fee private school |

**Total 8–11 people.** Five people per group find most of the big problems; three is fine for a
first round.

- **Stand-ins are allowed but must be labelled.** In the session sheet, write the role they are
  standing in for and put `stand-in` in the `participant_type` column. Never present a stand-in
  as a real BEO, CRC or headmaster on `/changes` or in a pitch.
- Mix: at least one person who is not comfortable with smartphones, at least one who prefers
  Hindi, and at least one woman in each group if you can.
- Give each person a code — **P01, P02, …** — and use only that code in every note.
- Device: officers on a laptop **and** a phone if possible; coordinators and headmasters on
  **their own Android phone** (that is the real situation), with a spare phone ready.

---

## 3. Before the session (15 minutes)

- [ ] App running on a laptop on the same Wi-Fi, or on a hosted demo; open the address on the
      participant's phone first to check it loads. (Production build: `npm run build` then
      `npm start`; the phone needs the laptop's address, for example `http://192.168.1.20:3000`.)
- [ ] Fresh demo data: **Administration → System & demo controls → Reset** as
      `admin@demo.karyavahi.test`, or `npm run db:init -- --force` before starting the server.
- [ ] Sign the right account in on the device (accounts below). No passwords — every account is
      fictional.
- [ ] Set the language the person prefers (**हिंदी / English** in the account menu).
- [ ] Printed: the consent script, the task cards for their role, the questionnaire.
- [ ] Note-taker has `session-sheet.csv` open (or printed) and a stopwatch.
- [ ] For the headmaster offline task: know how to turn on **Airplane mode** on their phone.

| Role | Account to sign in with | Lands on |
| --- | --- | --- |
| Block officer (BEO) | `beo.blk-01@demo.karyavahi.test` | Overview |
| District officer (for the approval task) | `deo.rmp@demo.karyavahi.test` | Overview |
| Cluster coordinator (CRC) | `crc.clu-001@demo.karyavahi.test` | My day |
| Block coordinator (BRC) | `brc1.blk-01@demo.karyavahi.test` | My day |
| Headmaster | `hm.sch-01893@demo.karyavahi.test` | My day |

---

## 4. Consent script — read it out loud

Do not start until the person says yes. If they say no to recording, take written notes only.

**हिन्दी**

> नमस्ते, समय देने के लिए धन्यवाद। हम "कार्यवाही" नाम का एक ऐप बना रहे हैं, जो स्कूलों में सीखने की
> समस्याओं को पहचानने और उन पर काम करने में मदद करता है। आज हम ऐप की जाँच कर रहे हैं, आपकी नहीं —
> कोई गलत उत्तर नहीं होता। अगर कुछ समझ न आए, तो वह ऐप की कमी है।
>
> लगभग 25 मिनट लगेंगे। मैं आपको कुछ काम दूँगा/दूँगी, और आप करते हुए जो सोच रहे हैं वह ज़ोर से बोलें।
> ऐप में सारा डेटा काल्पनिक है — कोई असली स्कूल या व्यक्ति नहीं।
>
> हम आपका नाम, फ़ोन नंबर या कोई निजी जानकारी नहीं लिखेंगे। नोट्स में आपको केवल एक कोड से लिखा
> जाएगा, जैसे P03। आप जो कहेंगे, उसे हम अपने शब्दों में लिख सकते हैं ताकि ऐप सुधारा जा सके, लेकिन
> आपका नाम कहीं नहीं आएगा।
>
> क्या हम स्क्रीन या आवाज़ रिकॉर्ड कर सकते हैं? यह केवल हमारी टीम देखेगी और परीक्षण के बाद मिटा दी
> जाएगी। "नहीं" कहना बिल्कुल ठीक है।
>
> आप कभी भी रुक सकते हैं या कोई काम छोड़ सकते हैं, बिना कोई कारण बताए।
>
> क्या आप शुरू करने के लिए तैयार हैं?

**English**

> Hello, and thank you for your time. We are building an app called Karyavahi that helps find
> learning problems in schools and act on them. Today we are testing the app, not you — there
> are no wrong answers. If something is confusing, that is the app's fault.
>
> It takes about 25 minutes. I will give you a few tasks; please say out loud what you are
> thinking as you do them. All the data in the app is made up — no real schools or people.
>
> We will not write down your name, phone number or anything personal. In our notes you are
> only a code, like P03. We may write down what you say in our own words to improve the app,
> but your name will never appear.
>
> May we record the screen or your voice? Only our team will see it, and it is deleted after
> the testing. Saying "no" is completely fine.
>
> You can stop, or skip any task, at any time without giving a reason.
>
> Are you happy to start?

Note-taker writes in the sheet: `consent = yes`, and `recording = yes / no`.

---

## 5. Session flow (20–30 minutes)

| Time | What happens |
| --- | --- |
| 0–3 min | Consent (above). Two warm-up questions: *What does a normal week look like for you? How do you hear about a school that is falling behind?* |
| 3–5 min | Explain think-aloud: "Please talk while you work — what you are looking for, what you expect to happen, what surprises you." Show them once on a different app if needed. |
| 5–22 min | The tasks for their role (below). One task card at a time. Do not help unless they are stuck for 2 minutes or ask to stop — then note it as an **assist**. |
| 22–26 min | Questionnaire (section 8), read out if they prefer. |
| 26–30 min | Wrap-up questions (section 7) and thanks. Ask them to tap **सुझाव दें / Feedback** at the top and leave one thought in their own words. |

**Rules for the facilitator**

- Read the task card exactly. Do not name the button ("press Approve"); describe the goal.
- If they ask "what should I do?", answer: "What would you try if I were not here?"
- If they are stuck for **2 minutes**, give the smallest possible hint and mark `assist` in the
  sheet. If still stuck after **4 minutes**, mark the task `fail` and move on.
- Never say "that's wrong". Say "OK, thank you — let's go to the next one."

---

## 6. Tasks by role

Each task has an id. The note-taker writes one row per task in `session-sheet.csv`.
"Success" means they reached the end state **without** an assist.

### Block / district officer (laptop, then phone if time)

| Id | Task card (read this out) | Done when | Watch for |
| --- | --- | --- | --- |
| **BEO-1** | "This morning you want to see the most serious learning problem in your block. Find it and open it." | The case page for the top critical case (CASE-0184) is open. | Do they use the Overview list, the map, or search? Do they understand "critical"? |
| **BEO-2** | "Ask Claude to explain this problem to you in simple words. Do you believe what it says? Tell Claude whether it was useful." | A Claude draft ("Explain this finding / यह निष्कर्ष समझाएँ") is showing and they pressed 👍 or 👎. | Do they find the button? Do they read the figures or skip them? Do they check the source chips? Is the Hindi natural? If they press 👎, which reasons? |
| **BEO-3** | "Ask Claude one question of your own about this case." | An answer appears in the Claude panel. | What they ask. Whether the answer is on topic. Whether they notice "verify before acting". |
| **BEO-4** | *(sign in as `deo.rmp@demo.karyavahi.test` first — the officer who wrote a plan cannot approve it)* "A plan for this case is waiting for your decision. Look at it and approve it if you agree." | Plan on CASE-0184 approved. | Do they find the decision box? Do they understand what is locked by approving ("comparison schools", "success threshold")? Do they hesitate? |
| **BEO-5** *(optional)* | "On your phone, find out which tasks in your block are late." | Execution → Overdue list is open. | Can they navigate with the bottom dock and the search box? |

### Cluster / block coordinator (their phone)

| Id | Task card | Done when | Watch for |
| --- | --- | --- | --- |
| **CRC-1** | "You have just opened the app at the start of your day. What do you need to do today? Tell me in your own words." | They can name their most urgent task. | Do they understand the order on My day (sent back, late, today)? |
| **CRC-2** | "A headmaster has sent proof that a task was done. Check it and decide whether to accept it." | A proof is accepted or sent back with a reason. | Do they look at the photo and the GPS line? Do they understand "spot check"? |
| **CRC-3** | "One of your tasks cannot be done because the teacher has been moved. Tell the block office about this problem." | A blocker is recorded on a task ("Report a blocker… / बाधा दर्ज करें…"). | Where they look first (task page, complaints, notifications). Words they use for "blocker". |
| **CRC-4** | "Ask Claude which school in your cluster you should visit first, and why." | A Claude answer is showing; they rated it 👍 / 👎. | Do they trust it? Too long? Language? |

### Headmaster or teacher (their phone, Hindi unless they ask otherwise)

| Id | Task card | Done when | Watch for |
| --- | --- | --- | --- |
| **HM-1** | "आज आपको क्या करना है? ऐप से पता कीजिए — अगर ऐप पढ़कर सुना सकता है, तो सुनिए।" *("What do you have to do today? Find out from the app — if it can read it out to you, listen to it.")* | They can say today's task in their own words. If the build has a **सुनें / Listen** button, they used it. | Is the first screen clear? Font size? Do they scroll? Do they find Listen? |
| **HM-2** | "आपने यह काम कर लिया है। फ़ोटो के साथ सबूत जमा कीजिए।" *("You have done this task. Hand in proof with a photo.")* | Proof with a photo is handed in ("सबूत जमा करें"). | Camera vs gallery. Location permission prompt — do they allow it? Do they understand the GPS line afterwards? |
| **HM-3** | *(Facilitator turns on Airplane mode first.)* "अब नेटवर्क नहीं है। फिर भी एक और काम का सबूत जमा कीजिए।" *("Now there is no signal. Hand in proof for another task anyway.")* Then turn Airplane mode off. | The proof shows **भेजने की प्रतीक्षा में / Waiting to send**, then sends by itself when the signal returns. | Do they believe it was saved? Do they try again (duplicate)? Do they notice when it is sent? |
| **HM-4** | "ऐप के बारे में अपनी एक बात हमें ऐप से ही बताइए।" *("Tell us one thing about the app, using the app itself.")* | The Feedback / सुझाव दें form is sent. | Do they find the speech-bubble button? Are the 1–5 choices (बहुत कठिन … बहुत आसान) clear? |

---

## 7. What to observe, and think-aloud prompts

**The note-taker watches for**

- **Hesitation** — more than ~5 seconds without doing anything. Note what is on screen.
- **Wrong turns** — tapping something that is not on the path. Note what they tapped.
- **Words** — any word they read out wrongly, ask about, or translate. These are labelling bugs.
- **Trust** — anything they say about believing or doubting a figure or Claude's draft.
- **Touch** — mis-taps, zooming in, holding the phone far away (text too small).
- **Quotes** — the exact words, in the language they said them. Short. These are gold.

**Prompts the facilitator may use (neutral, never leading)**

| हिन्दी | English |
| --- | --- |
| अभी आप क्या सोच रहे हैं? | What are you thinking right now? |
| आप क्या ढूँढ रहे हैं? | What are you looking for? |
| आपको क्या लगा, यह दबाने से क्या होगा? | What did you expect to happen when you pressed that? |
| यह शब्द आपके लिए क्या मतलब रखता है? | What does this word mean to you? |
| क्या आप इस आँकड़े पर भरोसा करेंगे? क्यों? | Would you trust this figure? Why? |
| अगर मैं यहाँ न होता/होती, तो आप क्या करते? | If I were not here, what would you do? |

**Wrap-up questions (2–4 minutes)**

1. सबसे आसान क्या लगा? सबसे कठिन? / What was easiest? Hardest?
2. क्या आप यह हर हफ़्ते इस्तेमाल करेंगे? किस काम के लिए? / Would you use this every week? For what?
3. Claude के मसौदे पर आप कितना भरोसा करेंगे? / How much would you trust Claude's drafts?
4. अगर एक चीज़ बदल सकें, तो क्या बदलेंगे? / If you could change one thing, what would it be?

---

## 8. Post-task questionnaire (SUS-style, Hindi + English)

Read each statement. The person answers **1 = बिल्कुल असहमत / strongly disagree** to
**5 = पूरी तरह सहमत / strongly agree**. Write the numbers in the `sus_*` columns of the session
sheet (on the participant's first row is enough).

| # | हिन्दी | English |
| --- | --- | --- |
| Q1 | मैं यह ऐप अपने काम में बार-बार इस्तेमाल करना चाहूँगा/चाहूँगी। | I would like to use this app often in my work. |
| Q2 | यह ऐप ज़रूरत से ज़्यादा उलझा हुआ है। | The app is more complicated than it needs to be. |
| Q3 | यह ऐप इस्तेमाल करना आसान था। | The app was easy to use. |
| Q4 | इसे इस्तेमाल करने के लिए मुझे किसी की मदद चाहिए होगी। | I would need someone's help to use this app. |
| Q5 | ऐप के अलग-अलग हिस्से अच्छी तरह साथ काम करते हैं। | The different parts of the app work well together. |
| Q6 | ऐप में बहुत सी बातें एक-दूसरे से मेल नहीं खातीं। | Too many things in the app are inconsistent. |
| Q7 | ज़्यादातर लोग यह ऐप जल्दी सीख लेंगे। | Most people would learn this app quickly. |
| Q8 | ऐप इस्तेमाल करना भारी/थकाने वाला लगा। | The app felt awkward or tiring to use. |
| Q9 | ऐप इस्तेमाल करते समय मुझे भरोसा था कि मैं सही कर रहा/रही हूँ। | I felt confident using the app. |
| Q10 | शुरू करने से पहले मुझे बहुत कुछ सीखना पड़ा। | I had to learn a lot before I could get going. |

**Two extra questions for Claude (same 1–5 scale)**

| # | हिन्दी | English |
| --- | --- | --- |
| C1 | Claude ने जो लिखा, वह मेरी भाषा में साफ़ और समझने लायक था। | What Claude wrote was clear and in language I understand. |
| C2 | मैं Claude के मसौदे को जाँचकर अपने काम में इस्तेमाल करूँगा/करूँगी। | I would check Claude's draft and then use it in my work. |

**Scoring the 10 SUS items** (see `analysis.md`): odd items score `answer − 1`, even items score
`5 − answer`; add them up and multiply by 2.5 → a score from 0 to 100. Around 68 is average;
below 50 means serious problems. With 8–11 people, report the median and the range, not a
precise average.

---

## 9. After each session (5 minutes)

- Note-taker completes every row in `session-sheet.csv`, including `severity` (see
  `analysis.md`) while it is fresh.
- Facilitator adds the two or three biggest surprises in the `notes` column of the last row.
- If recorded, store the file with the participant code only, never a name, and delete it once
  the round is analysed.
- Do **not** reset the demo between sessions if you want to look at that person's in-app
  feedback later — export it first from `/admin/feedback` (**Export CSV**).
