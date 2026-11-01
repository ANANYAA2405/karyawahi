# From sessions and feedback to changes

How to turn what you saw in sessions (`session-sheet.csv`) and what people said in the app
(`/admin/feedback`) into a short, ranked list of fixes — and then show those fixes in the app on
`/changes`.

Do this after every round (for example after 4–5 sessions), not only at the end.

---

## 1. The session sheet, column by column

| Column | What to write |
| --- | --- |
| `session_date` | `2026-11-05` |
| `participant` | Code only: `P01`, `P02`, … Never a name. |
| `participant_type` | `real` (actually does this job) or `stand-in` |
| `role` | `beo`, `deo`, `crc`, `brc`, `headmaster`, `teacher` — the role they were testing as |
| `device` | `laptop`, `Android phone (own)`, `Android phone (ours)`, `iPhone (own)` … |
| `language` | `hi` or `en` — the app language they used |
| `consent` / `recording` | `yes` / `no` |
| `task` | The task id from `protocol.md`: `BEO-1`, `CRC-3`, `HM-2` … |
| `result` | `success` (no help), `assist` (finished after a hint), `fail` (gave up or 4 minutes), `skipped` |
| `time_s` | Seconds from reading the card to the end state |
| `errors` | How many wrong turns (taps that were not on the path) |
| `assists` | How many hints you gave |
| `quote` | Their exact words, in their language, in quotes. Short. |
| `observation` | What you saw, in one sentence. Facts, not opinions. |
| `severity` | 0–4, see below |
| `feedback_ids` | If they also used 👍/👎 or the Feedback form, the ids from `/admin/feedback` (`FBK-000012`), space-separated |
| `sus_q1` … `sus_q10` | The questionnaire answers, 1–5 (first row of that participant only) |
| `claude_c1`, `claude_c2` | The two Claude questions, 1–5 |
| `notes` | Anything else |

Keep one shared copy. Open it in Excel, Google Sheets or LibreOffice; it is a plain CSV. Delete
the `EXAMPLE-DELETE-ME` row before the first real session.

---

## 2. Give every problem a severity (0–4)

| Severity | Meaning | Example |
| --- | --- | --- |
| **4 — Blocker** | They could not finish the task, or did something harmful without noticing (approved the wrong plan, sent proof to the wrong task, trusted a wrong figure). | Headmaster could not find how to hand in proof. |
| **3 — Major** | They finished only with help, or after a long struggle, or made an error they had to undo. | CRC needed a hint to find "Report a blocker". |
| **2 — Minor** | They hesitated or took a wrong turn, but recovered alone. | Officer scrolled past the Claude button once. |
| **1 — Cosmetic** | A word, colour or layout they commented on, with no effect on the task. | "This Hindi word sounds like a court order." |
| **0 — Not a problem** | Mentioned, but on reflection fine. | |

When the same problem happens to several people, use the **highest** severity anyone hit.

---

## 3. Put sessions and in-app feedback together

1. Sign in as `state.lead@demo.karyavahi.test` (or `admin@demo.karyavahi.test`), open
   **Administration → User feedback** (`/admin/feedback`).
2. Look at the **By page** table (low ease, many 👎), the **Top reasons** list, and filter
   **Negative (👎 or 1–2)**. Then **Export CSV** — it downloads every response with the same
   filters, Hindi intact.
3. The AI log (`/ai-log`) shows the 👍/👎 next to each Claude answer, so you can read the exact
   answer people disliked.
4. Make one new sheet called **Problems** with these columns:

   `problem_id, what goes wrong (one sentence), tasks/pages, roles, people affected (count), severity (max), evidence (session rows + FBK ids), fix idea, effort (S/M/L), status`

5. Go through the session sheet row by row. Every row with severity ≥ 1 either becomes a new
   problem or is added to an existing one (people affected +1, evidence += `P03 HM-2`).
6. Do the same with each negative in-app feedback response (evidence += `FBK-000012`).

---

## 4. Decide what to fix first

Score each problem: **priority = severity × people affected**. Then sort.

Fix in this order:

1. Every **severity 4** — no matter how many people. One person who approved the wrong plan is
   enough.
2. **Severity 3** problems that hit **two or more** people.
3. Problems on the **headmaster phone flow** (My day, proof, offline) before officer screens —
   there are many more headmasters than officers, and they have the least time and signal.
4. Claude problems tagged **wrong figure** before **too long** or **unclear** — a wrong figure
   breaks trust in everything else.
5. Cheap fixes (effort S) to wording and labels — do them in a batch.

