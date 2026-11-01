'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * Claude's briefing. Renders what /api/ai/briefing returns — cached, freshly
 * generated, or an honest error. When the model is not configured (or fails), it shows the
 * deterministic summary computed on the server, clearly labelled as not AI. It never invents text.
 */

interface Briefing {
  headline: string; geographic_impact?: string; what_changed: string[]; priorities: { text: string; source_ids: string[] }[];
  risks: string[]; next_actions: string[]; caveat: string;
}
interface Envelope { status: 'ok' | 'unconfigured' | 'error'; briefing?: Briefing; generatedAt?: string; model?: string; cached?: boolean; message?: string; sources?: string[]; audit?: { checked: number; unsupported: string[] } }
export interface PlainBriefProps { finding: string; changed: string; geography: string; concern: string; next: string; sources: string[] }

const href = (id: string) =>
  id.startsWith('CASE-') ? `/cases/${id}` : id.startsWith('TSK-') ? `/tasks/${id}` : id.startsWith('INT-') ? `/interventions/${id}`
  : id.startsWith('FND-') ? `/findings/${id}` : id.startsWith('CMP-') ? `/complaints/${id}` : id.startsWith('SCH-') ? `/schools/${id}` : `/search?q=${id}`;

export function SourceChip({ id }: { id: string }) {
  return (
    <Link href={href(id)} className="inline-flex items-center rounded border border-brand/25 bg-brand-light px-1.5 py-px font-mono text-2xs text-brand hover:border-brand">
      {id}
    </Link>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="mt-1 text-base leading-snug text-ink">{children}</dd>
    </div>
  );
}

export function AiBriefing({ fallback }: { fallback?: PlainBriefProps }) {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSources, setShowSources] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const r = await fetch('/api/ai/briefing', { method: force ? 'POST' : 'GET', cache: 'no-store' });
      setEnv(await r.json());
    } catch {
      setEnv({ status: 'error', message: 'Could not reach the server.' });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const b = env?.status === 'ok' ? env.briefing : undefined;
  const useFallback = !b && !loading && !!fallback;
  const sources = b ? [...new Set([...(env?.sources ?? []), ...b.priorities.flatMap((p) => p.source_ids)])] : fallback?.sources ?? [];
  const stamp = env?.status === 'ok' && env.generatedAt
    ? `Claude · ${env.model} · ${new Date(env.generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST${env.cached ? ' · cached' : ''}`
    : useFallback ? 'Computed summary · not AI' : '';

  return (
    <section className="rounded-xl border border-line bg-white" aria-labelledby="brief-title" aria-busy={loading}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Icon name="sparkles" size={17} className="text-brand" />
          <h2 id="brief-title" className="text-md font-semibold tracking-tight text-ink">Claude’s briefing</h2>
          {stamp ? <span className={`chip ${useFallback ? 'border-line-strong bg-paper-sunk text-ink-soft' : 'border-brand/25 bg-brand-light text-brand'}`}>{stamp}</span> : null}
        </div>
        <div className="flex items-center gap-1">
          {sources.length ? (
            <button type="button" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources} className="btn-ghost btn-sm">
              <Icon name="file" size={14} />{showSources ? 'Hide' : 'View'} supporting evidence
            </button>
          ) : null}
          {env?.status !== 'unconfigured' ? (
            <button type="button" onClick={() => load(true)} disabled={loading} className="btn-ghost btn-sm" aria-label="Refresh brief">
              <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />{loading ? 'Working…' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </header>

      <div className="px-5 py-4">
        {loading && !b ? (
          <div className="grid gap-4 md:grid-cols-4" aria-label="Preparing brief">
            {[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2"><div className="skeleton h-3 w-24" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-4/5" /></div>)}
          </div>
        ) : b ? (
          <>
          {env?.audit && env.audit.unsupported.length > 0 ? (
            <p role="alert" className="mb-3 rounded-lg border border-warn/30 bg-warn-light px-3 py-1.5 text-xs text-warn">
              <Icon name="alert" size={13} className="mr-1 inline" />Not found in the records — check these figures before relying on the briefing: <strong>{env.audit.unsupported.join(', ')}</strong>
            </p>
          ) : env?.audit && env.audit.checked > 0 ? (
            <p className="mb-3 inline-flex items-center gap-1 text-2xs text-good"><Icon name="check-circle" size={12} />{env.audit.checked} figures checked against the records</p>
          ) : null}
          <dl className={`grid gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
            <Field label="Most important finding" wide><span className="text-md font-semibold">{b.headline}</span></Field>
            <Field label="Geographic impact">{b.geographic_impact ?? '—'}</Field>
            <Field label="What changed">{b.what_changed[0] ?? '—'}</Field>
            <Field label="Main operational concern" wide>{b.risks[0] ?? '—'}</Field>
            <Field label="Recommended next priority" wide><span className="font-medium text-brand">{b.next_actions[0] ?? b.priorities[0]?.text ?? '—'}</span></Field>
          </dl>
          </>
        ) : useFallback ? (
          <>
            <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Most important finding" wide><span className="text-md font-semibold">{fallback!.finding}</span></Field>
              <Field label="Geographic impact">{fallback!.geography}</Field>
              <Field label="What changed">{fallback!.changed}</Field>
              <Field label="Main operational concern" wide>{fallback!.concern}</Field>
              <Field label="Recommended next priority" wide><span className="font-medium text-brand">{fallback!.next}</span></Field>
            </dl>
            <p className="mt-3 text-xs text-ink-faint">{env?.status === 'unconfigured' ? 'AI is not connected, so this summary is computed directly from the records.' : `AI brief unavailable${env?.message ? ` (${env.message})` : ''}; showing the computed summary.`}{env?.status === 'error' ? <button type="button" onClick={() => load(true)} className="ml-2 text-brand hover:underline">Retry AI</button> : null}</p>
          </>
        ) : (
          <p className="text-sm text-ink-soft">{env?.message ?? 'No brief available.'}</p>
        )}
        {showSources && sources.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-faint">
            <span className="mr-1">Built from:</span>{sources.slice(0, 16).map((id) => <SourceChip key={id} id={id} />)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
