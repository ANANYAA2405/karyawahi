# Karyavahi — run it

**DEMO MODE — FICTIONAL SEED DATA — NOT ACTUAL GOVERNMENT STATISTICS.** Every school, person,
score, cost and outcome is generated. Nothing is connected to UDISE+, NAS, ASER, a state VSK,
WhatsApp or IVR.

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
5. Try something you should not be able to do — sign in as the cluster coordinator and open
   `/approvals`, or as a headmaster and open `/audit`. The refusal explains itself.

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
