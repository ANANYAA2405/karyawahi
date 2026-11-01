'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MLMap, Marker, MapLayerMouseEvent, ExpressionSpecification } from 'maplibre-gl';
import { SEVERITY_COLORS, SEVERITY_LABEL } from '@/lib/maplayers';
import { PALETTE } from '@/lib/tokens';
import { Icon } from './Icon';
import type { FeatureCollection, Feature } from 'geojson';

/**
 * The interactive geographic map (MapLibre GL JS), in two modes:
 *
 *   compact   — a preview on dashboards; clicking opens the hotspot workspace or a school record.
 *   workspace — the map-first hotspot page: floating toolbar (layers, filters, legend, reset,
 *               map/list), independently selectable layers, URL state via the history API so
 *               selecting or drilling in never reloads the page.
 *
 * No third-party tiles: every shape comes from /api/geo/map, which returns only the user's
 * permitted geography. Labels are HTML markers (no glyph server needed).
 */

export interface MapPayload {
  parent: { id: string; name: string; level: string; bbox: number[] | null; geometry_source: string; note: string | null };
  childLevel: string | null;
  crumbs: { id: string; name: string; level: string }[];
  hierarchy: 'admin' | 'urban';
  hasUrban: boolean;
  features: FeatureCollection;
  outline: Feature | null;
  compared: string | null;
  sources: { geometry: string; attribution: string };
}

/** Status classes (which areas are coloured) and overlays (count badges on labels). */
export const STATUS_LAYERS = [
  { key: 'critical', label: 'Critical hotspots', sev: ['critical'], color: SEVERITY_COLORS.critical },
  { key: 'decline', label: 'Learning decline', sev: ['significant', 'moderate'], color: SEVERITY_COLORS.significant },
  { key: 'stable', label: 'Stable areas', sev: ['stable'], color: SEVERITY_COLORS.stable },
  { key: 'improving', label: 'Improving areas', sev: ['improving'], color: SEVERITY_COLORS.improving },
] as const;
export const OVERLAYS = [
  { key: 'complaints', label: 'Open complaints', prop: 'complaints', icon: 'inbox', cls: 'bg-pend text-white' },
  { key: 'overdue', label: 'Overdue actions', prop: 'overdue', icon: 'clock', cls: 'bg-amber text-ink' },
  { key: 'cases', label: 'Active cases', prop: 'openCases', icon: 'briefcase', cls: 'bg-navy text-white' },
] as const;
const DEFAULT_LAYERS = ['critical', 'decline', 'stable', 'improving'];

function fillExpr(active: Set<string>): ExpressionSpecification {
  const pairs: string[] = [];
  for (const s of STATUS_LAYERS) for (const sev of s.sev) pairs.push(sev, active.has(s.key) ? SEVERITY_COLORS[sev] : PALETTE.map.muted);
  return ['match', ['get', 'severity'], ...pairs, 'insufficient', SEVERITY_COLORS.insufficient, PALETTE.map.muted] as unknown as ExpressionSpecification;
}

function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const w = 12, h = 12, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = (x + y) % 6 === 0 || (x + y) % 6 === 1;
    const i = (y * w + x) * 4;
    data[i] = 69; data[i + 1] = 82; data[i + 2] = 106; data[i + 3] = on ? 150 : 0;
  }
  return { width: w, height: h, data };
}

export const LEVEL_NAME: Record<string, string> = { state: 'State', district: 'District', city: 'City', block: 'Block', cluster: 'Cluster', school: 'School' };
const pp = (v: unknown) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(1)} pp`);

function Popover({ label, icon, children, open, setOpen }: { label: string; icon: string; children: React.ReactNode; open: boolean; setOpen: (v: boolean) => void }) {
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium ${open ? 'bg-navy text-white' : 'text-ink-soft hover:bg-paper-deep hover:text-ink'}`}>
        <Icon name={icon} size={14} /><span className="sr-only sm:not-sr-only">{label}</span>
      </button>
      {open ? <div className="absolute left-0 top-full z-30 mt-1.5 w-64 animate-fade-in rounded-xl border border-line bg-white p-3 shadow-pop">{children}</div> : null}
    </div>
  );
}

