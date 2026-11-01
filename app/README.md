# Karyavahi — the application

**DEMO MODE — NOT ACTUAL GOVERNMENT STATISTICS.** Schools, enrolment, teachers and locations are
real (UDISE+ via India Data Portal, about 2020-21; names and codes withheld). Learning results are
simulated and calibrated to PRS 2024; intervention costs are from the UP PAB 2025-26 minutes where
a line exists. People, cases, plans, proof and outcomes are fictional. Nothing is connected to a live
UDISE+, NAS, a state VSK, WhatsApp or IVR. Every source and its terms: `/sources` and
[Real public data](#real-public-data-real-schools-calibrated-results-pab-costs) below.

This is the Next.js app that sits on top of the seed in the parent directory. The seed supplies
the data, the domain rules and the Postgres schema; this app is the interface an officer
actually works in.

## Run it

```bash
npm install
npm run db:build     # loads ../out/csv into a local SQLite copy (~6 s, 295,005 rows)
npm run dev          # http://localhost:3000
```

Then sign in as `beo.blk-01@demo.karyavahi.test` — no password; every account is fictional.

```bash
npm run verify       # typecheck, read-layer scoping, write-layer rules, the audit chain, sessions
npm run verify:full  # the above, plus a build, a crawl of every route, and the UI walkthrough
```

## The redesign (v2) — what was added

The product is organised into eight sections, each a real, data-backed workspace:

| Section | Route | What it does |
|---|---|---|
| Overview | `/overview` | "What needs my attention today": KPIs that link to filtered views, ranked priority actions, hotspot preview, trends, AI briefing, readable activity feed. Demo controls moved out. |
| Learning hotspots | `/hotspots` | Schematic tile map (no coordinates exist in the seed — labelled as such) with district → block → cluster → school drill-down, class/subject/competency/round filters, map/list toggle, detail panel. Severity in `src/lib/hotspots.ts` uses the detector's method (change vs district + two-proportion z, sample-size gate, "insufficient data" never shown as stable). |
| Cases & action plans | `/cases`, `/cases/[id]` | Tabbed ledger (open, critical, pending approval, overdue, awaiting verification, reopened, closed). The case page is a workspace: lifecycle stepper, section nav, next legal moves, rule-based intervention options, similar past cases, blockers. |
| Intervention studio | `/interventions`, `/interventions/compare`, `/interventions/[id]` | Case-ranked matching with every point explained (`src/lib/studio.ts`), side-by-side comparison with no composite score, what-if delivery-feasibility planner (budget, staff, weeks, attendance, training, connectivity) that never predicts an outcome. |
| Field execution | `/execution` | Overdue, due-soon, awaiting proof check, blockers (structured, escalate/resolve, audited), workload by officer with plain flags. Blockers are reported from any task page. |
| Impact & reports | `/impact`, `/reports`, `/reports/new` | Outcome verification workspace (DiD with interval, participation, delivery, closure eligibility). Report builder with 8 report types built from the ledger, preview, saved snapshots, Excel (.xlsx), CSV and print/save-as-PDF exports. |
| Karyavahi AI | `/assistant` + drawer on every page | Live Claude model through controlled, scope-checked tools (`src/lib/ai/tools.ts`), streaming, citations, flagged unretrieved ids, follow-ups, page context. The original computed "instant answers" remain alongside. |
| Administration | `/admin` | Hub for audit, imports, AI activity, roles & permissions, settings, jobs, outbox and `/admin/demo` (clock, sweep, reset). |

Also: public landing page (`/`), email sign-in (`/login`, honestly passwordless), demo personas (`/demo`), global scoped search (`/search`).

### v3 — geography, hierarchy, grievances, onboarding

| Area | Where | Notes |
|---|---|---|
| Interactive map | `src/components/GeoMap.tsx`, `src/lib/geo.ts`, `/api/geo/map` | MapLibre GL JS, **no third-party tiles** (no keys, works offline). Seven layers: learning gaps, critical cases, open complaints, overdue actions, intervention delivery, verified improvement, insufficient data (hatched on every layer). Labels carry the value as text. Opens at the user's own scope; drill-down, breadcrumbs, back, search, Blocks/Cities hierarchy toggle, reset view. |
| Geography model | `src/lib/ext/schema.ts`, `src/lib/ext/geogen.ts` | `geo_units`, `geo_relationships`, `geo_hierarchies`, `geo_levels`. Two hierarchies (administrative; urban, where a city ≠ a district). All shapes are **illustrative** — the state is fictional — generated as nested hex-grid partitions at 0°,0°. India's outline is deliberately not drawn (open datasets show borders that differ from India's official map). Load a licensed GeoJSON with `geometry_source='verified'` to replace them. |
| Central permissions | `src/lib/authz.ts` | `authorize(session, permission, resource)` checks account status → role grant (built on the domain matrix) → geographic scope → ownership → organisational seniority → confidentiality. |
| Hierarchy | `src/lib/org.ts`, `/admin/hierarchy` | `reporting_lines` (designated authority, derived from the seed), `delegations` (time-boxed acting charge, applied in the session and lapsing automatically), audited manager/scope/status changes. |
| Complaints | `src/lib/complaints.ts`, `/complaints` | Separate from cases (linkable). Routed to the reporter's designated authority unless a category/priority policy says otherwise; conflict-of-interest routing around an accused officer; 14-state workflow with actor checks; SLA escalation sweep (idempotent) and manual escalation with reason; restricted complaints visible only to the route and the state auditor. |
| Onboarding | `src/lib/onboarding.ts`, `/register`, `/admin/accounts` | Request → email code (shown on screen in demo) → simulated affiliation check → designated verifier approves/rejects/asks/reassigns. No self-approval, no approving equal or senior roles, duplicate detection, change requests, suspension/reactivation with history. |
| Tests | `scripts/security-test.mts` | 73 checks: scope at every level, delegation and its lapse, map scope and probing, routing, workflow, SLA, confidentiality, onboarding, suspension, self-protection — on a scratch copy of the seed. |

All new tables are created by the app beside the seed's (never altering seed tables) and re-created automatically after a demo reset.

### v4 — round import with a live detection run, and case discussion threads

| Area | Where | Notes |
|---|---|---|
| Round import | `/import`, `src/components/RoundImport.tsx`, `src/lib/write-import.ts`, `src/lib/import-csv.ts` | Upload a CSV of `assessment_results` rows → **Check the file** (preview; nothing saved) → **Commit** → detection runs. Rows are refused with the seed's own codes (`missing_required`, `non_numeric`, `unknown_school_id`, `invalid_date`, `proficient_exceeds_assessed`, `duplicate_row`) and stored with the batch. Only roles holding `data.import` (BEO, DEO, state team, demo admin) may import; refusals are audited as `import.refused`. Each officer can import only schools in their own area — a BEO their block, a DEO their district. |
| Same file twice | `import_file_hashes` (ext table) | The file's sha256 (ignoring BOM and line endings) is remembered per round and area. A second commit of the same file adds nothing and is audited as `import.duplicate_ignored`; a different file with rows already on record has those rows refused as `duplicate_row`. |
| Live detection run | `runDetection()` in `src/lib/write-import.ts` | `src/domain/detect.ts` on the previous round against the new one, with the settings version in force on the demo date (`setting_versions`), exactly as the seed does. New hotspots become findings and **cases owned by the block's BEO**, scoped to the cluster, with a rule-based diagnosis (the seed's teacher-transfer / visit-gap / attendance / PTR rules) and a notification. A flagged drop where a case is already open is monitored on that case instead. Re-running adds only what is new. Until every block has reported, the "district change" is the change across the schools that have reported so far. |
| The demo clock | `roundIsOpen()` | A round can be imported once its assessment **window has opened** on the demo clock (results arrive school by school), and rows dated after "today" are refused as `invalid_date`. R4 opens 16 Nov 2026 and the seed's clock is 24 Oct, so the demo admin moves the clock to 20 Nov first — there is a button for it on `/import`. |
| R4 sample generator | `scripts/gen-r4.mts`, `samples/` | `npm run gen:r4` writes a realistic R4 CSV from the R3 rows: same cohorts, a small midline gain, binomial sampling, a treatment effect for schools whose plan is judged on R4, and a few planted cluster drops so detection has something to find. `-- --errors` adds one row of each mistake; `-- --scope DST-01` or `-- --scope all` for bigger files. `samples/R4_midline_BLK-01_with_errors.csv` and `samples/R4_midline_BLK-01.csv` are committed. |
| Case threads | `/cases/[id]` → **Discussion**, `src/components/CaseThread.tsx`, `CaseThreadComposer.tsx`, `src/lib/threads.ts`, `src/lib/write-threads.ts` | Post and edit your own comments (edits are version-checked; the old text stays in the audit chain). Type `@` to mention someone — the picker offers **only people who can open the case**, and the server refuses (and audits) a comment that mentions anyone else, so nobody is notified about a case they cannot see. Follow / unfollow; the case owner follows by default. Mentioned people and followers are notified; followers are re-checked against scope every time. A BEO, DEO or state officer can flag a comment as a **decision**: it also writes a `decision_recorded` case event and cannot be edited afterwards. |
| Tables | `src/lib/ext/collab-schema.ts` | `import_file_hashes`, `case_comments`, `case_comment_mentions`, `case_watchers` — created beside the seed's tables, each feature with its own version marker in `ext_meta` (`round_import_version`, `threads_version`). |
| Tests | `scripts/import-test.mts`, `scripts/threads-test.mts`, `scripts/e2e-import-threads.cjs` | `npm run test:import` (57 checks: validation, clock, roles, scope, preview writes nothing, the same file twice, detection opens the planted hotspots as cases, audit chain). `npm run test:threads` (51 checks: picker, mentions in and out of scope, followers, edits, stale edits, decisions, audit chain). Both run on a scratch copy — stop the server first. `KV_BASE=http://localhost:3000 node scripts/e2e-import-threads.cjs` drives both features in Chrome (mutates the DB; reset afterwards). |

