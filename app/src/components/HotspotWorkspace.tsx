'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { GeoMap, LEVEL_NAME, type MapPayload } from './GeoMap';
import { SEVERITY_COLORS, SEVERITY_LABEL } from '@/lib/maplayers';
import { Icon } from './Icon';

/**
 * Learning Hotspots — the map-first workspace.
 *
 *   top bar: geographic breadcrumb · place search · blocks/cities · assessment period
 *   map (~70%) with floating toolbar · context panel (~30%) · list view on the same data
 *
 * All navigation inside the workspace updates the URL in place; the panel fetches the selected
 * area's detail from /api/geo/detail, which applies the same scope rule as the map.
 */

type P = Record<string, unknown>;
interface Detail {
  id: string; name: string; level: string; geometry: string; schools: number; compared: string | null; imported: string | null;
  breakdown: { grade: number; competency: string; prev: number | null; curr: number | null; rel: number | null; severity: string; n: number }[];
  cases: { id: string; title: string; severity: string; status: string }[]; caseCount: number; critical: number;
  complaints: { id: string; title: string; status: string; priority: string }[]; complaintCount: number; warnings: string[];
}
const pp = (v: unknown) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(1)} pp`);
const ORDER = ['critical', 'significant', 'moderate', 'stable', 'improving', 'insufficient'];

export function HotspotWorkspace({ rounds, competencies, latestLabel }: { rounds: { id: string; label: string }[]; competencies: { id: string; label: string }[]; latestLabel: string }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const [data, setData] = useState<MapPayload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; level: string }[]>([]);
  const selId = sp.get('sel');
  const view = sp.get('view') === 'list' ? 'list' : 'map';
  const hierarchy = sp.get('h') === 'urban' ? 'urban' : 'admin';

  const push = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    const qs = next.toString();
    window.history.pushState(null, '', `${pathname}${qs ? `?${qs}` : ''}`);
  }, [sp, pathname]);

  const features = (data?.features.features ?? []) as { id?: string | number; properties: P }[];
  const selected = features.find((f) => f.properties.id === selId)?.properties ?? null;

  useEffect(() => {
    if (!selId) { setDetail(null); setDetailState('idle'); return; }
    let cancelled = false;
    setDetailState('loading');
    const qs = new URLSearchParams({ id: selId });
    for (const k of ['grade', 'round']) { const v = sp.get(k); if (v) qs.set(k, v); }
    fetch(`/api/geo/detail?${qs}`).then(async (r) => {
      if (cancelled) return;
      if (!r.ok) { setDetailState('error'); setDetail(null); return; }
      setDetail(await r.json()); setDetailState('idle');
    }).catch(() => { if (!cancelled) setDetailState('error'); });
    return () => { cancelled = true; };
  }, [selId, sp]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { const r = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`); setResults((await r.json()).results ?? []); } catch { setResults([]); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const crumbs = data?.crumbs ?? [];
  const up = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const counts = ORDER.map((s) => ({ s, n: features.filter((f) => f.properties.severity === s).length }));
  const top = [...features].filter((f) => ['critical', 'significant', 'moderate'].includes(String(f.properties.severity)) || Number(f.properties.hotChildren) > 0)
    .sort((a, b) => ORDER.indexOf(String(a.properties.severity)) - ORDER.indexOf(String(b.properties.severity)) || Number(b.properties.hotChildren) - Number(a.properties.hotChildren)).slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Geographic breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {up ? <button type="button" onClick={() => push({ parent: up.id, sel: null })} className="btn-ghost btn-sm" aria-label="Back to previous level"><Icon name="chevron-left" size={15} /></button> : null}
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 ? <Icon name="chevron-right" size={13} className="text-ink-faint" /> : null}
              <button type="button" disabled={i === crumbs.length - 1} onClick={() => push({ parent: c.id, sel: null })}
                className={`rounded-md px-2 py-1 ${i === crumbs.length - 1 ? 'font-semibold text-ink' : 'text-ink-soft hover:bg-paper-deep hover:text-ink'}`}>{c.name}</button>
            </span>
          ))}
          {data?.childLevel ? <span className="ml-1 text-xs text-ink-faint">· {LEVEL_NAME[data.childLevel] ?? data.childLevel}s</span> : null}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a place…" aria-label="Find a place" className="input h-9 w-52 pl-8 text-sm" />
            {results.length ? (
              <ul className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-line bg-white shadow-pop" role="listbox">
                {results.map((r) => (
                  <li key={r.id}><button type="button" onClick={() => { setQ(''); setResults([]); push(r.level === 'school' ? { sel: r.id } : { parent: r.id, sel: null }); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-paper-sunk"><span className="truncate text-ink">{r.name}</span><span className="text-2xs text-ink-faint">{LEVEL_NAME[r.level] ?? r.level}</span></button></li>
                ))}
              </ul>
            ) : null}
          </div>
          {data?.hasUrban ? (
            <div className="inline-flex rounded-lg border border-line-strong bg-white p-0.5" role="group" aria-label="Hierarchy">
              {(['admin', 'urban'] as const).map((h) => (
                <button key={h} type="button" aria-pressed={hierarchy === h} onClick={() => push({ h: h === 'admin' ? null : 'urban', parent: null, sel: null })}
                  className={`rounded-md px-2.5 py-1 text-sm ${hierarchy === h ? 'bg-navy text-white' : 'text-ink-soft hover:text-ink'}`}>{h === 'admin' ? 'Blocks' : 'Cities'}</button>
              ))}
            </div>
          ) : null}
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm text-ink-soft"><Icon name="calendar" size={13} />{data?.compared ?? latestLabel}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
        <div>
          <div className={view === 'list' ? 'hidden' : ''}>
            <GeoMap height="max(420px, calc(100vh - 300px))" onData={setData} rounds={rounds} competencies={competencies} />
          </div>
          {view === 'list' ? (
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <p className="text-sm font-medium text-ink">{features.length} {data?.childLevel ? `${LEVEL_NAME[data.childLevel] ?? data.childLevel}s` : 'areas'}</p>
                <button type="button" onClick={() => push({ view: null })} className="btn-quiet btn-sm"><Icon name="map" size={14} />Map</button>
              </div>
              <div className="overflow-x-auto">
                <table className="table min-w-[720px]">
                  <thead><tr><th>Area</th><th>Learning status</th><th className="text-right">vs district</th><th className="text-right">Cases</th><th className="text-right">Complaints</th><th className="text-right">Overdue</th><th /></tr></thead>
                  <tbody>
                    {[...features].sort((a, b) => ORDER.indexOf(String(a.properties.severity)) - ORDER.indexOf(String(b.properties.severity))).map((f) => {
                      const p = f.properties;
                      return (
                        <tr key={String(p.id)} className={p.id === selId ? 'bg-brand-light/50' : ''}>
                          <td><button type="button" onClick={() => push({ sel: String(p.id) })} className="text-left font-medium text-ink hover:text-brand">{String(p.name)}</button>{Number(p.hotChildren) ? <span className="block text-xs text-crit">{String(p.hotChildren)} hot sub-areas</span> : null}</td>
                          <td><span className="inline-flex items-center gap-1.5 text-sm"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLORS[String(p.severity)] }} />{SEVERITY_LABEL[String(p.severity)]}</span></td>
                          <td className="tnum text-right">{p.severity === 'insufficient' ? 'n/a' : pp(p.relPp)}</td>
                          <td className="tnum text-right">{String(p.openCases)}</td>
                          <td className="tnum text-right">{String(p.complaints)}</td>
                          <td className={`tnum text-right ${Number(p.overdue) ? 'text-crit' : ''}`}>{String(p.overdue)}</td>
                          <td className="text-right">{Number(p.canDrill) ? <button type="button" onClick={() => push({ parent: String(p.id), sel: null })} className="btn-ghost btn-sm">Zoom in<Icon name="chevron-right" size={13} /></button> : <Link href={`/schools/${String(p.id)}`} className="btn-ghost btn-sm">School<Icon name="chevron-right" size={13} /></Link>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* Context panel */}
        <aside className="overflow-hidden rounded-xl border border-line bg-white xl:max-h-[max(420px,calc(100vh-300px))] xl:overflow-y-auto" aria-label="Area details">
          {!selected && !detail ? (
            <div>
              <div className="border-b border-line px-5 py-4">
                <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{LEVEL_NAME[data?.parent.level ?? ''] ?? 'Area'}</p>
                <h2 className="text-lg font-semibold tracking-tight text-ink">{data?.parent.name ?? '…'}</h2>
                <p className="mt-0.5 text-sm text-ink-faint">{features.length} {data?.childLevel ? `${LEVEL_NAME[data.childLevel] ?? data.childLevel}s` : 'areas'} · select one on the map</p>
              </div>
              <ul className="grid grid-cols-3 gap-px border-b border-line bg-line text-center">
                {counts.map((c) => (
                  <li key={c.s} className="bg-white px-2 py-2.5"><p className="tnum text-lg font-semibold text-ink">{c.n}</p><p className="flex items-center justify-center gap-1 text-2xs text-ink-faint"><span className="h-2 w-2 rounded-sm" style={{ background: SEVERITY_COLORS[c.s] }} />{SEVERITY_LABEL[c.s]}</p></li>
                ))}
              </ul>
              <div className="px-5 py-4">
                <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Most important hotspots</p>
                {top.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No statistically clear declines at this level.</p> : (
                  <ul className="mt-2 divide-y divide-line">
                    {top.map((f) => (
                      <li key={String(f.properties.id)}>
                        <button type="button" onClick={() => push({ sel: String(f.properties.id) })} className="flex w-full items-center gap-2.5 py-2 text-left hover:text-brand">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEVERITY_COLORS[String(f.properties.severity)] }} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{String(f.properties.name)}</span><span className="block truncate text-xs text-ink-faint">{f.properties.focus ? String(f.properties.focus) : SEVERITY_LABEL[String(f.properties.severity)]}{Number(f.properties.hotChildren) ? ` · ${String(f.properties.hotChildren)} hot inside` : ''}</span></span>
                          <span className="tnum text-sm font-semibold text-ink">{pp(f.properties.relPp)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{LEVEL_NAME[String(selected?.level ?? detail?.level)] ?? ''}</p>
                  <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{String(selected?.name ?? detail?.name ?? '')}</h2>
                  {selected ? <p className="mt-1 flex items-center gap-1.5 text-sm text-ink"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLORS[String(selected.severity)] }} />{SEVERITY_LABEL[String(selected.severity)]}{selected.severity !== 'insufficient' ? <span className="text-ink-soft">· {pp(selected.relPp)} vs district</span> : null}</p> : null}
                </div>
                <button type="button" onClick={() => push({ sel: null })} className="btn-ghost btn-sm px-1.5" aria-label="Close details"><Icon name="x" size={16} /></button>
              </div>
              {selected?.reason ? <p className="border-b border-line px-5 py-2.5 text-sm text-ink-soft">{String(selected.reason)}</p> : null}
              <dl className="grid grid-cols-2 gap-px border-b border-line bg-line">
                {[
                  ['Schools', detail?.schools ?? (selected?.schools as number) ?? '—'],
                  ['Open cases', detail?.caseCount ?? selected?.openCases ?? '—'],
                  ['Complaints', detail?.complaintCount ?? selected?.complaints ?? '—'],
                  ['Overdue work', selected?.overdue ?? '—'],
                ].map(([k, v]) => <div key={String(k)} className="bg-white px-4 py-2.5"><dt className="text-xs text-ink-faint">{String(k)}</dt><dd className="tnum text-md font-semibold text-ink">{String(v)}</dd></div>)}
              </dl>
              {detailState === 'loading' ? <div className="space-y-2 px-5 py-4"><div className="skeleton h-3 w-32" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /></div> : null}
              {detailState === 'error' ? <p className="px-5 py-4 text-sm text-crit">Could not load details for this area.</p> : null}
              {detail ? (
                <div className="space-y-4 px-5 py-4">
                  {detail.breakdown.length ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Most affected competencies</p>
                      <ul className="mt-1.5 space-y-1">
                        {detail.breakdown.map((b) => (
                          <li key={`${b.grade}${b.competency}`} className="flex items-center gap-2 text-sm">
                            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SEVERITY_COLORS[b.severity] }} />
                            <span className="min-w-0 flex-1 truncate text-ink-soft">Class {b.grade} · {b.competency}</span>
                            <span className="tnum text-ink-faint">{b.prev ?? '—'}→{b.curr ?? '—'}%</span>
                            <span className="tnum w-14 text-right font-medium text-ink">{b.severity === 'insufficient' ? 'n/a' : pp(b.rel)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {detail.cases.length ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Open cases</p>
                      <ul className="mt-1 divide-y divide-line">{detail.cases.map((c) => <li key={c.id}><Link href={`/cases/${c.id}`} className="block py-1.5 text-sm text-ink hover:text-brand"><span className="font-mono text-xs text-ink-faint">{c.id}</span> {c.title}</Link></li>)}</ul>
                    </div>
                  ) : null}
                  {detail.complaints.length ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Open complaints</p>
                      <ul className="mt-1 divide-y divide-line">{detail.complaints.map((c) => <li key={c.id}><Link href={`/complaints?open=${c.id}`} className="block py-1.5 text-sm text-ink hover:text-brand"><span className="font-mono text-xs text-ink-faint">{c.id}</span> {c.title}</Link></li>)}</ul>
                    </div>
                  ) : null}
                  <div className="rounded-lg bg-paper-sunk px-3 py-2 text-xs text-ink-soft">
                    <p>Data: {detail.compared ?? '—'}{detail.imported ? ` · imported ${new Date(detail.imported).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}</p>
                    {detail.warnings.map((w) => <p key={w} className="mt-0.5 flex items-start gap-1 text-warn"><Icon name="alert" size={12} className="mt-0.5" />{w}</p>)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Number(selected?.canDrill ?? 0) ? <button type="button" onClick={() => push({ parent: String(selected!.id), sel: null })} className="btn-primary btn-sm"><Icon name="layers" size={14} />Zoom in</button> : null}
                    {detail.level === 'school' ? <Link href={`/schools/${detail.id}`} className="btn-primary btn-sm"><Icon name="school" size={14} />Open school</Link> : null}
                    {['cluster', 'block'].includes(detail.level) ? <Link href={`/schools?${detail.level}=${detail.id}`} className="btn-quiet btn-sm">View schools</Link> : null}
                    <Link href={`/cases?status=open&${detail.level === 'block' ? `block=${detail.id}` : detail.level === 'cluster' ? `cluster=${detail.id}` : detail.level === 'district' ? `district=${detail.id}` : ''}`} className="btn-quiet btn-sm">View cases</Link>
                    <Link href={`/reports/new?type=block_performance`} className="btn-quiet btn-sm">Report</Link>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
