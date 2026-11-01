/**
 * Drawing the hotspot map on Google Maps.
 *
 * GeoMap keeps everything else (data loading, toolbar, legend, hover card, selection in the URL);
 * this module only puts the shapes, school dots and labels on a Google map and reports hover,
 * click and double-click back. It uses the Maps JavaScript API with polygons and advanced
 * markers. The key is the browser key in NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; the shapes come from
 * /api/geo/map, which only ever returns the reader's own area.
 */
import type { Feature, FeatureCollection, Position } from 'geojson';

/* The Maps JavaScript API is loaded at runtime and has no bundled types here. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

/** Why Google Maps is not drawing: the key was refused, its daily quota is spent, or the script never arrived. */
export type Refusal = 'key' | 'quota' | 'unreachable';

let loading: Promise<G> | null = null;
let refused: Refusal | null = null;
const refusalListeners = new Set<(why: Refusal) => void>();

function refuse(why: Refusal): void {
  if (refused) return;
  refused = why;
  for (const cb of refusalListeners) cb(why);
}

/**
 * Google checks the key after the script has loaded, so a refusal can arrive after "ready".
 * Whoever drew a map is told why, and falls back to the plain map.
 */
export function onKeyRefused(cb: (why: Refusal) => void): () => void {
  if (refused) { cb(refused); return () => {}; }
  refusalListeners.add(cb);
  return () => { refusalListeners.delete(cb); };
}

// A key over its daily quota (Google's free "Demo Key" has a small one) is reported by the Maps
// script as an uncaught error rather than through gm_authFailure. Treat it as a refusal too.
const QUOTA_RE = /Maps.*(limit reached|quota)|OverQuotaMapError|OverDailyLimit/i;

