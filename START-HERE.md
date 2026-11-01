# Karyavahi — run it

**DEMO MODE — NOT ACTUAL GOVERNMENT STATISTICS.** Schools, enrolment, teachers and locations are
real (UDISE+ via India Data Portal, about 2020-21; names withheld). Learning results are simulated
and calibrated to PRS 2024; costs are from the UP PAB 2025-26 minutes. People, cases and outcomes are
fictional. Nothing is connected to a live UDISE+, NAS, a state VSK, WhatsApp or IVR. Every source,
with its terms: open **/sources** in the app (linked from the demo strip at the top of every page).

This package is self-contained. The database is already built, so there is nothing to generate.

## 1. Check Node

```
node -v
```

You need **v22.5.0 or newer**. The data layer uses Node's built-in `node:sqlite`, which does not
exist in older versions. If `node -v` prints something lower (or "not recognized"), install the
current LTS from <https://nodejs.org> and open a new terminal.

## 2. Install and run

In a terminal — PowerShell, Command Prompt, or a terminal inside VS Code:

```
cd app
npm install
npm run dev
```

Then open **http://localhost:3000** in your browser.

`npm run dev` sets the database up on first run, so there is no separate build step.

## 3. Sign in

There are no passwords — every account is fictional. Start with the block officer, who has the
freshest queue:

```
beo.blk-01@demo.karyavahi.test
```

That account prefers Hindi, so the app opens in Devanagari. The **हिंदी / English** button in
the header switches it.

The login page lists one account per role. The most interesting path through the demo:

1. Sign in as the Rampur Sadar block officer and open **CASE-0184** — a Class 3 subtraction drop
   of 17.9 points, 11.3 points worse than the district.
2. Read the finding, then the diagnosis: 4 of the 5 driver schools lost a teacher without
   replacement, and 4 went 60+ days with no cluster visit. Every row traces to the record it
   came from.
3. Look at the plan's decision box. The block officer submitted this plan, so they cannot approve
   it: someone else has to. Sign out and sign in as the district officer
   (`deo.rmp@demo.karyavahi.test`), open CASE-0184 and approve the plan. That locks the comparison
   schools and the success threshold **before** anyone knows the result.
4. Sign out, sign in as the auditor, and open the audit trail: the approval is there, hash-chained.
   To take a case through planning yourself, sign in as `beo.blk-17@demo.karyavahi.test`, open
   **CASE-0127** and press **Open the plan composer**: pick an intervention and schools, preview
   how success will be judged, and submit. The district officer (`deo.amp@demo.karyavahi.test`)
   approves it, and the block officer then turns it into tasks with **Review and assign the tasks**.
   Then sign in as one of that plan's headmasters (for example `hm.sch-01893@demo.karyavahi.test`):
   they land on **My day**, where the new task can be marked seen, started and given proof with a
   photo, on a phone-sized screen and in Hindi.
5. Try something you should not be able to do — sign in as the cluster coordinator and open
   `/approvals`, or as a headmaster and open `/audit`. The refusal explains itself.

### Bring in the November round (R4) and watch new cases appear

1. Sign in as `admin@demo.karyavahi.test`, go to **Administration → Data import** and press
   **Move the demo clock to 20 Nov 2026**. (R4's assessment window opens on 16 Nov; before that
   the app refuses the upload and says why.)
2. Sign in as `beo.blk-01@demo.karyavahi.test`, open **Data import**, **Choose file** and pick
   `app/samples/R4_midline_BLK-01_with_errors.csv`, then press **Check the file**. Nothing is
   saved yet: you see 2,340 good rows and 9 bad ones, each with the reason it was refused.
3. Press **Commit 2,340 rows and run detection**. The rows are saved as a new import batch, the
   detector compares R4 with July's round, and two new cases open in your queue.
4. Try the same file again — it is recognised as already imported and adds nothing.