Ignore anything only one person mentioned at severity 1, unless it is a Hindi wording problem
(those are cheap and matter a lot to field staff).

Write down what you decided **not** to fix and why — judges and reviewers will ask.

---

## 5. Record each change in the app

Every fix that came from user input gets an entry in **`app/data/changes.json`**. It shows on
`/changes` for every signed-in user, newest first. The file is read on every request, so a
running server shows the new entry on the next page load.

```json
{
  "id": "CHG-001",
  "date": "2026-11-08",
  "said": "Headmasters could not find where to hand in proof; two looked for it under the photo.",
  "said_hi": "प्रधानाध्यापकों को सबूत जमा करने का स्थान नहीं मिला; दो ने उसे फ़ोटो के नीचे ढूँढा।",
  "who": "3 of 4 headmasters (2 real, 1 stand-in), on their own phones",
  "who_hi": "4 में से 3 प्रधानाध्यापक (2 वास्तविक, 1 प्रतिनिधि), अपने फ़ोन पर",
  "roles": ["headmaster"],
  "changed": "The Hand in proof button is now the first, full-width button on each task in My day.",
  "changed_hi": "सबूत जमा करें बटन अब My day में हर कार्य पर सबसे पहला, पूरी चौड़ाई का बटन है।",
  "link": "/today",
  "feedback_ids": ["FBK-000012", "FBK-000015"],
  "session_refs": ["P05-HM-2", "P07-HM-2", "P08-HM-2"]
}
```

*(This is a made-up example of the format only. Do not copy it into the file.)*

| Field | Rule |
| --- | --- |
| `id` | `CHG-001`, `CHG-002`, … in order |
| `date` | The day the change was made, `YYYY-MM-DD` |
| `said` / `said_hi` | What users said or did, **paraphrased**. No names. Hindi is optional but strongly preferred (field staff read this page). |
| `who` / `who_hi` | Roles and counts, and say **stand-in** when that is what they were. Never a name, school or phone number. |
| `roles` | Any of `beo`, `brc`, `crc`, `headmaster`, `deo`, `state_admin`, `auditor` (shown as labels) |
| `changed` / `changed_hi` | What is different now, in plain words |
| `link` | A page on this site (`/today`, `/cases`) or `null`. Links to other sites are dropped. |
| `feedback_ids` | In-app feedback behind it (`FBK-` + 6 digits). Reviewers see them as links; other users see only how many. |
| `session_refs` | `participant-task` codes from the session sheet |

**When the first real entry goes in, delete the placeholder entry** (`"placeholder": true`,
id `CHG-000`). Until then the page honestly says that no testing has happened yet.

Check the file is valid before committing:

```bash
cd app
node -e "JSON.parse(require('fs').readFileSync('data/changes.json','utf8')); console.log('ok')"
```

An entry with a missing date, `said` or `changed` is skipped (the page still loads).

**Never** add an entry for a change that did not come from a user, and never write feedback
nobody gave. If a change came from your own review rather than from users, it does not belong
on this page.

Note: a demo reset (Administration → System & demo controls, or `npm run db:init -- --force`)
empties the feedback table. Export the CSV from `/admin/feedback` before you reset, and keep it
with the session sheet, so the `FBK-` ids in `changes.json` can still be traced.

---

## 6. Score the questionnaire

For each person, from `sus_q1` … `sus_q10`:

```
odd items  (Q1, Q3, Q5, Q7, Q9):  answer − 1
even items (Q2, Q4, Q6, Q8, Q10): 5 − answer
SUS score = (sum of the ten) × 2.5         → 0 to 100
```

In a spreadsheet, for a row with the answers in columns R to AA:

```
=((R2-1)+(5-S2)+(T2-1)+(5-U2)+(V2-1)+(5-W2)+(X2-1)+(5-Y2)+(Z2-1)+(5-AA2))*2.5
```

Report **per role**: the median SUS, the lowest and highest, and how many people. Around 68 is
average for software; under 50 means people struggle. Compare rounds: if a round-2 median is
clearly higher after your fixes, say so — with the numbers and the number of people, and without
claiming more than a handful of sessions can show.

`claude_c1` (clear, my language) and `claude_c2` (I would use it after checking) are reported the
same way: median and range per role.

---

## 7. What to show at the end

1. The **Problems** sheet sorted by priority, with what you fixed and what you did not.
2. `/changes` in the app — each entry traceable to session rows and feedback ids.
3. `/admin/feedback` — the counts before and after (export the CSV at the end of each round and
   keep it with the session sheet).
4. SUS and Claude scores per role per round.
5. Two or three short quotes (participant code + role only), in the language they were said.
