import 'server-only';
import { existsSync } from 'node:fs';
import { one, j, DB_PATH } from './db';
import { reminderSweep, recordJob, type SweepResult, type SweepTrigger } from './write';

/**
 * Runs the reminder sweep without anybody pressing a button.
 *
 *   - once when the server starts (instrumentation.ts calls startScheduler from Next's register hook)
 *   - every hour while it runs
 *   - straight after the demo clock moves or the demo is reset (the admin actions call runScheduledSweep)
 *
 * The timer is wall-clock time, because a server runs in real time; the sweep itself only ever
 * reads the demo clock, so what it sends depends on the demo date, not on when it happens to run.
 * It is idempotent (each step stamps the task), so running it hourly on an unchanged demo date
 * sends nothing new.
 *
 * One process, one timer: the state lives on globalThis, so a second register() call, a dev-mode
 * reload, or two bundles importing this file share the same timer. Never started during
 * `next build` (instrumentation.ts checks the phase). KV_SCHEDULER=off turns it off.
 */

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_TRIGGERS: SweepTrigger[] = ['startup', 'hourly', 'clock_moved', 'demo_reset', 'system'];

type Holder = { timer: ReturnType<typeof setInterval> | null; intervalMs: number; startedAt: string | null; nextRunAt: number | null };
const holder: Holder = ((globalThis as unknown as { __kv_sched?: Holder }).__kv_sched ??= {
  timer: null, intervalMs: SWEEP_INTERVAL_MS, startedAt: null, nextRunAt: null,
});

/** One automatic run. Never throws: a failed run is recorded as a failed job and logged. */
export function runScheduledSweep(trigger: Exclude<SweepTrigger, 'manual'>): SweepResult | null {
  if (holder.timer && trigger === 'hourly') holder.nextRunAt = Date.now() + holder.intervalMs;
  try {
    if (!existsSync(DB_PATH)) return null;
    return reminderSweep(null, undefined, { trigger });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[scheduler] reminder sweep (${trigger}) failed: ${msg}`);
    try { recordJob('reminder_sweep', 'failed', { trigger, ran_at: new Date().toISOString() }, msg); } catch { /* the database itself is the problem */ }
    return null;
  }
}

/** Starts the hourly timer and runs the sweep once now. Returns false when a timer is already running. */
export function startScheduler(opts: { intervalMs?: number; runNow?: boolean } = {}): boolean {
  if (process.env.KV_SCHEDULER === 'off') return false;
  if (holder.timer) return false;
  holder.intervalMs = opts.intervalMs ?? SWEEP_INTERVAL_MS;
  holder.startedAt = new Date().toISOString();
  holder.nextRunAt = Date.now() + holder.intervalMs;
  holder.timer = setInterval(() => { runScheduledSweep('hourly'); }, holder.intervalMs);
  // The timer must not keep a process alive on its own (scripts, a server shutting down).
  holder.timer.unref?.();
  if (opts.runNow !== false) runScheduledSweep('startup');
  return true;
}

export function stopScheduler(): void {
  if (holder.timer) clearInterval(holder.timer);
  holder.timer = null;
  holder.nextRunAt = null;
  holder.startedAt = null;
}

export interface SchedulerStatus {
  running: boolean;          // a timer is running in this server process
  intervalMs: number;
  startedAt: string | null;  // wall clock
  nextRunAt: string | null;  // wall clock
  lastAuto: { jobId: string; ranAt: string; asOf: string | null; trigger: string; status: string; summary: Record<string, unknown> } | null;
}

/** What the admin page shows: when the sweep last ran by itself, and when it runs next. */
export function schedulerStatus(): SchedulerStatus {
  const ph = AUTO_TRIGGERS.map(() => '?').join(',');
  // rowid, not started_at: started_at is the demo clock, which can move backwards.
  const row = one<{ id: string; started_at: string; status: string; summary: string }>(
    `select id, started_at, status, summary from system_jobs
      where job_type = 'reminder_sweep' and json_extract(summary, '$.trigger') in (${ph})
      order by rowid desc limit 1`, ...AUTO_TRIGGERS,
  );
  const summary = row ? j(row.summary, {} as Record<string, unknown>) : {};
  return {
    running: holder.timer !== null,
    intervalMs: holder.intervalMs,
    startedAt: holder.startedAt,
    nextRunAt: holder.timer && holder.nextRunAt ? new Date(holder.nextRunAt).toISOString() : null,
    lastAuto: row ? {
      jobId: row.id,
      ranAt: typeof summary.ran_at === 'string' ? summary.ran_at : row.started_at,
      asOf: typeof summary.as_of === 'string' ? summary.as_of : null,
      trigger: String(summary.trigger ?? ''),
      status: row.status,
      summary,
    } : null,
  };
}
