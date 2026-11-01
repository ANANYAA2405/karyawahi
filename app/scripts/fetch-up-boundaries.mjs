#!/usr/bin/env node
/**
 * Builds data/up-geo.json: the real outline of Uttar Pradesh, its 75 districts and the centres
 * of three cities, from OpenStreetMap (© OpenStreetMap contributors, ODbL).
 *
 * OSM stores a boundary as a set of line pieces; this joins them into closed shapes and
 * simplifies them so the file stays small. Run it again to refresh the boundaries:
 *
 *   node scripts/fetch-up-boundaries.mjs                 # downloads from the Overpass API
 *   node scripts/fetch-up-boundaries.mjs --raw up.json   # uses an earlier download
 *
 * Only public boundary data is requested; nothing about the app or its users is sent.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'up-geo.json');
const QUERY = '[out:json][timeout:280];area["ISO3166-2"="IN-UP"]["admin_level"="4"]->.up;'
  + '(relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="IN-UP"];'
  + 'relation(area.up)["boundary"="administrative"]["admin_level"="5"];);out geom;';

/** The three districts the demo's own districts are placed in, and the city each one shows. */
const CITIES = [
  { district: 'Rampur', name: 'Rampur', center: [79.0284337, 28.8014001], radius_km: 4 },
  { district: 'Lucknow', name: 'Lucknow', center: [80.9346001, 26.8381], radius_km: 12 },
  { district: 'Varanasi', name: 'Varanasi', center: [83.0076292, 25.3356491], radius_km: 8 },
];

const rawArg = process.argv.indexOf('--raw');
let raw;
if (rawArg > 0) raw = JSON.parse(readFileSync(process.argv[rawArg + 1], 'utf8'));
else {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: new URLSearchParams({ data: QUERY }),
    headers: { 'User-Agent': 'Karyavahi-demo/1.0 (boundary fetch for an education demo)' },
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  raw = await res.json();
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Join a relation's outer ways end to end into closed rings. */
function rings(rel) {
  const pieces = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length)
    .map((m) => m.geometry.map((p) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6]));
  const out = [];
  while (pieces.length) {
    let ring = pieces.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]; const end = ring[ring.length - 1];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat([...p].reverse().slice(1));
        else if (same(p[p.length - 1], ring[0])) ring = p.concat(ring.slice(1));
        else if (same(p[0], ring[0])) ring = [...p].reverse().concat(ring.slice(1));
        else continue;
        pieces.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) out.push(ring);
  }
  return out;
}

/** Douglas–Peucker simplification of a closed ring, in degrees. */
function simplify(ring, tol) {
  if (ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = ring[a], [x2, y2] = ring[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on the same point: measure from that point instead.
      const d = len < 1e-12
        ? Math.hypot(ring[i][0] - x1, ring[i][1] - y1)
        : Math.abs(dy * ring[i][0] - dx * ring[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const area = (r) => Math.abs(r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) / 2);
const shape = (rel, tol) => {
  const rs = rings(rel).map((r) => simplify(r, tol)).filter((r) => r.length >= 4).sort((a, b) => area(b) - area(a));
  // Drop slivers left by the simplification; keep anything above 0.5% of the main piece.
  const main = rs[0] ? area(rs[0]) : 0;
  const kept = rs.filter((r) => area(r) >= main * 0.005);
  return kept.length === 1 ? { type: 'Polygon', coordinates: kept } : { type: 'MultiPolygon', coordinates: kept.map((r) => [r]) };
};

const rels = raw.elements.filter((e) => e.type === 'relation');
const stateRel = rels.find((e) => e.tags.admin_level === '4');
const districtRels = rels.filter((e) => e.tags.admin_level === '5');
const nameOf = (e) => e.tags['name:en'] || e.tags.name;
const demoDistricts = new Set(CITIES.map((c) => c.district));

const out = {
  attribution: '© OpenStreetMap contributors (ODbL). Boundaries simplified for display.',
  source: 'https://www.openstreetmap.org — Overpass API',
  fetched_at: raw.osm3s?.timestamp_osm_base ?? null,
  state: { name: 'Uttar Pradesh', osm_id: stateRel.id, geometry: shape(stateRel, 0.004) },
  // The three demo districts keep more detail: they are the ones officers zoom into.
  districts: districtRels.map((e) => ({ name: nameOf(e), osm_id: e.id, geometry: shape(e, demoDistricts.has(nameOf(e)) ? 0.0008 : 0.003) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  cities: CITIES,
};

const missing = CITIES.filter((c) => !out.districts.some((d) => d.name === c.district));
if (missing.length) throw new Error(`Districts not found in OSM: ${missing.map((m) => m.district).join(', ')}`);
mkdirSync(join(process.cwd(), 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const pts = (g) => JSON.stringify(g.coordinates).split('],[').length;
console.log(`wrote ${OUT}: state ${pts(out.state.geometry)} points, ${out.districts.length} districts, `
  + `${out.districts.reduce((n, d) => n + pts(d.geometry), 0)} points in all`);
