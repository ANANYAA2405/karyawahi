/**
 * Illustrative geography generator.
 *
 * The demo state is fictional, so no real boundary or coordinate exists for any of its units.
 * Rather than draw fictional districts on top of real places, this builds a self-contained,
 * clearly illustrative geography: a hex grid shaped like a state, partitioned recursively into
 * districts → blocks → clusters by seeded nearest-centre assignment, so every child sits
 * exactly inside its parent and neighbours share edges. Boundaries are the union of a unit's
 * hexes. School points are placed inside their cluster's hexes.
 *
 * Coordinates sit around (0°, 0°) — open ocean — so the shapes cannot be mistaken for a real
 * place even if a basemap were ever added. Everything produced here is tagged
 * geometry_source = 'illustrative'. Pure and deterministic: same input, same shapes.
 */

export interface GenInput {
  districts: { id: string; schools: number }[];
  blocks: { id: string; district_id: string; schools: number }[];
  clusters: { id: string; block_id: string; schools: number }[];
  schools: { id: string; cluster_id: string }[];
}

export type Ring = [number, number][];
export interface GenUnit { id: string; rings: Ring[]; centroid: [number, number]; bbox: [number, number, number, number] }
export interface GenOutput { state: GenUnit; units: Map<string, GenUnit>; schoolPoints: Map<string, [number, number]>; hexOf: Map<string, string[]> }

// Small deterministic hash → [0,1)
function h(...xs: (string | number)[]): number {
  let a = 2166136261;
  for (const x of xs.join('|')) { a ^= x.charCodeAt(0); a = Math.imul(a, 16777619); }
  a ^= a >>> 13; a = Math.imul(a, 0x5bd1e995); a ^= a >>> 15;
  return (a >>> 0) / 4294967296;
}

const SQ3 = Math.sqrt(3);
const key = (q: number, r: number) => `${q},${r}`;

/**
 * A hex grid: cell size in degrees of latitude, an origin, and how much to stretch longitude so
 * cells stay regular away from the equator. The illustrative state uses the default, at (0°, 0°);
 * real districts each get a small grid of their own.
 */
export interface Grid { size: number; origin: [number, number]; lonScale: number }
const ILLUSTRATIVE: Grid = { size: 0.022, origin: [0, 0], lonScale: 1 };
export const gridAt = (size: number, origin: [number, number]): Grid =>
  ({ size, origin, lonScale: 1 / Math.cos((origin[1] * Math.PI) / 180) });

const center = (q: number, r: number, g: Grid = ILLUSTRATIVE): [number, number] =>
  [g.origin[0] + g.size * g.lonScale * SQ3 * (q + r / 2), g.origin[1] - g.size * 1.5 * r];
const corner = (c: [number, number], i: number, g: Grid = ILLUSTRATIVE): [number, number] => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [Math.round((c[0] + g.size * g.lonScale * Math.cos(a)) * 1e6) / 1e6, Math.round((c[1] + g.size * Math.sin(a)) * 1e6) / 1e6];
};
const SIZE = ILLUSTRATIVE.size;

function bboxOf(points: [number, number][]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of points) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