export function GeoMap({ height = 560, compact = false, selectedId: selectedProp = null, basePath = '/hotspots', onData, rounds = [], competencies = [] }: {
  height?: number | string; compact?: boolean; selectedId?: string | null; basePath?: string;
  onData?: (d: MapPayload | null) => void; rounds?: { id: string; label: string }[]; competencies?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const [data, setData] = useState<MapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; p: Record<string, unknown> } | null>(null);
  const [pop, setPop] = useState<'layers' | 'filters' | null>(null);
  const [legend, setLegend] = useState(!compact);

  const workspace = !compact;
  const parent = sp.get('parent') ?? '';
  const hierarchy = sp.get('h') === 'urban' ? 'urban' : 'admin';
  const selectedId = workspace ? sp.get('sel') ?? selectedProp : selectedProp;
  const layers = new Set((sp.get('layers') ?? DEFAULT_LAYERS.join(',')).split(',').filter(Boolean));
  const layersKey = [...layers].sort().join(',');
  const filterKey = ['grade', 'comp', 'subject', 'round'].map((k) => `${k}=${sp.get(k) ?? ''}`).join('&');

  /** Workspace: update the URL in place (no server round-trip). Compact: navigate to the workspace. */
  const push = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(compact ? '' : sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    const qs = next.toString();
    if (compact) router.push(`${basePath}${qs ? `?${qs}` : ''}`);
    else window.history.pushState(null, '', `${pathname}${qs ? `?${qs}` : ''}`);
  }, [sp, router, pathname, compact, basePath]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (parent && workspace) qs.set('parent', parent);
      if (hierarchy === 'urban' && workspace) qs.set('h', 'urban');
      if (workspace) for (const k of ['grade', 'comp', 'subject', 'round']) { const v = sp.get(k); if (v) qs.set(k, v); }
      const r = await fetch(`/api/geo/map?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? 'The map could not be loaded.'); setData(null); onData?.(null); return; }
      setData(j); onData?.(j);
    } catch {
      setError('Could not reach the server for map data.');
    } finally { setLoading(false); }
  }, [parent, hierarchy, filterKey, workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  // ---- map init
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        libRef.current = lib;
        const map = new lib.Map({
          container: box.current,
          style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PALETTE.map.DEFAULT } }] },
          center: [0, 0], zoom: 6, attributionControl: false, doubleClickZoom: false, dragRotate: false, pitchWithRotate: false,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(new lib.AttributionControl({ compact: true, customAttribution: 'Illustrative geography · fictional state · MapLibre' }), 'bottom-right');
        map.touchZoomRotate.disableRotation();
        map.on('error', (e) => { if (String(e?.error?.message ?? '').includes('WebGL')) setMapError('This browser cannot draw the interactive map (WebGL unavailable).'); });
        map.on('load', () => {
          if (cancelled) return;
          map.addImage('hatch', hatchImage());
          map.addSource('outline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addSource('units', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
          map.addLayer({ id: 'outline-fill', type: 'fill', source: 'outline', paint: { 'fill-color': PALETTE.paper.DEFAULT, 'fill-opacity': 0.55 } });
          map.addLayer({ id: 'units-fill', type: 'fill', source: 'units', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': fillExpr(new Set(DEFAULT_LAYERS)), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.96, 0.85] } });
          map.addLayer({ id: 'units-hatch', type: 'fill', source: 'units', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'insufficient'], 1]], paint: { 'fill-pattern': 'hatch' } });
          map.addLayer({ id: 'units-line', type: 'line', source: 'units', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': PALETTE.paper.DEFAULT, 'line-width': 1.5 } });
          map.addLayer({ id: 'units-sel', type: 'line', source: 'units', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': PALETTE.ink.DEFAULT, 'line-width': 3 } });
          map.addLayer({ id: 'outline-line', type: 'line', source: 'outline', paint: { 'line-color': PALETTE.ink.DEFAULT, 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
          map.addLayer({ id: 'schools', type: 'circle', source: 'units', filter: ['==', ['geometry-type'], 'Point'], paint: {
            'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 9, 7], 'circle-color': fillExpr(new Set(DEFAULT_LAYERS)),
            'circle-stroke-color': ['case', ['==', ['get', 'insufficient'], 1], PALETTE.ink.soft, PALETTE.paper.DEFAULT], 'circle-stroke-width': 2 } });
          let hovered: string | number | undefined;
          const onMove = (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            if (hovered !== undefined && hovered !== f.id) map.setFeatureState({ source: 'units', id: hovered }, { hover: false });
            hovered = f.id; map.setFeatureState({ source: 'units', id: hovered! }, { hover: true });
            map.getCanvas().style.cursor = 'pointer';
            setHover({ x: e.point.x, y: e.point.y, p: f.properties as Record<string, unknown> });
          };
          const onLeave = () => {
            if (hovered !== undefined) map.setFeatureState({ source: 'units', id: hovered }, { hover: false });
            hovered = undefined; map.getCanvas().style.cursor = ''; setHover(null);
          };
          for (const l of ['units-fill', 'schools']) { map.on('mousemove', l, onMove); map.on('mouseleave', l, onLeave); }
          setReady(true);
        });
        mapRef.current = map;
      } catch (e) {
        setMapError(`The interactive map could not start: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; markers.current.forEach((m) => m.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // ---- click: select; double-click: drill in
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const click = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!p) return;
      if (compact && String(p.level) === 'school') { router.push(`/schools/${String(p.id)}`); return; }
      if (compact) { push({ sel: String(p.id) }); return; }
      push({ sel: String(p.id) });
    };
    const dbl = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (p && Number(p.canDrill) === 1) push({ parent: String(p.id), sel: null });
    };
    for (const l of ['units-fill', 'schools']) { map.on('click', l, click); map.on('dblclick', l, dbl); }
    return () => { for (const l of ['units-fill', 'schools']) { map.off('click', l, click); map.off('dblclick', l, dbl); } };
  }, [ready, push, compact, router]);

  // ---- data → sources + fit
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;
    (map.getSource('units') as import('maplibre-gl').GeoJSONSource).setData(data.features);
    (map.getSource('outline') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: data.outline ? [data.outline] : [] });
    if (data.parent.bbox) map.fitBounds(data.parent.bbox as [number, number, number, number], { padding: compact ? 24 : 56, duration: 600 });
  }, [data, ready, compact]);

  // ---- the container can be hidden (list view) and shown again: resize and refit when it reappears
  useEffect(() => {
    const map = mapRef.current;
    const el = box.current;
    if (!map || !ready || !el || typeof ResizeObserver === 'undefined') return;
    let wasHidden = el.clientWidth === 0;
    const ro = new ResizeObserver(() => {
      const hidden = el.clientWidth === 0 || el.clientHeight === 0;
      if (hidden) { wasHidden = true; return; }
      map.resize();
      if (wasHidden && data?.parent.bbox) map.fitBounds(data.parent.bbox as [number, number, number, number], { padding: compact ? 24 : 56, duration: 0 });
      wasHidden = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, data, compact]);

  // ---- paint, selection, labels
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !ready || !lib) return;
    map.setPaintProperty('units-fill', 'fill-color', fillExpr(layers));
    map.setPaintProperty('schools', 'circle-color', fillExpr(layers));
    map.setFilter('units-sel', ['==', ['get', 'id'], selectedId ?? '']);
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (!data) return;
    const many = data.features.features.length > 24;
    for (const f of data.features.features) {
      const p = f.properties as Record<string, unknown>;
      const isPoint = f.geometry.type === 'Point';
      const lon = isPoint ? (f.geometry as import('geojson').Point).coordinates[0] : Number(p.lon);
      const lat = isPoint ? (f.geometry as import('geojson').Point).coordinates[1] : Number(p.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const isSel = p.id === selectedId;
      const el = document.createElement('div');
      el.className = `pointer-events-none select-none rounded-md text-center leading-tight ${isSel ? 'bg-navy text-white shadow' : 'bg-white/90 text-ink'}`;
      el.style.cssText += `font-size:${isPoint && !isSel ? 10 : 11}px;padding:${isPoint && !isSel ? '0 4px' : '2px 6px'};${isPoint ? 'transform:translateY(-16px);' : ''}`;
      if ((!many && !isPoint) || isSel) { const n = document.createElement('div'); n.style.fontWeight = '600'; n.textContent = String(p.name); el.appendChild(n); }
      const v = document.createElement('div');
      v.style.fontVariantNumeric = 'tabular-nums';
      const hot = Number(p.hotChildren ?? 0);
      v.textContent = p.severity === 'insufficient' ? 'insufficient data' : `${pp(p.relPp)}${hot ? ` · ${hot} hot` : ''}`;
      el.appendChild(v);
      const badges = OVERLAYS.filter((o) => layers.has(o.key) && Number(p[o.prop] ?? 0) > 0);
      if (badges.length) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:3px;justify-content:center;margin-top:2px';
        for (const o of badges) {
          const b = document.createElement('span');
          b.className = `${o.cls} rounded-full`;
          b.style.cssText = 'font-size:10px;padding:0 5px;font-weight:600';
          b.textContent = `${o.key === 'complaints' ? 'C' : o.key === 'overdue' ? 'O' : 'A'} ${Number(p[o.prop])}`;
          b.title = `${Number(p[o.prop])} ${o.label.toLowerCase()}`;
          row.appendChild(b);
        }
        el.appendChild(row);
      }
      markers.current.push(new lib.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(map));
    }
  }, [layersKey, data, ready, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLayer = (k: string) => {
    const n = new Set(layers); if (n.has(k)) n.delete(k); else n.add(k);
    const v = [...n].sort().join(',');
    push({ layers: v === [...DEFAULT_LAYERS].sort().join(',') ? null : v || 'none' });
  };
  const setFilter = (k: string, v: string) => push({ [k]: v || null, sel: null });
  const sel = 'h-8 w-full rounded-md border border-line-strong bg-white px-2 text-sm text-ink';

  return (
    <div className={compact ? 'space-y-2' : ''}>
      <div className="relative overflow-hidden rounded-xl border border-line bg-map" style={{ height }}>
        {/* MapLibre forces position:relative on its container, so the sizing lives on a wrapper. */}
        <div className="absolute inset-0"><div ref={box} className="h-full w-full" role="application" aria-label={`Map of ${data?.parent.name ?? 'your area'}`} /></div>

        {workspace ? (
          <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-white/95 p-1 shadow-lift backdrop-blur" role="toolbar" aria-label="Map tools">
            <Popover label="Layers" icon="layers" open={pop === 'layers'} setOpen={(v) => setPop(v ? 'layers' : null)}>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Learning status</p>
              {STATUS_LAYERS.map((l) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-ink hover:bg-paper-sunk">
                  <input type="checkbox" checked={layers.has(l.key)} onChange={() => toggleLayer(l.key)} className="h-3.5 w-3.5 accent-brand" />
                  <span className="h-3 w-3 rounded-sm border border-line" style={{ background: l.color }} />{l.label}
                </label>
              ))}
              <p className="mb-1.5 mt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Overlays</p>
              {OVERLAYS.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-ink hover:bg-paper-sunk">
                  <input type="checkbox" checked={layers.has(o.key)} onChange={() => toggleLayer(o.key)} className="h-3.5 w-3.5 accent-brand" />
                  <span className={`rounded-full px-1.5 text-2xs font-semibold ${o.cls}`}>{o.key === 'complaints' ? 'C' : o.key === 'overdue' ? 'O' : 'A'}</span>{o.label}
                </label>
              ))}
              <p className="mt-2 text-2xs leading-snug text-ink-faint">Areas with too few students are always hatched — unknown, not stable.</p>
            </Popover>
            <Popover label="Filters" icon="filter" open={pop === 'filters'} setOpen={(v) => setPop(v ? 'filters' : null)}>
              <div className="space-y-2">
                <label className="block text-xs text-ink-soft">Class<select className={sel} value={sp.get('grade') ?? ''} onChange={(e) => setFilter('grade', e.target.value)}><option value="">All classes</option><option value="1">Class 1</option><option value="2">Class 2</option><option value="3">Class 3</option></select></label>
                <label className="block text-xs text-ink-soft">Subject<select className={sel} value={sp.get('subject') ?? ''} onChange={(e) => setFilter('subject', e.target.value)}><option value="">Both</option><option value="N">Numeracy</option><option value="L">Literacy</option></select></label>
                <label className="block text-xs text-ink-soft">Competency<select className={sel} value={sp.get('comp') ?? ''} onChange={(e) => setFilter('comp', e.target.value)}><option value="">All</option>{competencies.filter((c) => !sp.get('subject') || c.id.startsWith(`CMP-${sp.get('subject')}`)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                <label className="block text-xs text-ink-soft">Assessment period<select className={sel} value={sp.get('round') ?? ''} onChange={(e) => setFilter('round', e.target.value)}><option value="">Latest</option>{rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
                {filterKey !== 'grade=&comp=&subject=&round=' ? <button type="button" onClick={() => push({ grade: null, comp: null, subject: null, round: null })} className="text-xs font-medium text-brand hover:underline">Clear filters</button> : null}
              </div>
            </Popover>
            <button type="button" onClick={() => setLegend((v) => !v)} aria-pressed={legend} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium ${legend ? 'bg-paper-deep text-ink' : 'text-ink-soft hover:bg-paper-deep hover:text-ink'}`}><Icon name="info" size={14} /><span className="sr-only sm:not-sr-only">Legend</span></button>
            <button type="button" onClick={() => data?.parent.bbox && mapRef.current?.fitBounds(data.parent.bbox as [number, number, number, number], { padding: 56, duration: 500 })} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-soft hover:bg-paper-deep hover:text-ink"><Icon name="refresh" size={14} /><span className="sr-only sm:not-sr-only">Reset</span></button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <button type="button" onClick={() => push({ view: 'list' })} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-soft hover:bg-paper-deep hover:text-ink"><Icon name="list" size={14} /><span className="sr-only sm:not-sr-only">List</span></button>
          </div>
        ) : null}

        {loading ? <div className={`absolute z-10 flex items-center gap-2 rounded-md bg-white/95 px-2.5 py-1.5 text-xs text-ink-soft shadow ${workspace ? 'bottom-3 right-3' : 'left-3 top-3'}`}><span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />Loading map…</div> : null}
        {error || mapError ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ivory/90 p-6 text-center">
            <div>
              <Icon name="alert" size={26} className="mx-auto text-warn" />
              <p className="mt-2 font-medium text-ink">{mapError ?? error}</p>
              <div className="mt-3 flex justify-center gap-2">
                {error ? <button type="button" onClick={() => void load()} className="btn-quiet btn-sm">Retry</button> : null}
                <Link href={`${basePath}?view=list`} className="btn-quiet btn-sm">Use the list view</Link>
              </div>
            </div>
          </div>
        ) : null}
        {!loading && !error && data && data.features.features.length === 0 ? (
          <div className="absolute inset-x-0 top-1/2 z-10 mx-auto w-fit -translate-y-1/2 rounded-lg bg-white/95 px-4 py-2 text-sm text-ink-soft shadow">No mapped areas at this level.</div>
        ) : null}
        {hover ? (
          <div className="pointer-events-none absolute z-20 w-56 rounded-lg border border-line bg-white p-2.5 text-xs shadow-pop" style={{ left: Math.min(hover.x + 14, (box.current?.clientWidth ?? 600) - 236), top: Math.max(8, hover.y - 10) }}>
            <p className="text-sm font-semibold text-ink">{String(hover.p.name)}</p>
            <p className="text-2xs text-ink-faint">{LEVEL_NAME[String(hover.p.level)] ?? String(hover.p.level)}</p>
            <p className="mt-1 flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLORS[String(hover.p.severity)] }} />{SEVERITY_LABEL[String(hover.p.severity)]}{hover.p.severity !== 'insufficient' ? ` · ${pp(hover.p.relPp)}` : ''}</p>
            <p className="mt-1 text-ink-faint">{String(hover.p.openCases)} cases · {String(hover.p.complaints)} complaints · {String(hover.p.overdue)} overdue</p>
            <p className="mt-1 text-2xs text-ink-faint">{compact ? 'Click to open' : `Click to select${Number(hover.p.canDrill) ? ' · double-click to zoom in' : ''}`}</p>
          </div>
        ) : null}
        {workspace && legend ? (
          <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-line bg-white/95 p-2.5 text-xs shadow-lift">
            <ul className="space-y-0.5">
              {STATUS_LAYERS.map((l) => <li key={l.key} className={`flex items-center gap-1.5 ${layers.has(l.key) ? 'text-ink-soft' : 'text-ink-faint line-through'}`}><span className="h-2.5 w-3.5 rounded-sm border border-line" style={{ background: l.color }} />{l.label}</li>)}
              <li className="flex items-center gap-1.5 text-ink-soft"><span className="h-2.5 w-3.5 rounded-sm border border-line bg-[repeating-linear-gradient(45deg,rgba(69,82,106,.6)_0_2px,theme(colors.sev.insufficient)_2px_6px)]" />Insufficient data</li>
            </ul>
          </div>
        ) : null}
      </div>
      {compact ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft" aria-label="Legend">
          {STATUS_LAYERS.map((l) => <li key={l.key} className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-line" style={{ background: l.color }} />{l.label}</li>)}
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-line bg-[repeating-linear-gradient(45deg,rgba(69,82,106,.6)_0_2px,theme(colors.sev.insufficient)_2px_6px)]" />Insufficient data</li>
          <li className="ml-auto text-ink-faint">Illustrative geography · fictional state</li>
        </ul>
      ) : null}
    </div>
  );
}