#### Try it

1. Sign in as `admin@demo.karyavahi.test`, open **Administration → Data import**, press **Move the demo clock to 20 Nov 2026**.
2. Sign in as `beo.blk-01@demo.karyavahi.test` (switch to English from the account menu if you like), open **Data import**.
3. **Choose file** → `app/samples/R4_midline_BLK-01_with_errors.csv` → **Check the file**. The preview shows 2,340 good rows and 9 refused, grouped by reason.
4. **Commit 2,340 rows and run detection**. The result lists the batch (IMP-0042) and the new cases detection opened — CASE-0216 (Class 1 number recognition, Sonagaon cluster) and CASE-0217 (Class 2 word reading, Kusumgarh cluster).
5. Choose the same file again and check it: "Already imported", and the commit button stays off.
6. Open CASE-0216, scroll to **Discussion**. Type `@Sim` and pick Simran Shukla (the DEO), post. Tick **Record this as a decision** on a second comment — it appears in the timeline too. Use **Edit** on your first comment, and **Unfollow / Follow**.
7. Sign in as `deo.rmp@demo.karyavahi.test` → the bell / **Notifications** shows "Vikas Qureshi mentioned you on CASE-0216".
8. Reset afterwards with `npm run db:init -- --force` (server stopped) or the demo admin's reset.

### v5 — Claude at the centre

Claude is the co-pilot on every working page. It reads only what the signed-in officer may read
(the same scoped tools as the chat), cites the record ids it used, and cannot change anything: a
person makes every decision.

| Where | What Claude does | Built from |
| --- | --- | --- |
| Home (map card) | "Ask Claude about <area>…" with role-specific suggested questions | `AskClaudeInline` → the Claude drawer |
| Home (below the map) | Claude's briefing, for district and state officers (`ai.executive_briefing`) | `/api/ai/briefing` |
| ⌘K | Type a question and pick "Ask Claude" | `Command.tsx` → `askClaude()` |
| Case → Finding | **Explain this finding** | `get_case_details` |
| Case → Plan | **Suggest a plan**, with a link into the composer preset to Claude's pick (`?iv=INT-xx`) | case, ranked options, similar cases |
| Case → Outcome | **Explain the result** | `get_outcome_evaluation` |
| Case → Discussion | **Summarise the discussion** | the scoped thread |
| Case rail | Ready questions that open the drawer already asked | the chat |
| Saved report | **Write the narrative** to paste above the tables | the saved snapshot |

Drafts come from `/api/ai/copilot` (`src/lib/ai/copilot.ts`): one structured call to
`claude-opus-5-5` with adaptive thinking, the server-side refusal fallback, and a cached system
prompt. Ids the data did not contain are dropped, and a suggested intervention must be one of the
options given. Each draft is cached per user against a hash of the data it was written from:
reopening the page costs nothing, and the card says when the record has changed since. GET only
reads the last draft; POST writes one (refused from another site, rate-limited, logged to
`ai_interactions`).

**The auditor pass** (`src/lib/ai/audit-numbers.ts`). Code computes every number; Claude only
narrates. After each draft, briefing and chat answer, every figure Claude wrote (percentages, pp,
signed changes, decimals, whole numbers above ten; Hindi digits too) is looked up in the data it was
given: the draft's JSON bundle, the briefing's summary, or the tool results and conversation. A
draft with a figure the data does not hold is sent back to Claude once; anything still unsupported
is marked in the text with a warning ("check these figures"), and the card otherwise says how many
figures were checked. Small counts written alone ("3 schools", "Class 3"), ids, dates and years are
not policed. No second model is involved.

**The evidence library search** (`src/lib/evidence-search.ts`). Full-text search with BM25 ranking
(SQLite FTS5, an in-memory index rebuilt when the cards or outcome checks change) over the
intervention cards' evidence, delivery conditions, limitations and cost, and over the cases in the
reader's own area that have an outcome check. It feeds the interventions page search ("Tried before in
your area, and checked"), Claude's `search_evidence_library` tool, and "Suggest a plan". With a few
dozen cards, ranked text search is exact and explainable; vector search (pgvector) belongs with the
move to Postgres.

### AI configuration

Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` (server-side only). Model defaults to
`claude-opus-5-5` (`KARYAVAHI_AI_MODEL`), effort `medium` (`KARYAVAHI_AI_EFFORT`). Server-side refusal
fallback is on (`KARYAVAHI_AI_FALLBACKS=off` to disable). Without a key the AI panels say "not connected";
nothing pretends to be a model. Every interaction is logged to `ai_interactions` (model, tools, cited ids,
token counts, status — and only a short excerpt of the question). The model has **no write tools**: it
cannot approve, assign, verify, close or reopen.

### New tests

```bash
node scripts/e2e-v2.cjs        # 28 UI/HTTP acceptance checks on the redesigned app (system Chrome)
node scripts/e2e-v2.cjs --ai   # + live model checks: tool use, citations, out-of-scope refusal
node scripts/shots.cjs <email> <dir> /overview v:/hotspots m:/overview   # screenshots
```

The blockers table is created by the app in its SQLite copy (`src/lib/blockers.ts`) and back-filled from
reasons the seed already records (deadline changes, reassignments), each marked `derived_from_seed`.

## What it is

A case ledger. A learning drop is detected from assessment data, diagnosed against context,
planned, assigned, delivered, verified with proof, and closed **only** when the next assessment
round shows the gain the plan was built to produce. Each case page is laid out as the seven
questions an officer asks, in order:

1. **The finding** — what the two rounds show, the drop relative to the district, the z-test,
   the driver schools, and every data-quality gate with its value and threshold.
2. **What the data shows** — conditions observed in the driver schools, each traceable to the
   source rows it came from, ranked by how many schools share it, and labelled **association,
   not cause**. The AI hypothesis sits beside the officer's own conclusion, never instead of it.
3. **The plan** — the intervention, its evidence (or its explicit absence of an effect claim),
   its illustrative cost, the conditions under which it will not work, and the
   **pre-registration**: the comparison schools and success threshold locked at approval.
4. **The work** — who owes what, by when, and what proof each task must produce.
5. **The proof** — who submitted it and who checked it. Nobody verifies their own work.
6. **Did it work?** — the pre-registered difference-in-differences check with its 95% interval,
   the participation floor, and the closure blockers when it is not eligible.
7. **Timeline and audit** — every step, and every refused attempt.

## The parts

```
src/lib/
  db.ts          SQLite adapter. Column names match sql/schema.sql, so queries port to Postgres.
  scope.ts       Row-level security, ported. Every scoped read composes a predicate from here.
  session.ts     Who is signed in. Authority comes from their role rows, never from the cookie.
  guard.ts       Permission checks against src/domain/permissions.ts.
  write.ts       Every write. The TypeScript twin of the SECURITY DEFINER functions in SQL.
  actions.ts     Server actions. Thin wrappers that turn a refusal into a message on the page.
  clock.ts       The demo clock. Everything date-dependent reads this, not the wall clock.
  repo.ts        Reference data, geography, schools, trends.
  cases.ts       The case ledger: findings, diagnoses, plans, approvals, tasks, evidence, outcomes.
  plans.ts       The Plan Composer and the task generator, read side: candidate schools, the
                 pre-registration (comparison schools and threshold), the task list and owners.
  dash.ts        Dashboard rollups.
  feed.ts        Notifications, reports, the audit chain, the AI log, the outbox, imports, jobs.
  assistant.ts   Questions answered from the database, with the record ids behind each answer.
  viz.ts         Chart colour tokens (kept out of the client module — see the note in the file).

