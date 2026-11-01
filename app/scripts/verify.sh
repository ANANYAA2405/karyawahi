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

step 'roles, scope, complaints, onboarding and who may sign in'
npx tsx --conditions=react-server scripts/security-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'reads stay inside the reader'"'"'s area'
npx tsx --conditions=react-server scripts/scope-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'the plan composer and the task generator'
npx tsx --conditions=react-server scripts/plan-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'My day and photo proof'
npx tsx --conditions=react-server scripts/myday-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'the real map: boundaries, who sees what, school situation'
npx tsx --conditions=react-server scripts/map-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'sign-in sessions and request checks'
npx tsx --conditions=react-server scripts/session-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

step 'round import and the live detection run'
npx tsx --conditions=react-server scripts/import-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

step 'case threads, mentions and followers'
npx tsx --conditions=react-server scripts/threads-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

step 'Claude guards: the number auditor and the evidence library search'
npx tsx --conditions=react-server scripts/ai-guard-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'reminders, the overdue nudge and escalation, run by the scheduler'
npx tsx --conditions=react-server scripts/reminders-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

step 'API keys for state dashboards'
npx tsx --conditions=react-server scripts/api-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

step 'real data: anonymised schools, calibration to PRS 2024, PAB costs, the fallback'
npx tsx --conditions=react-server scripts/realdata-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

step 'user feedback: saving, limits, who reads it, the audit row'
npx tsx --conditions=react-server scripts/feedback-test.mts 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -4

if [ "$FULL" = "--full" ]; then
  step 'production build'
  npm run build 2>&1 | tail -4

  step 'restarting the server from the pristine seed'
  scripts/restart.sh --reset

  step 'every route, every role, both languages'
  node scripts/crawl.mjs 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -14

  step 'sign-in sessions over HTTP'
  npx tsx --conditions=react-server scripts/session-test.mts http://localhost:3000 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

  step 'the read-only API over HTTP: keys, scope, pagination, rate limit'
  npx tsx --conditions=react-server scripts/api-test.mts http://localhost:3000 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6
  step 'no real school name or UDISE code in pages and API answers'
  npx tsx --conditions=react-server scripts/realdata-test.mts http://localhost:3000 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -8

  step 'user feedback over HTTP: signed-out, cross-site, CSV for reviewers only'
  npx tsx --conditions=react-server scripts/feedback-test.mts http://localhost:3000 2>&1 | grep -vE 'ExperimentalWarning|trace-warnings' | tail -6

  step 'the demo story through the browser'
  node scripts/e2e.cjs 2>&1 | tail -6

  step 'resetting the demo back to the seed'
  scripts/restart.sh --reset
fi

printf '\n\033[1mall checks finished\033[0m\n'
