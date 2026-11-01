# Karyavahi — roadmap

From a working demo to a district pilot, then the state. Each item says whether it is **built**,
**designed**, or **needs a partner or account**. The same plan is in the app at `/roadmap`
(English and Hindi).

## Where it stands (Nov 2026)

- The full case loop works end to end: flag → diagnose → recommend → approve → assign → track →
  verify → report, with maker-checker approvals and a hash-chained audit trail.
- Three Uttar Pradesh districts (Rampur, Lucknow, Varanasi) with real UDISE+ schools, names
  withheld; learning results simulated and calibrated to PRS 2024; intervention costs from the UP
  PAB 2025-26 minutes. Sources and terms: `/sources`.
- Claude (Opus 5.5) drafts, explains and answers through scoped, read-only tools; code computes
  every figure and an auditor pass checks each number Claude writes; a person makes every decision.
- Field staff: Hindi-first, installable, works offline, GPS-checked proof; reminders and
  escalation run on a schedule; messages for WhatsApp, voice and SMS are written and queued.
- A read-only, key-scoped API for state dashboards.

## The path

| When | Phase | What happens |
| --- | --- | --- |
| Now | Demo | As above. |
| Months 1–3 | Pilot in one district | MoU with the state for one district (≈1 DEO, 6–8 BEOs, ~100 CRC/BRCs, ~1,500 headmasters). Official UDISE+ 2024-25 data and the state's assessment exports through the import wizard already built. WhatsApp (Glific / Meta Cloud API) and a Hindi voice call (Exotel) switched on. User testing every two weeks with the kit in `docs/user-testing/`. |
| Months 4–9 | Prove it works | Two assessment rounds pass, so the pre-registered outcome checks run on real plans. An independent evaluation partner reviews the ledger and the method. The evidence library learns from the district's own closed cases. |
| Months 10–24 | Scale | State-wide in Uttar Pradesh (75 districts), feeding the state VSK through the API. Other states through the same CSV shapes (cQube) and the same ledger. PAB-level findings packaged each year as dated proposals. |

## Integration into existing systems

| System | How Karyavahi connects | Status |
| --- | --- | --- |
| UDISE+ | School master importer (India Data Portal mirror); official 2024-25 microdata needs the state's login | Built |
| State assessments (NIPUN, PRS-style rounds) | Round import with row-level checks, then a live detection run | Built |
| State VSK dashboards | Read-only API v1: area-scoped keys, rate limits, OpenAPI description | Built |
| PAB / PRABANDH | Lever tag on every case; PAB unit costs on cards; yearly proposal export designed | Built / designed |
| cQube | Adopt its CSV shapes for imports | Designed |
| ShikshaLokam ELEVATE | Reuse its project service for task delivery where a state already runs it | Needs partner |
| WhatsApp (Glific / Meta Cloud API) | Tasks out, photo proof back; messages written and queued | Needs Meta verification and template approval |
| Voice call and SMS (Exotel) | Hindi voice scripts with keypad replies written | Needs Exotel account and TRAI DLT registration |

## Technical path

- **Database:** SQLite today; Postgres with row-level security for the pilot. Tables already follow
  the Postgres schema (`sql/schema.sql`), and every read is scoped the way the policies would be.
- **Claude:** structured outputs, tool use over scoped reads, refusal fallback, auditor pass on every
  figure. Before go-live: an evaluation set built from real pilot cases, tracked release to release.
- **Search:** ranked full-text search over the evidence library today; vector search (pgvector) once
  the library and closed-case history grow past a few hundred entries.
- **Field app:** installable web app, offline, GPS-checked proof; a native Android app only if the
  pilot shows the web app is not enough.
- **Hosting:** a state data centre or empanelled government cloud, so data stays in India. No
  student-level records by design (DPDP Act 2023).
- **Running cost of Claude:** a draft reads ~5,000 tokens and writes ~2,000; at Opus 5.5 list prices
  ($4 / $20 per million tokens) that is ≈ $0.06 (≈ ₹5) per draft, ≈ ₹200 a month for an officer
  asking for 40 drafts. Drafts are cached; reopening a page costs nothing.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| No access to school-level results | Pilot only under a state MoU; until then real schools with simulated results, labelled on every page |
| WhatsApp template and DLT approvals are slow | Paperwork starts in month 1; the web app and offline My day work without them |
| Gaming (dropping weak schools from the next round) | Participation floor in every outcome check; comparison schools locked at approval; closure only on independent proof |
| Field staff see it as surveillance | No teacher app, no student records, location only when proof is handed in, each person on their own channel |
| The AI states something wrong | Claude never computes figures; the auditor checks every number; it cannot approve, assign or close; every draft is labelled |

## How the pilot is judged

- Flagged cases with an approved plan within 14 days
- Tasks closed with proof checked by someone other than the doer
- Cases with an outcome check at the next assessment round
- Learning gain in plan schools over comparison schools (the pre-registered test)
- Hours to prepare the monthly review pack and Action Taken Report
- Officers and field staff active each week, and their feedback ratings