src/components/  ui · labels · charts · lists · dash · case-panels · Shell · ActionForm
src/app/         the routes, one directory per page; signed-in pages sit in the (app) group,
                 whose layout redirects to /login before anything is streamed
scripts/         build-db · smoke · write-test · crawl · e2e · restart · verify
```

Nothing is duplicated from the seed. `src/domain/*` and `src/lib/*` in the parent directory are
imported directly, so the detector, the outcome check, the lifecycle table and the permission
matrix are literally the same code the generator and the validator run.

## How authority works

Three layers, in this order, on every write:

1. **Scope** — `scope.ts` ports each RLS policy in `sql/schema.sql` to a SQL predicate. A BEO
   sees 14 cases, a CRC 2, a headmaster one school and no staff-movement rows — the same numbers
   Postgres produces, asserted in `scripts/smoke.ts`. Only the state team, the demo admin and the
   state auditor read state-wide; a district auditor reads their district. Import batches are
   shown where their area overlaps yours, and their rejected rows only for schools in your area
   (`importBatchPred`, `rejectedRowPred`); `npm run test:scope` checks these.
2. **Role** — the matrix in `src/domain/permissions.ts`. The navigation is built from it, so a
   role never sees a link to something it would be refused. Every case move also has its own
   list of roles (`TRANSITION_ROLES` in `src/domain/lifecycle.ts`; a move not listed is refused
   for everyone), and the role that holds the move must itself cover the case's area
   (`moveRefusal` in `src/lib/guard.ts`). Seeing a case — as a headmaster whose school is in it,
   a task owner or an auditor — gives no authority to move it.
3. **The rule itself** — `canTransition`, `reasonRequired`, `closureEligibility` from
   `src/domain/lifecycle.ts`, plus the specific guards: only a BEO or DEO closes a case, only
   on an eligible outcome; nobody verifies evidence they submitted; nobody approves a plan they
   submitted (they may still send it back); a block-lever plan is decided by a BEO or DEO and a
   district or PAB plan by a DEO or the state team. The reminder sweep and the demo clock are the
   demo admin's alone. `npm run test:authority` checks all of this.

## Composing a plan and assigning the work

A case being looked into, sent back or reopened gets its plan in the **Plan Composer**
(`/cases/[id]/plan`, from the case's Plan section). The officer picks an intervention from the
ranked matches (`matchForCase` in `studio.ts`, every point explained), picks the schools, and
previews what the plan will say before anything is saved:

- **How success will be judged.** The follow-up round, the threshold from the settings in force,
  and the comparison schools: for each plan school, the two closest on the baseline result (and
  more lightly on enrolment) from other clusters in the district, not already in another open
  case. This is the rule the seed used for every historical plan (`preRegistrationFor`).
- **The work it will turn into** — one task per template, per school where the template says so.

Saving (`draftPlan` in `write.ts`) recomputes all of this with the same functions, so the stored
plan is exactly the preview. Each save is a new plan row; an unsubmitted earlier draft is marked
`superseded`. The case takes the intervention's lever, which decides who approves. "Save and
submit" also submits it; someone other than the submitter approves it, and approval locks the
terms. Older plans that never had them (the seeded AI drafts) get them when submitted, or at the
latest when approved, and never again after that.

An approved plan becomes work at `/cases/[id]/assign` (`assignTasks`). Each task's owner is
suggested from who covers it: the school's headmaster, the case's cluster coordinator (or another
in the block), the block resource coordinator with the fewest open tasks, the district officer.
The officer may change owners and due dates but not drop or add tasks, and the independent
spot-check must go to someone who is not delivering the work. Every owner is notified. A case can
no longer be moved to "Work assigned" without its tasks.

A task whose owner cannot do it (leave, transfer, another duty) is moved from its own page by
the block or district officer (`reassignTask`). The new owner must cover the task's school the
same way, the independent check stays independent, and a reason is required; it is kept on the
task with the previous owner, on the case timeline and in the audit chain, and both people are
notified. Started work goes back to "assigned" for the new owner to acknowledge. A task with proof
waiting to be checked, or already verified, stays where it is. `npm run test:plan` checks all of it.

A refusal is shown, with its reason, next to the button that caused it. Illegal transitions,
moves without authority, approvals of your own plan, hand-run sweeps and self-verification
attempts are written to the audit chain as failures **before** the exception
is raised, outside the transaction, so the attempt survives the rollback.

## The audit chain

Append-only, SHA-256 hash-chained, using the same `ts-json-v1` scheme as the seed generator:
each row hashes its own fields plus the previous row's hash. "Previous" means previous in the
chain's own order, `audit_events.seq`, not by timestamp, so moving the demo clock backwards
cannot reorder the chain; the auditor page walks every row in that order. The auditor page
checks two different things, because they catch different tampering:

- **Linkage** — each `prev_hash` matches the previous `hash`. Catches an inserted or deleted row.
- **Content** — each row's hash is recomputed from its fields. Catches an *edited* row, which
  linkage alone would miss if the editor also fixed up the neighbour.

All 47,061 seeded rows re-hash and match. `scripts/write-test.mts` edits a row in place and
asserts the content check fails while the links still join up — which is the whole reason the
second check exists.

## The demo clock

The seed stops at **24 Oct 2026**, so the case statuses are a true snapshot of that moment.
Reading "today" from the system clock would make the demo drift — tasks would silently go
overdue and escalation counts would climb on their own. Everything date-dependent reads
`clock.ts` instead. The demo administrator can move it from `/admin`.

To reach the November round: move the clock to 20 Nov 2026 (the button on `/import` or the
admin page), then import `app/samples/R4_midline_BLK-01_with_errors.csv` on `/import`. A round can
be imported once its assessment window has opened on the demo clock, and rows dated after the
demo date are refused. (The seed's own `samples/assessment_R4_midline_*_SIMULATED.csv` files
record almost every child as not proficient, so they would flood the detector; use
`npm run gen:r4` instead.)

## Honesty, as a feature

The product only works if its claims can be trusted, so the labels are first-class components,
not footnotes:

| Label | Means |
|---|---|
| **Fictional demo data** | the row's provenance is `synthetic_demo` |
| **AI-drafted** | produced from a template, with the model named; it carries no authority |
| **Illustrative figure** | a plausible cost for the demo, never a PAB unit cost |
| **UP PAB 2025-26 · p. N** | a unit cost from the PAB minutes, with its page; "nearest line" when the rate is borrowed from a neighbouring line |
| **Real school (UDISE+) · name withheld** | a real government school whose name and code are deliberately not shown |
| **Context, not cause** | a published district figure (ASER, NFHS) shown beside the data, explaining nothing in particular |
| **Association, not cause** | a condition observed alongside the drop, nothing more |
| **Simulated — not sent** | a WhatsApp/IVR/SMS message that was never delivered |
| **Cites a source — verify before production** | quotes published evidence that still needs checking |
| **No effect-size claim** | the honest position for 15 of the 18 intervention cards |

The outcome panel prints the parallel-trends caveat and the regression-to-the-mean warning
beside every estimate, and the effect chart shows an interval crossing zero as crossing zero.
"Improved — indicative" and "improved — confirmed" are different claims and are never merged.

## Charts

Inline SVG, no chart library. Categorical slots 1–3 of a validated palette (blue / orange /
aqua), assigned by entity and never by rank, so filtering a series never repaints the others.
Validated with `--pairs all` against this app's white surface: CVD ΔE 9.2, normal-vision ΔE
24.0. Aqua is below 3:1 contrast on white, so every chart also carries direct labels and a
table view. One y-axis, always; two measures of different scale get two charts.

## Design tokens

Every colour is defined once, in `src/lib/tokens.ts`: the palette, a dark variant for map and
evidence surfaces (`surface-dark` swaps the CSS variables, so classes inside need no change), one
severity ramp shared by hotspot chips, the map and the charts, and the chart series. Tailwind
reads the tokens (`tailwind.config.ts`), MapLibre reads the hex values. Text sizes come from one
scale (`text-2xs` 11px … `text-5xl` 52px); fonts are IBM Plex Sans with its matching Devanagari,
Plex Mono, and Source Serif 4 for page and case titles, served by `next/font`. Menus and drawers
are Radix primitives in `src/components/primitives/`, so they trap and return focus and work
from the keyboard. `src/app/{loading,error,not-found,global-error}.tsx` cover every route.

## Language

English and Hindi throughout, switchable from the header. The seed already carries Hindi for
everything a field user reads — competency names, task titles, case statuses — so the app picks
the column rather than translating. Chrome with no Hindi in the data is translated in
`src/lib/i18n.ts`. A user's `preferred_language` is the default; the BEO demo account prefers
Hindi, which is why that account opens in Devanagari.

The field workers' pages (`/today`, `/field`, `/school`, `/tasks` and a task) are fully Hindi,
including dates ("05 नव॰ 2026"), the sidebar and header, the map legend and the forms' own words.
`npm run test:hindi -- http://localhost:3000` loads them in Hindi as a coordinator, a block
coordinator and a headmaster and reports any English interface text. Data stored in English
(school and people's names, case and complaint titles, reasons officers typed) is allowed; it
is recognised by looking it up in the database. Officer pages are not yet fully translated.

## My day and photo proof

Cluster and block coordinators and headmasters land on **My day** (`/today`), built for a phone:
one column, large buttons, and a tab bar at the bottom (My day · School(s) · My tasks · Raise).
It lists the person's own work in the order to do it: proof sent back (with the reason), late,
due today, this week, later, and proof already handed in. Each task can be marked seen, started
and given its proof on the same screen. Coordinators also see the schools in their area that have
gone longest without a visit, and everyone sees complaints waiting on them. The desktop Field
Operations workspace (`/field`) and the headmaster's school page (`/school`) are still in the menu.

Proof can carry a photo. The browser shrinks it (longest side 1600 px) before sending, but the
server trusts nothing it is told: it reads the first bytes to decide whether it is a JPEG, PNG or
WebP, refuses anything else or anything over 5 MB, computes the SHA-256 itself, refuses a photo
already used as proof elsewhere, and stores it in `.data/evidence-files/` under that hash
(`src/lib/evidence-files.ts`, table `evidence_files`). The evidence row's hash is the photo's.
`/api/evidence/[id]/photo` serves it only to someone who can see that proof, and hashes it again
first, refusing a file that has changed on disk. `npm run test:myday` checks all of this.

### On a phone, without signal

**Installable.** `src/app/manifest.ts` (served at `/manifest.webmanifest`, linked on every page)
names the app *Karyavahi / कार्यवाही*, opens it on `/today`, full screen, in the brand teal, with
icons drawn from the logo mark (`public/icons/`, made by `node scripts/gen-icons.cjs`). Android
Chrome offers "Add to home screen" / "Install app" on a production build over HTTPS (or localhost).

**Works without signal.** A hand-written service worker (`public/sw.js`, no libraries) is
registered by `src/components/OfflineSupport.tsx` — in production builds only, and only for the
roles that land on My day; for anyone else it removes any worker and saved pages left behind.

- Pages always come from the network first. Only `/today` and the task pages it links to are
  saved (each time they load, and the linked task pages in the background, re-fetched at most
  every 5 minutes), together with the scripts and styles they need. Without signal the saved copy
  opens, still working, with a notice: **"Offline — last updated 1 Nov, 5:29 pm"** /
  **"ऑफ़लाइन — अंतिम अपडेट …"**. Any other page shows a short bilingual "you are offline" page.
- `/api/*`, POSTs (server actions, sign-in) and client-navigation payloads are never cached or
  touched. Scripts, styles, fonts and icons are served cache-first (their names change per build).
- Saved pages belong to one person. They are deleted on sign-out, on sign-in, on the way to the
  sign-in pages, and when the page reports that someone else is signed in.

**Proof without signal.** On My day, *Hand in* (`src/components/ProofForm.tsx`) reads the phone's
location once, then sends the note and the shrunk photo to `POST /api/evidence/submit`. With no
connection, or if the send fails on the way, the proof is kept on the phone in IndexedDB
(`src/lib/offline/queue.ts`) under an id the phone makes up, and listed at the top of My day as
**Waiting to send** / **भेजने की प्रतीक्षा में**. It is sent by itself when the connection returns
(the `online` event, every page load, and Background Sync where Chrome has it). The server keeps
one row per (submitter, client id) — a unique index added by `migrateProofSync` in
`src/lib/ext/schema.ts` — so a retry, or the page and the worker sending at once, is still one
piece of proof. A proof the server refuses for a reason a retry will not change (task cancelled,
photo already used) stays on the phone with the reason until the person removes it or tries
again. Proof is only ever sent for the person who saved it. The 5 MB limit and the in-browser
shrinking apply as before.

**Real GPS.** When proof is handed in (and only then — nothing tracks the phone) the browser is
asked for one fix (`navigator.geolocation`, 12 s timeout). The phone sends latitude, longitude and
its accuracy; the **server** looks up the school's position, works out the distance (haversine)
and sets `gps_status` (`src/lib/proof-gps.ts`). A status sent by the client is never read.

| Status | Rule |
| --- | --- |
| `matched` — "GPS: at the school" | within **250 m** of the school |
| `outside_radius` — "GPS: 1.2 km away" | further than 250 m; also when even the near edge of a rough fix's error circle is beyond 250 m |
| `unavailable` — "GPS: not available" | location refused, switched off or timed out; the school has no position; or the fix is rougher than ±500 m and not clearly away |

250 m covers a village school's campus and the lane outside, plus the 20–50 m a cheap phone
usually reports outdoors. The fix, its accuracy and the distance are stored on the evidence row
(`gps_lat`, `gps_lng`, `gps_accuracy_m`, `gps_distance_m`), and every proof card — task page, case
page, the proof queue — shows the result. The task page's proof form reads the location the same
way (`src/components/LocationField.tsx`). School positions in the demo are simulated, so the
arithmetic is real but the points are not.

`npm run test:offline` checks the idempotency key, the GPS rules and scoping (33 checks, on a
scratch copy). `KV_BASE=http://localhost:3000 node scripts/offline-e2e.cjs` drives it in Chrome at
phone size against a production build: the manifest, My day and a task page opening offline,
proof with GPS, proof saved offline and sent when the signal returns as exactly one row, sign-out
clearing the saved pages, and no worker for officers (mutates the DB; reset afterwards).

## Voice: listen and speak, in Hindi

Field staff can use My day without reading or typing much. Everything runs in the browser on the
Web Speech API — no extra library, no account, no server-side audio (`src/components/voice.tsx`;
the words it says are built in `src/lib/voice-text.ts`).

- **Listen / सुनें.** My day has **मेरा दिन सुनें** under the greeting: it reads the date, the
  one-line summary and each open task in order — title, school, how late or when due, what proof
  is needed and how much is still missing, and why proof came back. Each task card has its own
  **सुनें**, and so does a task page. Claude's answers in the drawer and Claude drafts on cases and
  reports have a small **Listen** too (markdown and record-id citations are left out of the
  reading). Text is read in Hindi when it is Hindi — a Hindi answer on an English page still gets
  a Hindi voice — with the phone's Hindi (hi-IN) voice when it has one, otherwise whatever voice
  it has, saying so. It reads a little slower than normal (rate 0.9), in short pieces so Chrome
  does not cut it off, one button at a time, and stops when you leave the page or close the drawer.
- **Speak / बोलकर लिखें.** The proof note (My day and a task page), the complaint description,
  the Claude drawer's input and the home page's ask line have a microphone. It takes dictation in
  Hindi (hi-IN) or Indian English (en-IN), following the page language, shows the words as they
  are heard, and adds them to whatever is already typed, so speaking and typing mix. One phrase
  per tap. While listening the button is red and pressed (`aria-pressed`), with a pulse that is
  switched off when the phone asks for reduced motion. It says plainly when there is no
  connection, when the microphone is blocked, or when nothing was heard.
- **Privacy.** In Chrome, speech recognition sends the audio to the browser vendor's (Google's)
  speech service to be turned into text. Karyavahi never receives audio — only the text, and only
  when the form is handed in. The proof form says this in one line under the microphone; the
  other microphones say it in their tooltip and while listening. Reading aloud uses voices on the
  phone and sends nothing.
- **Where it does not work, nothing shows.** Every control checks for the API after the page
  loads and renders nothing when it is missing (Firefox, some in-app browsers), so the page is
  the same as before. Nothing is rendered on the server, so there is no hydration difference.

`npm run test:voice` checks the read-aloud text (Hindi and English), voice choice, chunking and
dictation rules (51 checks, no database). `KV_BASE=http://localhost:3000 node scripts/voice-e2e.cjs`
(`npm run e2e:voice`) drives it in Chrome at phone size as a Hindi-speaking headmaster with fake
speech objects, since headless Chrome has neither a microphone nor voices: Listen speaks Hindi
with the Hindi voice, the mic fills the proof note with a Hindi transcript, the offline and
blocked-microphone messages, the Claude drawer, and a browser without the APIs showing no voice
controls — with no page errors.

## The hotspot map: real Uttar Pradesh, simulated data

The map shows the real state of Uttar Pradesh. `data/up-geo.json` holds the state outline, its
75 districts and three city centres from OpenStreetMap (© OpenStreetMap contributors, ODbL),
simplified to about 0.5 MB; `npm run geo:fetch` rebuilds it from the Overpass API. When the file
is present the database is set up with it (`seedRealGeography` in `src/lib/ext/schema.ts`):

- the demo's three districts become **Rampur, Lucknow and Varanasi**, with their real outlines;
- their blocks, clusters and school positions are **simulated**: drawn inside the real outline by
  dividing it into small cells (`generateInsideReal` in `src/lib/ext/geogen.ts`), never named
  after real sub-districts or schools;
- the other 72 districts are drawn with **no data** (faint, not zoomable);
- the three **cities** are circles around the real city centres, holding the simulated clusters
  inside them.

Every unit records where its shape came from (`geometry_source`: `osm`, `simulated`,
`approximate`, `udise`), and the map, legend and side panel say so. With the real-data layer (next
section but one) the schools are real UDISE+ schools at their (slightly moved) positions, tagged
`udise`, and each block and cluster is drawn around its own schools; the block and cluster names and
lines stay simulated, and all learning figures remain simulated.
Without the file the app falls back to the invented honeycomb state.

Who sees what is unchanged and decided on the server: the state team sees all 75 districts, a
district officer only their district, a block officer their block, a coordinator their cluster,
a headmaster their school. The state view colours each district by its worst block (a district
measured against itself would always read zero) and counts its hot clusters.

**Colour areas by** (Layers menu) switches between learning change and three measures of each
school's situation right now, from `src/lib/school-now.ts`: teacher shortage (posts unfilled, or a
teacher who left without a replacement), visit gaps (days since the last visit) and attendance
trend (last three months against the three before). A larger area takes the colour that half,
30% or 15% of its schools reach. Clicking a school shows a **Right now** card. Headmasters never
see staff movements, on the map or anywhere else.

**Google Maps.** With a browser key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (in `app/.env.local`,
which git ignores), the hotspot page draws on Google Maps, with roads, places and a satellite
view (`src/components/google-map-view.ts`). Google's free *Maps Demo Key* works for prototyping;
production needs a key with billing. Restrict the key to your site's address. Without a key, or
if Google refuses it, the same map is drawn without background tiles, and a note says why. The
small dashboard maps always use the plain map. `npm run test:map` checks the geography, the
access rules and the thresholds.

## Real public data: real schools, calibrated results, PAB costs

The three demo districts now hold **real schools**. Learning results are still simulated (no public
source publishes school-level results), but they are calibrated so each district's Class 3 average
matches its published PRS 2024 figure, and the intervention cards use UP PAB 2025-26 unit costs
where a line exists. Every source, its year and terms, and the reconciliation table are on
**`/sources`** (public, English and Hindi), linked from the demo strip on every signed-in page and
from the footer of the signed-out pages.

| What | Status | Source |
|---|---|---|
| Schools: position, management, category, rural/urban, enrolment by class, teachers, classrooms | **real** (names and codes withheld) | UDISE+ via India Data Portal, about 2020-21, ODC-BY |
| Class 3 learning results | simulated, **calibrated** to the district average | PRS 2024 district reports (NCERT) |
| Class 1–2 learning results | simulated, not calibrated (no published district figure) | — |
| Intervention unit costs (9 of 18 cards) and plan cost estimates | **real** where a line exists, with the page | UP Samagra Shiksha PAB minutes 2025-26 |
| District context (reading, subtraction, enrolment, out of school; women's schooling, stunting, electricity) | **real**, shown as "context, not cause" | ASER 2024 (rural); NFHS-5 2019-21 |
| District and block codes for joins | real | LGD via India Data Portal, ODC-BY |
| People, cases, plans, tasks, proof, visits, attendance, staff movements, complaints; block and cluster names | fictional | — |

### How it is wired

- `npm run data:fetch` (`scripts/fetch-real-data.mjs`) downloads the sources into
  `app/.data/sources/<source>/` (git-ignored, about 14.9 MB): UDISE+ through the portal's CKAN
  datastore API, one 1,000-row page every 4 s, resumable page by page, backing off on HTTP 429;
  the PDFs and CSVs whole. Every download is checked (content type, `%PDF` or the expected CSV
  header, CKAN `success`) and written to a `.part` file first, so an error page never replaces a
  good file. Nothing is executed from the download folders.
- `npm run data:build` (`scripts/build-real-data.mjs`) turns them into two small committed files:
  `data/real/schools.json` (309 KB: per demo school id, the real school's moved position,
  management, category, rural/urban, enrolment Classes 1–8, teachers, classrooms — **no name, no
  UDISE code, no village**) and `data/real/figures.json` (31 KB: PRS, ASER, NFHS, PAB lines and the
  card mapping, each with its page). The PRS and PAB figures were read off the PDFs by position
  (pypdf with text coordinates; the PRS text layer lists the two overall charts in the opposite
  order to the page) and the build re-reads every cited page with `scripts/pdf-page-text.py`
  (`python3 -I`, pypdf) and refuses to write if a figure is not on it — 126 checks.
- When the database opens, `ensureRealData()` (`src/lib/ext/realdata.ts`) applies the files once
  (marker `realdata` in `ext_meta`, a fingerprint of both files; a demo reset applies them again):
  it updates the schools, calibrates Class 3, re-measures the findings and outcome checks that
  depend on Class 3, and puts the PAB costs on the cards. The map is redrawn from the real
  positions (`generateInsideReal` gives each grid cell to the cluster of its nearest school).
- **Without the files** (`data/real/` absent) the app runs on the fictional seed exactly as
  before. **Without the downloads** nothing changes: the app only ever reads `data/real/`. To
  rebuild with fresh data: `npm run data:fetch && npm run data:build`, then
  `npm run db:init -- --force` (server stopped).

### Real schools without breaking the case ledger — the trade-off

Two ways were possible: rebuild the districts' blocks, clusters and schools from UDISE+, or keep
the demo's ids and give each demo school a real counterpart. Rebuilding would have broken the case
ledger: 216 cases, their findings, diagnoses ("4 of 5 driver schools lost a teacher"), plans,
tasks, proof, users scoped to blocks and clusters, and a hash-chained audit trail all point at the
demo's school, cluster and block ids, and case titles name the demo clusters. So the demo keeps
its ids, people and cases, and **each demo school stands for a real school**:

1. pool: government schools (Department of Education or local body) teaching Classes 1–5 whose
   position lies inside the real district outline (Rampur 828, Lucknow 1,293, Varanasi 921; 321,
   33 and 92 had positions outside the district and were left out);
2. the largest of them by Class 1–3 enrolment, as many as the demo has (711 / 695 / 703),
   primary-only and Class 1–8 schools in the demo's proportions;
3. grouped by position into the demo's blocks (the first block takes the district town) and then
   clusters, with the demo's own group sizes (capacitated k-means);
4. inside each cluster, matched on type and Class 1–3 enrolment (mean Class 3 gap 12–13 children;
   88 / 176 / 100 type mismatches where the district had too few Class 1–8 government schools).

Block names could not be matched through LGD: the demo's block and cluster names are fictional
and match no LGD block (and UDISE+ carries an LGD block code for only 41–73% of rows), so blocks
were rebuilt from positions. The cost: the demo's blocks are groupings of real schools, not real
blocks. Districts are joined by LGD code (Rampur 176, Lucknow 162, Varanasi 187; PRS uses the
same, IND09176 etc.); ASER has names only, checked against the LGD list.

Assessment rows keep their own simulated 2025–26 enrolled and assessed counts; the school profile
shows UDISE+ enrolment (about 2020-21), so the two can differ. UDISE+ has no sanctioned posts, so
`teachers_sanctioned` is estimated from enrolment with the RTE Act's schedule (`rteTeacherPosts`).

### Real names are never shown

The learning results are simulated, so a real school's name or code beside them could make a real
school look as if it were failing. Names, UDISE codes and villages never leave `.data/sources/`;
each school is shown as **"School 0412 · Rampur Sadar"** / **"विद्यालय 0412 · रामपुर सदर"**
(`src/lib/school-label.ts`), pins are moved 300–700 m in a fixed direction per school, and the
school page shows a "Real school (UDISE+) · name withheld" chip and a UDISE+ profile card.
`npm run test:realdata -- http://localhost:3000` scans pages and API answers in both languages for
every real school name and UDISE code in the three districts.

### Calibration to PRS 2024 — reconciliation

One offset per district and subject, the same for every round R0–R3, applied to every Class 3
result so the district average in R0 (Feb 2025, the round nearest PRS 2024, held Dec 2024) equals
the PRS figure. Each school moves by the same number of points in every round, so its own changes
survive; a school near 100% moves only as far as it can and the rest of its cluster a little more,
so cluster and district totals move by the offset. Counts stay whole and `pct_proficient` is
`n_proficient / n_assessed`.

| District | Subject | PRS 2024 (PDF p. 15) | Simulated before | Offset | Simulated now (R0) | Gap |
|---|---|---|---|---|---|---|
| Rampur | Language | 73% | 41.3% | +31.7 | 73.0% | 0.0 |
| Rampur | Mathematics | 67% | 43.8% | +23.2 | 67.0% | 0.0 |
| Lucknow | Language | 72% | 44.3% | +27.7 | 72.0% | 0.0 |
| Lucknow | Mathematics | 66% | 47.1% | +18.9 | 66.0% | 0.0 |
| Varanasi | Language | 67% | 51.4% | +15.6 | 67.0% | 0.0 |
| Varanasi | Mathematics | 61% | 53.8% | +7.2 | 61.0% | 0.0 |

What it does to the ledger (all checked by `npm run test:realdata`):

- every finding keeps its status, case and driver schools; findings on Classes 1–2 are untouched;
- Class 3 drops move by at most 2.0 pp (155 of 160 by 1 pp or less), so case titles ("fell X
  pts") still hold, and no case-opened finding falls below the materiality line;
- the Class 3 findings' figures are re-measured, so they equal what the detector measures on the
  calibrated rows. Raising the level changes the two-proportion z-test, so 19 of 160 would pass or
  fail the noise test differently today (5 of them opened cases). The decision stands; the finding
  page says so ("Re-measured after calibration");
- Class 3 outcome checks are re-derived exactly as `write.ts` derives them (so re-running one gives
  the stored answer); 2 of 51 read differently than when they were made (one "improved — indicative"
  is now "confirmed", one "below target" is now "no change"); the case moves that followed stand,
  and the case page says so;
- learning caches, hotspots and the R4 samples follow automatically (`app/samples/` was regenerated
  from the calibrated R3; the import walkthrough still opens CASE-0216 and CASE-0217).

Caveats: PRS reports average % correct; the demo measures % of children at the grade benchmark. They
are not the same measure — matching one to the other is a simplification. PRS covers government and
private schools; the demo's schools are government schools.

### Costs from the UP PAB 2025-26 minutes

| Card | Unit cost | PAB line (PDF page) | Basis |
|---|---|---|---|
| INT-08 Place-value manipulatives kit | ₹165 per child | Elementary Head TLM (Grade III), Grades 3–5 (p. 48) | PAB line |
| INT-16 Library period with graded readers | ₹2,000 per primary school, ₹3,000 per composite school | Library grant (p. 47) | PAB line |
| INT-05 / INT-06 Structured lesson plans and teacher guides | ₹100 per teacher | Teacher Resource Material, Grades 3–5 (p. 48) | PAB line |
| INT-10 Parent meeting on learning levels | ₹1,500 per school | Community mobilisation (p. 39) | PAB line |
| INT-01 / INT-02 Teacher-led remedial hour | ₹500 per child | Learning Enhancement Programme (remedial), Classes 6–8 only (p. 44) | nearest line |
| INT-14 Multigrade classroom management training | ₹1,500 per teacher | In-service teacher training, 5 days (p. 47) | nearest line |
| INT-15 Assessment-informed regrouping | ₹65 per child | Student learning assessment, Class 5 and 8 board exams (p. 45) | nearest line |

The other nine cards keep their illustrative cost and label. A plan's estimate multiplies the unit
cost by its schools' UDISE+ enrolment in the case's class (per child), teachers in position (per
teacher) or school type (per school); plans drafted before keep their original illustrative
estimate. Note: the brief listed remedial teaching as Classes I–VIII; the minutes sanction it for
Classes 6–8 only, hence "nearest line". Also verified: FLN teacher capacity building ₹1,300 per
teacher (p. 48) and SMC training ₹3,000 per school (p. 39), not mapped to a card.

### District context

On `/hotspots` (every district in the reader's scope) and `/district`, a card labelled **"Context,
not cause"** shows PRS 2024 Class 3 beside the demo's calibrated R0, ASER 2024 (rural, p. 2) and
four NFHS-5 indicators:

| | Rampur | Lucknow | Varanasi | UP |
|---|---|---|---|---|
| ASER: Std III–V reading a Std II text | 41.8% | 54.7% | 61.0% | 46.5% |
| ASER: Std III–V doing at least subtraction | 48.4% | 52.8% | 62.6% | 52.7% |
| ASER: children 6–14 in government schools | 38.6% | 41.8% | 49.6% | 49.1% |
| ASER: children 6–14 not in school | 5.5% | 4.7% | 2.4% | 3.9% |
| NFHS-5: women with 10+ years of schooling | 26.9% | 51.9% | 55.0% | |
| NFHS-5: women literate | 57.0% | 78.4% | 79.0% | |
| NFHS-5: children under 5 stunted | 40.4% | 32.1% | 37.4% | |
| NFHS-5: population with electricity | 96.2% | 96.8% | 97.2% | |

(The portal's NFHS file also has "2023-24" rows whose round it does not document; they are not used.)

### Credits

UDISE+, Ministry of Education, via the India Data Portal (ISB), ODC-BY 1.0 · PARAKH Rashtriya
Sarvekshan 2024, NCERT (reproduced accurately with credit; logos not used) · ASER 2024, ASER
Centre / Pratham · NFHS-5, IIPS and MoHFW, via the India Data Portal (licence not stated) ·
Samagra Shiksha UP PAB minutes 2025-26, DoSEL, Ministry of Education (Internet Archive copy) ·
LGD codes, Ministry of Panchayati Raj, via the India Data Portal, ODC-BY · OpenStreetMap
contributors, ODbL.

## Speed, and five loose ends closed (backend hardening)

**How fast.** `node scripts/perf.mjs http://localhost:3012` signs in as five roles (state lead,
district officer, block officer, cluster coordinator, headmaster) and times 74 pages and map
calls against a production build (`npx next build && npx next start -p 3012`), printing the
first hit and the median of three. `--json out.json` saves a run and `--compare out.json` prints
it beside a new one. Measured on this machine, production build, before → after:

| Page or call | Who | Before (median) | After (median) |
|---|---|---|---|
| `/api/geo/map` (the whole state) | state lead | 685 ms | 62 ms |
| `/api/geo/map?h=urban` | state lead | 698 ms | 64 ms |
| `/api/geo/map` (their district / block) | DEO / BEO | 226 / 218 ms | 19 / 12 ms |
| `/overview` | state / DEO / BEO | 266 / 402 / 170 ms | 24 / 19 / 14 ms |
| `/cases/CASE-0184` | DEO | 74 ms | 19 ms |
| slowest of all 74 | | 698 ms | 64 ms |
| first request after a demo reset (sets up the extra tables) | | ~2.2 s | ~0.95 s |

Every page was already under a second on a production build; the 13–54 s seen earlier was the
development server (`next dev` compiles each page on its first visit, and runs React in its slow
checking mode) on a busy machine. On `next dev` the same pages took 0.1–1.7 s once compiled.

What changed:

- **Learning sums are kept until the data changes** (`src/lib/learning-cache.ts`). The hotspot
  engine, the map and the learning trend add up ~150,000 assessment rows; the state map did it
  nine times per request. Each answer is now kept, keyed by its SQL and parameters (so a block
  officer never gets the state's answer), and dropped the moment `assessment_results` or `schools`
  change: a trigger bumps `learning_data_gen` in `ext_meta` on every insert, update or delete, so
  an imported round shows on the next request with no timer and no restart.
- **Indexes** through the extension schema, marked `perf-v1` in `ext_meta` (like `integrity-v1`):
  `user_roles (role, scope_id)`, `users lower(email)`, `tasks (school_id)`, `evidence (submitted_by)`.
  The seed already had the others the pages need (tasks by owner/case/plan, evidence by
  task/case, cases by geography, assessment results by school and round, visits, notifications,
  audit by entity). Deriving the reporting lines after a reset no longer asks "who is this
  cluster's CRC" 2,300 times.
- **Per-row queries folded into one**: My day's proof counts, send-back reasons and case titles
  (`myday.ts`); the open-task count beside every person the plan composer offers, which was also
  re-queried inside a sort (`plans.ts`). `school-now.ts` was already batched. The badge counts in
  the top bar cost under 2 ms in total, so they were left alone.

**Loose ends.** Each has a test.

- **Checking proof** (`src/lib/duty.ts`). Only the submitter was barred, so after a reassignment
  the previous owner could accept the new owner's proof, and a task's owner could accept proof
  someone else uploaded for it. Now nobody checks proof for a task they own, held before (from
  `tasks.reassigned_from` or the audit trail), or handed in any proof for. The same rule filters
  every "proof waiting on you" queue and badge, so the app never offers a check it would refuse.
  (`write-test`)
- **Registration code** (`src/lib/reg-code.ts`). The emailed-code stand-in travelled in the
  address (`/register/status?…&code=123456`), where history, logs and Referer headers keep it.
  It now sits in a 30-minute, http-only cookie for `/register` holding the request id and code,
  so only the browser that applied sees it. (`session-test` over HTTP)
- **Who may sign in** (`src/lib/sign-in.ts`). Any account could be signed into by address alone,
  including one registered with a real address. The rule: an active account with a role whose
  email is on `demo.karyavahi.test` (the `.test` domain is reserved and never delegated, so it
  cannot be anyone's mailbox). Not just the seven `is_demo_account` personas: the walkthroughs and
  the crawl sign in other fictional officers and headmasters. Registration accepts only demo
  addresses too, so an approved request can always sign in; a refused address gets the same
  answer as an unknown one, and is not echoed into the URL. (`security-test`, `session-test`)
- **Approvals' required role.** It disagreed with the case's lever for 35 of the 268 seeded approvals. Each
  one matched the lever of *its own* plan: a case's lever moves when a new plan is drafted or the
  case goes to the PAB. Approvals now record that lever (`approvals.lever`, migration
  `approvals-v1`), the role always comes from it through `requiredRoleFor()` in `guard.ts` (the
  same table the decision gate uses), and new approvals are written the same way. (`authority-test`)
- **AI executive briefing.** The permission matrix gives `ai.executive_briefing` to district and
  state officers only, but `/api/ai/briefing` checked `ai.assistant`, so a block officer could get
  one. The route and `lib/ai/briefing.ts` now ask `mayReadBriefing()`; a block officer's overview
  shows the computed summary (`overview.plainBrief`), which is what it shows today.
  (`authority-test`, `session-test`)

## API for state dashboards

A read-only JSON API at `/api/v1` lets a state dashboard system — a Vidya Samiksha Kendra (VSK) —
pull the case ledger for one area. The plain-words guide, with a curl example, is the
**/developers** page in the app; the machine-readable description is `/api/v1/openapi.json`
(OpenAPI 3.1, public, no key).