/** Load the Maps JavaScript API once per page. Rejects when the script cannot be reached. */
export function loadGoogleMaps(key: string): Promise<G> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.maps?.Map) { resolve(w.google.maps); return; }
    w.__kvMapsReady = () => resolve(w.google.maps);
    // Google calls this when the key is missing, wrong, or not allowed for this site.
    w.gm_authFailure = () => {
      refuse('key');
      reject(new Error('Google Maps refused the API key.'));
    };
    window.addEventListener('error', (e) => {
      if (QUOTA_RE.test(String(e.message ?? e.error?.message ?? ''))) { e.preventDefault(); refuse('quota'); reject(new Error('Google Maps refused: daily quota reached.')); }
    });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker&loading=async&callback=__kvMapsReady`;
    s.async = true;
    s.onerror = () => { refuse('unreachable'); reject(new Error('Google Maps refused: could not reach Google.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export interface Handlers {
  onHover: (p: Record<string, unknown> | null, x: number, y: number) => void;
  onClick: (p: Record<string, unknown>) => void;
  onDblClick: (p: Record<string, unknown>) => void;
}

export interface DrawOptions {
  colourOf: (p: Record<string, unknown>) => string;
  /** Faint fill for areas with no data, so the real map shows through. */
  faint: (p: Record<string, unknown>) => boolean;
  labelOf: (p: Record<string, unknown>, isPoint: boolean) => HTMLElement | null;
  dotSize: (p: Record<string, unknown>) => number;
  selectedId: string | null;
  ink: string;
}

const toPaths = (coords: Position[][]) => coords.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));

export class GoogleMapView {
  private maps: G;
  map: G;
  private shapes: G[] = [];
  private markers: G[] = [];
  private el: HTMLElement;
  private h: Handlers;

  constructor(maps: G, el: HTMLElement, h: Handlers, o: { controlsAt?: 'top-right' | 'top-center' } = {}) {
    this.maps = maps; this.el = el; this.h = h;
    this.map = new maps.Map(el, {
      // Fit an area snugly rather than to the nearest whole zoom step.
      isFractionalZoomEnabled: true,
      // Google's own map id for development; advanced markers need one.
      mapId: 'DEMO_MAP_ID',
      center: { lat: 26.85, lng: 80.95 }, zoom: 6,
      disableDoubleClickZoom: true, clickableIcons: false, streetViewControl: false,
      fullscreenControl: false, mapTypeControl: true, gestureHandling: 'greedy',
      mapTypeControlOptions: { position: o.controlsAt === 'top-center' ? maps.ControlPosition.TOP_CENTER : maps.ControlPosition.TOP_RIGHT },
    });
  }

  private rel(e: MouseEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  clear(): void {
    for (const s of this.shapes) s.setMap(null);
    for (const m of this.markers) m.map = null;
    this.shapes = []; this.markers = [];
  }

  draw(fc: FeatureCollection, outline: Feature | null, o: DrawOptions): void {
    this.clear();
    const { maps, map } = this;
    if (outline && (outline.geometry.type === 'Polygon' || outline.geometry.type === 'MultiPolygon')) {
      const rings = outline.geometry.type === 'Polygon' ? outline.geometry.coordinates : outline.geometry.coordinates.flat();
      this.shapes.push(new maps.Polygon({ paths: toPaths(rings), map, fillOpacity: 0, strokeColor: o.ink, strokeWeight: 2, clickable: false, zIndex: 1 }));
    }
    for (const f of fc.features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const g = f.geometry;
      const selected = p.id === o.selectedId;
      if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
        const faint = o.faint(p);
        const poly = new maps.Polygon({
          paths: toPaths(rings), map,
          fillColor: o.colourOf(p), fillOpacity: faint ? 0.06 : 0.5,
          strokeColor: selected ? o.ink : '#ffffff', strokeWeight: selected ? 3 : 1, strokeOpacity: faint ? 0.6 : 0.95,
          zIndex: selected ? 3 : 2,
        });
        poly.addListener('mousemove', (e: G) => { const [x, y] = this.rel(e.domEvent); this.h.onHover(p, x, y); poly.setOptions({ fillOpacity: faint ? 0.12 : 0.68 }); });
        poly.addListener('mouseout', () => { this.h.onHover(null, 0, 0); poly.setOptions({ fillOpacity: faint ? 0.06 : 0.5 }); });
        poly.addListener('click', () => this.h.onClick(p));
        poly.addListener('dblclick', () => this.h.onDblClick(p));
        this.shapes.push(poly);
      } else if (g.type === 'Point') {
        const [lng, lat] = g.coordinates;
        const size = o.dotSize(p);
        const dot = document.createElement('div');
        dot.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${o.colourOf(p)};`
          + `border:2px solid ${selected ? o.ink : '#ffffff'};box-shadow:0 1px 3px rgba(16,30,56,.35);cursor:pointer;`;
        dot.addEventListener('mousemove', (e) => { const [x, y] = this.rel(e); this.h.onHover(p, x, y); });
        dot.addEventListener('mouseleave', () => this.h.onHover(null, 0, 0));
        dot.addEventListener('click', () => this.h.onClick(p));
        dot.addEventListener('dblclick', () => this.h.onDblClick(p));
        this.markers.push(new maps.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: dot, zIndex: selected ? 30 : 20, gmpClickable: true }));
      }
      const label = o.labelOf(p, g.type === 'Point');
      const at = g.type === 'Point' ? g.coordinates : [Number(p.lon), Number(p.lat)];
      if (label && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
        label.style.pointerEvents = 'none';
        // Lift a school's label clear of its dot (the marker anchors at the bottom centre).
        if (g.type === 'Point') label.style.marginBottom = `${Math.round(o.dotSize(p) / 2) + 2}px`;
        this.markers.push(new maps.marker.AdvancedMarkerElement({ map, position: { lat: at[1], lng: at[0] }, content: label, zIndex: selected ? 40 : 10 }));
      }
    }
  }

  fit(bbox: number[] | null, padding: number | { top: number; right: number; bottom: number; left: number } = 40): void {
    if (!bbox) return;
    this.map.fitBounds({ west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }, padding);
  }

  destroy(): void { this.clear(); }
}
