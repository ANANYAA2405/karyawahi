#!/usr/bin/env bash
# Runs every check, in order, from a known-good seed.
#
#   scripts/verify.sh            typecheck + data + domain checks (no server needed)
#   scripts/verify.sh --full     the above, plus a build, a route crawl and the UI walkthrough
#
# The database is restored to the pristine seed first, because several checks assert the
# snapshot the seed was generated at (CASE-0184 waiting on a decision, 14 cases in BLK-01).
set -euo pipefail
cd "$(dirname "$0")/.."
FULL="${1:-}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step 'restoring the pristine seed'
rm -f .data/karyavahi.db-wal .data/karyavahi.db-shm
cp .data/karyavahi.pristine.db .data/karyavahi.db
echo 'done'

step 'typecheck'
npx tsc --noEmit
echo 'no type errors'

step 'read layer and scoping (smoke)'
npx tsx --conditions=react-server scripts/smoke.ts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -25

step 'write layer, lifecycle, refusals and the audit chain'
npx tsx --conditions=react-server scripts/write-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -12

step 'who may move a case, and who approves a plan'
npx tsx --conditions=react-server scripts/authority-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'ids, the audit order, counters and summary columns'
npx tsx --conditions=react-server scripts/integrity-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'reads stay inside the reader'"'"'s area'
npx tsx --conditions=react-server scripts/scope-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'the plan composer and the task generator'
npx tsx --conditions=react-server scripts/plan-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'sign-in sessions and request checks'
npx tsx --conditions=react-server scripts/session-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

if [ "$FULL" = "--full" ]; then
  step 'production build'
  npm run build 2>&1 | tail -4

  step 'restarting the server from the pristine seed'
  scripts/restart.sh --reset

  step 'every route, every role, both languages'
  node scripts/crawl.mjs 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -14

  step 'sign-in sessions over HTTP'
  npx tsx --conditions=react-server scripts/session-test.mts http://localhost:3000 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

  step 'the demo story through the browser'
  node scripts/e2e.cjs 2>&1 | tail -6

  step 'resetting the demo back to the seed'
  scripts/restart.sh --reset
fi

printf '\n\033[1mall checks finished\033[0m\n'