/** Union boundary of a set of hexes: keep edges used once, then chain them into rings. */
function rings(hexes: string[], g: Grid = ILLUSTRATIVE): Ring[] {
  const edgeCount = new Map<string, { a: string; b: string; n: number }>();
  const pt = new Map<string, [number, number]>();
  for (const hk of hexes) {
    const [q, r] = hk.split(',').map(Number);
    const c = center(q, r, g);
    const cs = [0, 1, 2, 3, 4, 5].map((i) => corner(c, i, g));
    for (let i = 0; i < 6; i++) {
      const p1 = cs[i], p2 = cs[(i + 1) % 6];
      const k1 = `${p1[0]},${p1[1]}`, k2 = `${p2[0]},${p2[1]}`;
      pt.set(k1, p1); pt.set(k2, p2);
      const ek = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const e = edgeCount.get(ek);
      if (e) e.n++; else edgeCount.set(ek, { a: k1, b: k2, n: 1 });
    }
  }
  const adj = new Map<string, string[]>();
  for (const e of edgeCount.values()) {
    if (e.n !== 1) continue;
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const used = new Set<string>();
  const out: Ring[] = [];
  for (const start of adj.keys()) {
    for (const first of adj.get(start)!) {
      const ek0 = start < first ? `${start}|${first}` : `${first}|${start}`;
      if (used.has(ek0)) continue;
      const ring: string[] = [start];
      let prev = start, cur = first;
      used.add(ek0);
      while (cur !== start && ring.length < 100000) {
        ring.push(cur);
        const next = (adj.get(cur) ?? []).find((n) => {
          const ek = cur < n ? `${cur}|${n}` : `${n}|${cur}`;
          return n !== prev && !used.has(ek);
        }) ?? (adj.get(cur) ?? []).find((n) => {
          const ek = cur < n ? `${cur}|${n}` : `${n}|${cur}`;
          return !used.has(ek);
        });
        if (!next) break;
        used.add(cur < next ? `${cur}|${next}` : `${next}|${cur}`);
        prev = cur; cur = next;
      }
      if (ring.length >= 3) out.push([...ring.map((k) => pt.get(k)!), pt.get(start)!]);
    }
  }
  return out;
}

/** Assign each hex in `pool` to one of `n` regions, sized roughly by `weights`. */
function partition(pool: string[], ids: string[], weights: number[], salt: string, g: Grid = ILLUSTRATIVE): Map<string, string[]> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 1) { out.set(ids[0], [...pool]); return out; }
  const pts = pool.map((k) => { const [q, r] = k.split(',').map(Number); return { k, c: center(q, r, g) }; });
  // Farthest-point seeds, starting from a deterministic hex.
  const seeds: [number, number][] = [pts[Math.floor(h(salt, 'start') * pts.length)].c];
  while (seeds.length < ids.length) {
    let best = pts[0], bestD = -1;
    for (const p of pts) {
      const d = Math.min(...seeds.map((s) => (s[0] - p.c[0]) ** 2 + (s[1] - p.c[1]) ** 2));
      if (d > bestD) { bestD = d; best = p; }
    }
    seeds.push(best.c);
  }
  // A few Lloyd iterations with weights, so region sizes follow school counts.
  const total = weights.reduce((a, b) => a + b, 0);
  let assign = new Map<string, number>();
  for (let it = 0; it < 6; it++) {
    assign = new Map();
    const scale = ids.map((_, i) => Math.sqrt(weights[i] / total));
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const d = Math.sqrt((seeds[i][0] - p.c[0]) ** 2 + (seeds[i][1] - p.c[1]) ** 2) / (0.6 + scale[i]) * (0.92 + 0.16 * h(salt, p.k, i));
        if (d < bd) { bd = d; bi = i; }
      }
      assign.set(p.k, bi);
    }
    const sums = seeds.map(() => [0, 0, 0]);
    for (const p of pts) { const s = sums[assign.get(p.k)!]; s[0] += p.c[0]; s[1] += p.c[1]; s[2]++; }
    for (let i = 0; i < seeds.length; i++) if (sums[i][2] > 0) seeds[i] = [sums[i][0] / sums[i][2], sums[i][1] / sums[i][2]];
  }
  // Contiguity: keep each region's largest connected piece; hand stray hexes to the
  // neighbouring region they touch most. Repeat until stable, so every unit is one shape.
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  const inPool = new Set(pool);
  for (let pass = 0; pass < 8; pass++) {
    let moved = 0;
    for (let i = 0; i < ids.length; i++) {
      const mine = pts.filter((p) => assign.get(p.k) === i).map((p) => p.k);
      const set = new Set(mine);
      const seen = new Set<string>();
      const comps: string[][] = [];
      for (const s0 of mine) {
        if (seen.has(s0)) continue;
        const comp: string[] = []; const stack = [s0]; seen.add(s0);
        while (stack.length) {
          const k = stack.pop()!; comp.push(k);
          const [q, r] = k.split(',').map(Number);
          for (const [dq, dr] of NB) { const nk = key(q + dq, r + dr); if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); } }
        }
        comps.push(comp);
      }
      comps.sort((a, b) => b.length - a.length);
      for (const comp of comps.slice(1)) {
        for (const k of comp) {
          const [q, r] = k.split(',').map(Number);
          const votes = new Map<number, number>();
          for (const [dq, dr] of NB) {
            const nk = key(q + dq, r + dr);
            if (!inPool.has(nk)) continue;
            const a = assign.get(nk)!;
            if (a !== i) votes.set(a, (votes.get(a) ?? 0) + 1);
          }
          const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
          if (best) { assign.set(k, best[0]); moved++; }
        }
      }
    }
    if (moved === 0) break;
  }
  for (const p of pts) out.get(ids[assign.get(p.k)!])!.push(p.k);
  // Never leave a region empty: give it the hex nearest its seed taken from the largest region.
  for (let i = 0; i < ids.length; i++) {
    if (out.get(ids[i])!.length > 0) continue;
    const big = [...out.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const take = big[1].pop()!;
    out.get(ids[i])!.push(take);
  }
  return out;
}