```bash
curl -H "Authorization: Bearer kv_demo_<id>_<secret>" \
  "http://localhost:3000/api/v1/cases?severity=critical&open=true&limit=20"
```

| Endpoint | Returns |
|---|---|
| `GET /cases` | Cases, oldest change first. Filters `status`, `severity`, `block`, `updated_since`, `open`; cursor pagination (`limit`, `cursor` ← `page.next_cursor`). Each case has its stage, owner **role**, area, schools and task counts. |
| `GET /cases/{id}` | The case plus its finding (rounds, change, z-score, driver schools), diagnosis factor codes, current plan (intervention, schools, cost, pre-registration), next/overdue due dates and latest outcome check. |
| `GET /tasks` | Tasks by due date: status, due and original due date, owner **role**, proof required, overdue. Filters `case`, `status`, `block`, `overdue`. |
| `GET /outcomes` | Outcome checks: treated vs comparison means, DiD, interval, category, rounds compared. Filters `case`, `category`, `evaluated_since`. |
| `GET /hotspots` | Learning hotspot units one level below the key's area (or below `within=`), with the thresholds used. Filters `round`, `grade`, `subject`. |
| `GET /summary` | Headline figures: cases by status/stage/severity, overdue and escalated tasks, proof awaiting a check, outcomes by category. |