To make your own file: `npm run gen:r4` (Rampur Sadar block), `npm run gen:r4 -- --errors`,
`npm run gen:r4 -- --scope DST-01` (a district, for `deo.rmp@`) or `-- --scope all` (the state).

### Talk about a case

Open any case (for example one of the new ones, or CASE-0184) and scroll to **Discussion**.
Write a comment and type `@` to mention someone — only people who can open that case are
offered. Officers can tick **Record this as a decision**, which also adds it to the case
timeline. **Edit** your own comments; **Follow / Unfollow** decides whether new comments reach
your notifications. Sign in as the person you mentioned and check the bell.

## The hotspot map

Sign in as the state team (`state.lead@demo.karyavahi.test`) and open **Learning hotspots**: the
real map of Uttar Pradesh, with the demo placed in Rampur, Lucknow and Varanasi. Double-click to
zoom from district to block to cluster to school; switch **Blocks / Cities** to see Lucknow city;
use **Layers → Colour areas by** for teacher shortage, visit gaps or attendance. The boundaries
are real (OpenStreetMap); everything inside them is simulated. To see it on Google Maps, put a
browser key in `app/.env.local` as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=…` and restart the app.

## Real public data

The three districts hold real government schools from UDISE+ (shown as "School 0412 · Rampur
Sadar", never by their real name), Class 3 results are calibrated so each district matches PRS 2024,
and nine intervention cards carry UP PAB 2025-26 unit costs with their page. The app reads two small
committed files, `app/data/real/schools.json` and `app/data/real/figures.json`, so nothing needs
downloading. To rebuild them from the public sources (about 15 MB, needs Python 3 with `pypdf`):

```
cd app
npm run data:fetch            # downloads into app/.data/sources/ (not committed), throttled, resumable
npm run data:build            # writes app/data/real/*.json, checking every figure against its PDF page
npm run db:init -- --force    # with the server stopped
```

Delete `app/data/real/` and the app runs on the fictional seed alone. Details, the reconciliation
table and the trade-offs: `app/README.md`, section "Real public data".

## Folder layout

```
karyavahi/
  src/domain/     the rules: detection, outcome check, lifecycle, permissions
  src/lib/        seeded randomness, IST dates, t-values
  app/            the Next.js application  ← run npm commands in here
    .data/        the prebuilt database
```

`src/domain` is imported by the app directly rather than copied, so the detector and the outcome
check running in the interface are the same code that generated and validated the data.

## Commands

| In `app/` | What it does |
|---|---|
| `npm run dev` | development server on port 3000 |
| `npm run build` then `npm start` | production build |
| `npm run db:init -- --force` | discard demo changes, start from the seed again |
| `npm run typecheck` | TypeScript, no emit |
| `npm run gen:r4` | write an R4 (November) results file into `app/samples/` |
| `npm run test:import` / `npm run test:threads` | the round-import and case-thread tests (stop the server first) |
| `npm run test:realdata` | real schools, calibration, PAB costs and the fallback; add `-- http://localhost:3000` (server running) to scan pages for real names |
| `npm run data:fetch` / `npm run data:build` | download the public sources / rebuild `app/data/real/` from them |

`npm run verify` and `verify:full` need a bash shell — on Windows use Git Bash or WSL. Running
the app itself needs no bash.

## If something goes wrong

**`Cannot find module 'node:sqlite'`** — Node is older than 22.5. Upgrade and retry.

**`No database at ...karyavahi.pristine.db`** — the `.data` folder did not survive unzipping.
Re-extract, making sure hidden/dot folders are included.

**Port 3000 already in use** — `npm run dev -- -p 3001`, then use port 3001.

**The demo looks wrong after you have clicked around** — `npm run db:init -- --force` resets it.
Or sign in as `admin@demo.karyavahi.test` and use the demo admin page, which also moves the demo
clock. The seed's "today" is 24 October 2026; the app reads that, not your system clock.

There is more detail in `app/README.md`, including how this maps onto Postgres/Supabase.