export function generateGeography(input: GenInput): GenOutput {
  const totalSchools = input.schools.length;
  // Roughly 1.6 hexes per school, in a lumpy state-shaped blob.
  const target = Math.max(200, Math.round(totalSchools * 1.6));
  const R = Math.ceil(Math.sqrt(target / 2.6));
  const pool: string[] = [];
  for (let q = -R * 2; q <= R * 2; q++) {
    for (let r = -R * 2; r <= R * 2; r++) {
      const [x, y] = center(q, r);
      const ang = Math.atan2(y, x);
      const radius = SIZE * 1.5 * R * (1 + 0.18 * Math.sin(3 * ang + 0.7) + 0.1 * Math.cos(5 * ang) + 0.06 * (h('edge', q, r) - 0.5));
      if (Math.hypot(x * 0.9, y * 1.15) <= radius) pool.push(key(q, r));
    }
  }

  const hexOf = new Map<string, string[]>();
  const dParts = partition(pool, input.districts.map((d) => d.id), input.districts.map((d) => Math.max(1, d.schools)), 'districts');
  for (const [did, dh] of dParts) {
    hexOf.set(did, dh);
    const bs = input.blocks.filter((b) => b.district_id === did);
    const bParts = partition(dh, bs.map((b) => b.id), bs.map((b) => Math.max(1, b.schools)), did);
    for (const [bid, bh] of bParts) {
      hexOf.set(bid, bh);
      const cs = input.clusters.filter((c) => c.block_id === bid);
      const cParts = partition(bh, cs.map((c) => c.id), cs.map((c) => Math.max(1, c.schools)), bid);
      for (const [cid, ch] of cParts) hexOf.set(cid, ch);
    }
  }

  const unit = (id: string, hexes: string[]): GenUnit => {
    const rs = rings(hexes);
    const cs = hexes.map((k) => { const [q, r] = k.split(',').map(Number); return center(q, r); });
    const cx = cs.reduce((a, c) => a + c[0], 0) / cs.length;
    const cy = cs.reduce((a, c) => a + c[1], 0) / cs.length;
    // Use the hex centre nearest the mean, so labels always land inside the shape.
    const near = cs.reduce((b, c) => ((c[0] - cx) ** 2 + (c[1] - cy) ** 2 < (b[0] - cx) ** 2 + (b[1] - cy) ** 2 ? c : b), cs[0]);
    return { id, rings: rs, centroid: [Math.round(near[0] * 1e6) / 1e6, Math.round(near[1] * 1e6) / 1e6], bbox: bboxOf(rs.flat()) };
  };

  const units = new Map<string, GenUnit>();
  for (const [id, hexes] of hexOf) units.set(id, unit(id, hexes));

  const schoolPoints = new Map<string, [number, number]>();
  const byCluster = new Map<string, string[]>();
  for (const s of input.schools) byCluster.set(s.cluster_id, [...(byCluster.get(s.cluster_id) ?? []), s.id]);
  for (const [cid, sids] of byCluster) {
    const hexes = hexOf.get(cid) ?? [];
    sids.forEach((sid, i) => {
      const hk = hexes[i % Math.max(1, hexes.length)];
      if (!hk) return;
      const [q, r] = hk.split(',').map(Number);
      const c = center(q, r);
      const a = h(sid, 'a') * Math.PI * 2, d = SIZE * 0.55 * Math.sqrt(h(sid, 'd'));
      schoolPoints.set(sid, [Math.round((c[0] + d * Math.cos(a)) * 1e6) / 1e6, Math.round((c[1] + d * Math.sin(a)) * 1e6) / 1e6]);
    });
  }

  return { state: unit('STATE', pool), units, schoolPoints, hexOf };
}

/** Union of several units' hexes (for city areas made of clusters). */
export function unionUnit(id: string, hexes: string[], g: Grid = ILLUSTRATIVE): GenUnit {
  const rs = rings(hexes, g);
  const cs = hexes.map((k) => { const [q, r] = k.split(',').map(Number); return center(q, r, g); });
  const cx = cs.reduce((a, c) => a + c[0], 0) / cs.length;
  const cy = cs.reduce((a, c) => a + c[1], 0) / cs.length;
  return { id, rings: rs, centroid: [cx, cy], bbox: bboxOf(rs.flat()) };
}