Every response carries `"demo_data": true` and the `DISCLAIMER` text, the key's `scope`,
`generated_at` and `as_of` (the demo clock, which "overdue" is judged against).

**Keys.** The state programme team and the demo administrator (permission `api.manage_keys` in
`src/domain/permissions.ts`) make keys at **/admin/api-keys** for one unit — the state, a
district or a block — chosen from the hierarchy. A key looks like `kv_demo_<12 hex id>_<43
character secret>`; it is shown once and only its SHA-256 is stored (`api_keys`, created by
`lib/ext/api-schema.ts`, marker `api-v1`). A presented key is found by its public id and
compared to the stored hash in constant time. Creating, revoking, and refused attempts at
either go on the audit chain (`api_key.create`, `api_key.revoke`). A demo reset deletes every key.

**Scope.** A key reads as a read-only *auditor* of its unit (`apiSession()` in
`lib/api/keys.ts`): every query goes through the same `scope.ts` predicates and `cases.ts` /
`dash.ts` / `hotspots.ts` read functions the app uses — there is no API-only scoping. Its user
id belongs to nobody and owns no tasks, so it sees its area and nothing else. A record outside the
area answers 404, the same as one that does not exist.

**Safety.** 401 for a missing, malformed, unknown, wrong or revoked key, with one identical body.
Cookies are never read, so a signed-in browser cannot use the API without a key, and no CORS
headers are sent (a VSK calls from its server; a page on another site cannot read responses).
60 requests a minute per key over a sliding window, counted from the call log; over it, 429 with
`Retry-After`. Each call is logged in `api_calls` — key id, method, path without the query string,
status, time, duration; never bodies — and moves the key's `last_used_at`. Failed
authentications are logged without a key id, so nobody can spend a key's allowance by guessing
at it. Log rows older than 30 days are pruned.

