# User testing kit — Karyavahi

Everything you need to sit with real users (or stand-ins), watch them use Karyavahi, and turn
what you see into changes that are shown in the app.

| File | What it is | When you use it |
| --- | --- | --- |
| [protocol.md](protocol.md) | Who to recruit, the consent script (Hindi + English), a 20–30 minute session per role with the exact tasks, what to watch for, and the questionnaire | Before and during each session |
| [session-sheet.csv](session-sheet.csv) | One row per task attempt: who, device, task, did it work, how long, errors, a quote, how bad | During each session (one note-taker fills it in) |
| [analysis.md](analysis.md) | How to rank problems, decide what to fix first, and record each change in `app/data/changes.json` | After each round of sessions |

## The loop in one picture

```
recruit 9–11 people ─► run sessions (protocol.md) ─► fill session-sheet.csv
                                                        │
          in-app feedback (/admin/feedback, CSV) ───────┤
                                                        ▼
                          rank problems (analysis.md) ─► fix the worst first
                                                        │
                                                        ▼
            add an entry to app/data/changes.json ─► shows on /changes in the app
                                                        │
                                                        ▼
                         test again with new people ◄───┘
```

## What is already in the app

- **Thumbs on Claude.** Under every Claude draft (the "Explain this finding" style buttons on a
  case) and every Claude chat answer: 👍 / 👎. A 👎 asks for quick reasons — *wrong figure,
  unclear, not useful, too long, language problem* — and an optional comment.
- **Feedback / सुझाव दें.** A speech-bubble button in the top bar of every signed-in page opens
  three questions: how easy was this (1–5), what were you trying to do, what got in the way.
- **Review page** `/admin/feedback` — for the state programme team and the demo administrator
  (`state.lead@demo.karyavahi.test`, `admin@demo.karyavahi.test`): counts, ratings by page, top
  reasons, every response with filters, and **Export CSV**. The AI log (`/ai-log`) shows the
  thumbs next to each Claude answer for the same people.
- **What we changed after testing** `/changes` — every signed-in user can read it. It reads
  `app/data/changes.json`. Until sessions have happened it says so honestly.

## Two rules that matter most

1. **Never invent feedback.** `/changes` must only list things real participants (or clearly
   labelled stand-ins) said. Judges will ask to see the session sheets behind each entry.
2. **No personal data.** Use participant codes (P01, P02 …), never names or phone numbers. Do not
   record audio or video unless the person agreed out loud (see the consent script).