/** GeoJSON MultiPolygon from rings: a ring inside another becomes that polygon's hole. */
export function toMultiPolygon(rs: Ring[]): { type: 'MultiPolygon'; coordinates: Ring[][] } {
  const area = (r: Ring) => Math.abs(r.reduce((a, p, i) => { const n = r[(i + 1) % r.length]; return a + p[0] * n[1] - n[0] * p[1]; }, 0) / 2);
  const inside = (pt: [number, number], r: Ring) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const sorted = [...rs].sort((a, b) => area(b) - area(a));
  const polys: Ring[][] = [];
  for (const r of sorted) {
    // A ring's midpoint of its first edge, nudged, is a safe test point for containment.
    const probe: [number, number] = [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2];
    const host = polys.find((p) => inside(probe, p[0]) && !p.slice(1).some((hole) => inside(probe, hole)));
    if (host && polys.length) host.push(r); else polys.push([r]);
  }
  return { type: 'MultiPolygon', coordinates: polys };
}

// ---------------------------------------------------------------- inside real boundaries
export type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

const outerRings = (g: Geometry): Ring[] => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));

function insideRing(pt: [number, number], r: Ring): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const insideGeometry = (pt: [number, number], g: Geometry): boolean => outerRings(g).some((r) => insideRing(pt, r));

/** A circle of `km` around a point, as a closed ring (for an approximate city area). */
export function circleRing(c: [number, number], km: number, n = 64): Ring {
  const dLat = km / 111.32, dLon = dLat / Math.cos((c[1] * Math.PI) / 180);
  const out: Ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([Math.round((c[0] + dLon * Math.cos(a)) * 1e6) / 1e6, Math.round((c[1] + dLat * Math.sin(a)) * 1e6) / 1e6]);
  }
  return out;
}

export interface RealInput extends GenInput {
  /** Each demo district's real outline. */
  outlines: Map<string, Geometry>;
  /** Cell size in degrees of latitude; about 0.005 (≈ 550 m) gives smooth block lines. */
  cell?: number;
  /**
   * Real school positions (UDISE+, moved a few hundred metres). When a district's schools have
   * them, each cell goes to the cluster of its nearest school, so blocks and clusters are drawn
   * around where the schools really are, and each school is pinned at its own position.
   */
  points?: Map<string, [number, number]>;
}

/**
 * Blocks, clusters and school points for demo districts placed inside real district outlines.
 *
 * Each district's outline is filled with small hex cells, which are then divided among its
 * blocks and clusters exactly as the illustrative generator does, weighted by school counts.
 * The district keeps its real outline; the lines inside it are simulated, as is the data, and
 * are tagged that way. Deterministic: same input, same shapes.
 */