**Left out on purpose.** No people: no names, user ids, phone numbers or emails — owners are
roles. No free text anyone typed: case discussion, plan rationale, diagnosis hypothesis and
conclusion, reasons for moves, reassignments and deadline changes, proof and visit notes. A
manual case's officer-written title is replaced by a generated one. No complaints at all.

Tests: `npm run test:api` (module checks) and `npx tsx --conditions=react-server
scripts/api-test.mts http://localhost:3000` (also the HTTP checks: 401s, block/district/state
scope, 404s, pagination, leak scan, cookies, rate limit, OpenAPI coverage, who may make keys).

## Feedback and user testing

The app collects feedback from the people using it, shows it to the team that runs the user
testing, and shows everyone what changed because of it. The kit for running sessions with block
officers, coordinators and headmasters is in **`docs/user-testing/`** at the repository root
(protocol with Hindi + English consent script and task cards per role, a session sheet, and how
to turn findings into changes).

**Where people give feedback**

- **👍 / 👎 on Claude.** Under every Claude draft (`ClaudeDraft` in `src/components/Copilot.tsx`)
  and every chat answer (`src/components/Chat.tsx`). A 👎 offers quick reasons — *wrong figure,
  unclear, not useful, too long, language problem* — and an optional comment. A chat rating is
  tied to the answer's AI log id (the `interactionId` of the stream's `done` event), and only
  the person who asked can rate it; a draft rating names the task and record
  (`explain_finding:CASE-0184`) and, for fresh drafts, the AI log id too.
