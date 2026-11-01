/**
 * Next's start-up hook. Starts the reminder scheduler (src/lib/scheduler.ts) once per server
 * process: Node runtime only (not the edge runtime) and never while `next build` collects pages.
 *
 * The Node-only start-up lives in instrumentation-node.ts and is imported inside the runtime
 * check, as Next documents: Next compiles this file for the edge runtime too, and only an import
 * written inside `if (process.env.NEXT_RUNTIME === 'nodejs')` is left out of that bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