export function generateInsideReal(input: RealInput): Omit<GenOutput, 'state'> & { grids: Map<string, Grid> } {
  const cell = input.cell ?? 0.005;
  const hexOf = new Map<string, string[]>();
  const grids = new Map<string, Grid>();
  const units = new Map<string, GenUnit>();
  const schoolPoints = new Map<string, [number, number]>();

  for (const d of input.districts) {
    const outline = input.outlines.get(d.id);
    if (!outline) continue;
    const all = outerRings(outline).flat();
    const [x0, y0, x1, y1] = bboxOf(all);
    const g = gridAt(cell, [x0, y1]);
    grids.set(d.id, g);
    // Every cell whose centre lies inside the real outline.
    const pool: string[] = [];
    const rMax = Math.ceil((y1 - y0) / (cell * 1.5)) + 1;
    for (let r = -1; r <= rMax; r++) {
      const qMin = Math.floor(-r / 2) - 2, qMax = Math.ceil((x1 - x0) / (cell * g.lonScale * SQ3)) - Math.floor(r / 2) + 2;
      for (let q = qMin; q <= qMax; q++) {
        const c = center(q, r, g);
        if (c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1 && insideGeometry(c, outline)) pool.push(key(q, r));
      }
    }
    hexOf.set(d.id, pool);
    const bs = input.blocks.filter((b) => b.district_id === d.id);
    const blockIds = new Set(bs.map((b) => b.id));
    const placed = input.schools
      .filter((s) => input.points?.has(s.id) && input.clusters.some((c) => c.id === s.cluster_id && blockIds.has(c.block_id)))
      .map((s) => ({ cluster: s.cluster_id, p: input.points!.get(s.id)! }));
    if (placed.length) {
      // Real positions: every cell joins the cluster of its nearest school (a Voronoi split on the grid).
      const near = (c: [number, number]) => {
        let best = placed[0], bd = Infinity;
        for (const x of placed) {
          const dx = (x.p[0] - c[0]) / g.lonScale, dy = x.p[1] - c[1];
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = x; }
        }
        return best.cluster;
      };
      const byCluster = new Map<string, string[]>();
      for (const k of pool) {
        const [q, r] = k.split(',').map(Number);
        const cid = near(center(q, r, g));
        byCluster.set(cid, [...(byCluster.get(cid) ?? []), k]);
      }
      // A cluster whose schools all sit next to another cluster's still gets the cell nearest its first school.
      for (const x of placed) {
        if (byCluster.get(x.cluster)?.length) continue;
        let bk = pool[0], bd = Infinity;
        for (const k of pool) {
          const [q, r] = k.split(',').map(Number); const c = center(q, r, g);
          const dd = ((c[0] - x.p[0]) / g.lonScale) ** 2 + (c[1] - x.p[1]) ** 2;
          if (dd < bd) { bd = dd; bk = k; }
        }
        for (const [cid, ks] of byCluster) { const i = ks.indexOf(bk); if (i >= 0) { ks.splice(i, 1); byCluster.set(cid, ks); } }
        byCluster.set(x.cluster, [bk]);
      }
      for (const b of bs) {
        const cs = input.clusters.filter((c) => c.block_id === b.id);
        hexOf.set(b.id, cs.flatMap((c) => byCluster.get(c.id) ?? []));
        for (const c of cs) hexOf.set(c.id, byCluster.get(c.id) ?? []);
      }
    } else {
      const bParts = partition(pool, bs.map((b) => b.id), bs.map((b) => Math.max(1, b.schools)), d.id, g);
      for (const [bid, bh] of bParts) {
        hexOf.set(bid, bh);
        const cs = input.clusters.filter((c) => c.block_id === bid);
        const cParts = partition(bh, cs.map((c) => c.id), cs.map((c) => Math.max(1, c.schools)), bid, g);
        for (const [cid, ch] of cParts) hexOf.set(cid, ch);
      }
    }

    const unitOf = (id: string, hexes: string[]): GenUnit => {
      const cs = hexes.map((k) => { const [q, r] = k.split(',').map(Number); return center(q, r, g); });
      const cx = cs.reduce((a, c) => a + c[0], 0) / cs.length;
      const cy = cs.reduce((a, c) => a + c[1], 0) / cs.length;
      const near = cs.reduce((b, c) => ((c[0] - cx) ** 2 + (c[1] - cy) ** 2 < (b[0] - cx) ** 2 + (b[1] - cy) ** 2 ? c : b), cs[0]);
      // The district itself is drawn with its real outline; everything inside with its cells.
      const rs = id === d.id ? outerRings(outline) : rings(hexes, g);
      return { id, rings: rs, centroid: [Math.round(near[0] * 1e6) / 1e6, Math.round(near[1] * 1e6) / 1e6], bbox: bboxOf(rs.flat()) };
    };
    for (const id of [d.id, ...bs.map((b) => b.id), ...input.clusters.filter((c) => bs.some((b) => b.id === c.block_id)).map((c) => c.id)]) {
      const hexes = hexOf.get(id);
      if (hexes?.length) units.set(id, unitOf(id, hexes));
    }

    const clusterIds = new Set(input.clusters.filter((c) => bs.some((b) => b.id === c.block_id)).map((c) => c.id));
    const byCluster = new Map<string, string[]>();
    for (const s of input.schools) if (clusterIds.has(s.cluster_id)) byCluster.set(s.cluster_id, [...(byCluster.get(s.cluster_id) ?? []), s.id]);
    for (const [cid, sids] of byCluster) {
      const hexes = hexOf.get(cid) ?? [];
      sids.forEach((sid, i) => {
        const real = input.points?.get(sid);
        if (real) { schoolPoints.set(sid, real); return; }
        // Spread a cluster's schools over its cells rather than stacking them in the first few.
        const hk = hexes[Math.floor(((i + h(sid, 'pick')) / sids.length) * hexes.length) % Math.max(1, hexes.length)];
        if (!hk) return;
        const [q, r] = hk.split(',').map(Number);
        const c = center(q, r, g);
        const a = h(sid, 'a') * Math.PI * 2, dd = cell * 0.55 * Math.sqrt(h(sid, 'd'));
        const nudged: [number, number] = [Math.round((c[0] + dd * g.lonScale * Math.cos(a)) * 1e6) / 1e6, Math.round((c[1] + dd * Math.sin(a)) * 1e6) / 1e6];
        // Near the district edge a nudge can cross the real boundary; the cell centre never does.
        schoolPoints.set(sid, insideGeometry(nudged, outline) ? nudged : [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]);
      });
    }
  }
  return { units, schoolPoints, hexOf, grids };
}