- **Feedback / सुझाव दें.** A speech-bubble button in the top bar of every signed-in page
  (`FeedbackButton` in `src/components/Feedback.tsx`) opens three questions: how easy was this
  (1–5), what were you trying to do, what got in the way. It is a bottom sheet on a phone, with
  44–64 px touch targets, and every word is in Hindi and English.

**Storage and rules.** One table, `feedback`, created by `src/lib/ext/feedback-schema.ts`
(marker `feedback-v1`): user id, the role they acted in, page path (no query string), kind
(`page` / `claude_draft` / `claude_answer`), target, AI log id, rating (1–5 for the form, ±1 for
Claude), tags, comment (≤ 1000 characters), what they were trying to do (≤ 500), language, and
wall-clock time. `POST /api/feedback` takes the user from the session, refuses cross-site
requests (`isCrossSite`) and anything that is not JSON, and hands over to `src/lib/feedback.ts`,
which validates every field, allows 20 pieces of feedback per person per 10 minutes (counted from
the table, so it survives a restart), and appends a `feedback.submit` audit row — without the
comment text. A person may change their mind on a Claude rating; the counts use each person's
latest.

**Who reads it.** Permission `feedback.review` (state programme team and demo administrator) in
`src/domain/permissions.ts`:

- **/admin/feedback** — totals, ratings by page (grouped by route), 👍/👎 by kind, the top
  reasons, every response with filters (kind, rating, reason, role, page), and **Export CSV**
  (`/api/feedback/export`, audited as `feedback.export`; refusals too; formula-looking cells are
  quoted so a spreadsheet does not run them).
