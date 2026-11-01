import { startScheduler } from './lib/scheduler';

// Never while `next build` collects pages, and not when switched off (KV_SCHEDULER=off).
if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.KV_SCHEDULER !== 'off') {
  startScheduler();
}