- **/ai-log** — the 👍/👎 next to each Claude answer or draft.
- Everyone else sees only their own feedback (`ownFeedback`), never anyone else's.

**What we changed after testing — `/changes`.** Every signed-in user can read it. It lists
improvements made because of user input from `app/data/changes.json` (date, what users said —
paraphrased, which roles, what changed, a link to the page, and optionally the `FBK-` feedback
ids behind it). The file is read on each request, malformed entries are skipped, and links off
the site are dropped. It ships with one honest placeholder saying no sessions have been run
yet; `docs/user-testing/analysis.md` explains how to add entries. Never add feedback nobody gave.

**Tests.** `npm run test:feedback` (saving, validation and length limits, scoping, reviewers
only, the latest-rating rule, CSV and formula quoting, rate limit, audit rows, the changes file)
and `npx tsx --conditions=react-server scripts/feedback-test.mts http://localhost:3000` (also over
HTTP: signed-out 401, cross-site 403, non-JSON 415, a spoofed user id ignored, 429 over the
limit, CSV export only for reviewers, the pages). `scripts/crawl.mjs` loads `/admin/feedback`
and `/changes` for every role in both languages and checks that a BEO and a headmaster are
refused the review page.

## Known limits

- **An occasional hydration mismatch right after sign-in.** Now and then a page opened straight
  after signing in (seen on `/today`, `/overview`, a case or a task) is drawn slightly differently
  in the browser than on the server; React logs error #418 and redraws that part in the browser,
  so nothing breaks on screen. It is intermittent, also appears on code from before the latest
  merges, and was not traced to a single component. `scripts/e2e.cjs` reports it as a WARN line
  instead of failing; every other uncaught error still fails the run.
- **Only assessment rounds can be uploaded.** Attendance and staff-movement batches are still
  the seeded ones. A committed batch cannot be withdrawn from the UI; a correction is a new
  upload (rows already on record are refused as duplicates).
- **Outcome checks wait for an officer.** When the round a plan is judged on is imported, the
  case's Outcome section says so and offers **Check whether the plan worked**
  (`src/lib/outcome-due.ts`); nothing re-runs the check by itself, so a person sees each verdict
  as it is made.
- **Offline covers My day and its tasks only.** Other pages, marking a task seen or started,
  raising a complaint and the assistant still need signal (other pages show the offline page; a
  tap on "Seen it" or "Started" without signal fails and has to be repeated). A saved page is only as fresh as the last visit with signal, and the photo
  on a proof card is not saved for offline viewing. iPhones get the saved pages but no
  Background Sync: queued proof goes the next time the app is opened with signal. A queued proof
  stays on the phone until it is sent or removed, also across sign-out (only its author's next
  sign-in sends it); the service worker is not registered in `npm run dev`.
- **Voice is in the browser only, and depends on the phone.** There is no phone-call (IVR) line
  yet, so someone without a smartphone cannot use it. Dictation needs a connection in Chrome (the
  audio goes to Google's speech service) and does not work offline; typing still does, and proof
  typed offline is kept as before. Firefox and some in-app browsers have no speech recognition, and
  then no mic appears. Reading aloud works offline, but the voice depends on the phone: many Android
  phones have a Hindi voice, some have none (another voice then reads the Hindi, often poorly,
  and the app says so). Dictation quality for village and school names is the browser's, not ours.
- **GPS is a check, not proof of presence.** A phone's location can be spoofed and indoor fixes
  are rough; the server only judges the numbers it is sent. Proof saved offline is judged by the
  fix taken when it was saved, but the time it was saved is the phone's own clock (recorded, not
  trusted). Seeded proof keeps its seeded status, with no distance.
- **Claude drafts are not saved into the record.** A draft can be copied into a conclusion,
  comment or report by hand; it is never written to the case on its own. Drafts are cached in
  `app_state`, not versioned.
- **SQLite, not Postgres.** Column names match `sql/schema.sql` exactly and scoping is ported
  predicate for predicate, but the database does not enforce RLS itself — the app does. Against
  Supabase, `sign-in` becomes `signInWithPassword`, `scope.ts` becomes redundant because the
  policies take over, and `write.ts` calls `transition_case()` and `verify_evidence()` instead
  of reimplementing them.
- **Demo sign-in has no password**, because there is nothing real to protect. Authority still
  comes from the role rows, so a signed-in BEO cannot read another block whatever the cookie says.
  The cookie is a random session token, not the user id: only its SHA-256 is kept in `sessions`,
  it lasts 12 hours, and signing out revokes it on the server. Sign-in, sign-out and the language
  switch refuse forms posted from another site (`src/lib/http.ts`); `npm run test:session` checks
  all of it, and `npm run test:session -- http://localhost:3000` adds the same checks over HTTP.
- Do not replace `.data/karyavahi.db` while the server is running. It is held open in WAL mode,
  and the running process will checkpoint its own pages back over the copy. `scripts/restart.sh
  --reset` does it in the right order.
