'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { SERIES, STATUS_COLOR } from '@/lib/viz';

/**
 * Charts. Inline SVG, no chart library.
 *
 * Colour: categorical slots 1–3 of the validated palette (blue / orange / aqua), assigned by
 * entity and never by rank — the cluster is always blue and the district always orange, so a
 * filter that drops a series never repaints the others. Validated with --pairs all against
 * this app's white surface: CVD ΔE 9.2, normal-vision ΔE 24.0. Aqua sits below 3:1 on white,
 * so every chart here also carries direct labels and a table view (the relief rule).
 *
 * One y-axis, always. Where two measures of different scale need showing, they get two charts.
 */

// Re-exported for components that already import from here; the definition is in lib/viz.ts,
// where a server component can read it without going through the client boundary.
export { SERIES, STATUS_COLOR };

export interface Series {
  key: string;
  label: string;
  color: string;
  points: (number | null)[];
  dashed?: boolean;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null; // a single series is named by the title
  return (
    <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            aria-hidden
            className="inline-block rounded-sm"
            style={{ width: 10, height: 10, background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TableView({
  xLabels, series, unit = '%', caption,
}: { xLabels: string[]; series: Series[]; unit?: string; caption: string }) {
  return (
    <details className="mt-2 no-print">
      <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-soft">
        View as a table
      </summary>
      <table className="table mt-2">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            {xLabels.map((x) => <th key={x} scope="col">{x}</th>)}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.key}>
              <th scope="row" className="px-3 py-2 text-left text-base font-medium text-ink">{s.label}</th>
              {s.points.map((p, i) => (
                <td key={i} className="tnum">{p === null ? '—' : `${p.toFixed(1)}${unit}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ------------------------------------------------------------------ trend (line)
export function TrendChart({
  xLabels, series, yMax = 100, yLabel = '% at grade benchmark', caption, height = 230, markers = [],
}: {
  xLabels: string[];
  series: Series[];
  yMax?: number;
  yLabel?: string;
  caption: string;
  height?: number;
  /** Vertical annotations, e.g. the round the work started. */
  markers?: { at: number; label: string }[];
}) {
  const W = 760;
  const H = height;
  const PAD = { t: 14, r: 96, b: 30, l: 38 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = xLabels.length;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();

  const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - (Math.max(0, Math.min(yMax, v)) / yMax) * innerH;

  const ticks = useMemo(() => {
    const step = yMax <= 20 ? 5 : yMax <= 50 ? 10 : 25;
    const out: number[] = [];
    for (let v = 0; v <= yMax; v += step) out.push(v);
    return out;
  }, [yMax]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }

  return (
    <figure className="m-0">
      <Legend series={series} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto', maxHeight: H * 1.2 }}
        role="img"
        aria-labelledby={titleId}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>{caption}</title>

        {/* recessive grid */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + innerW} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD.l - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--viz-axis)" className="tnum">{v}</text>
          </g>
        ))}
        <text
          x={PAD.l - 7} y={PAD.t - 4} textAnchor="end" fontSize={9.5} fill="var(--viz-axis)"
        >{yLabel.includes('%') ? '%' : ''}</text>

        {/* x labels */}
        {xLabels.map((lab, i) => (
          <text key={lab + i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10.5} fill="var(--viz-axis)">{lab}</text>
        ))}

        {/* annotations */}
        {markers.map((m) => (
          <g key={`${m.at}-${m.label}`}>
            <line
              x1={x(m.at)} x2={x(m.at)} y1={PAD.t} y2={PAD.t + innerH}
              stroke="var(--viz-axis)" strokeWidth={1} strokeDasharray="3 3"
            />
            <text x={x(m.at) + 4} y={PAD.t + 9} fontSize={9.5} fill="var(--viz-axis)">{m.label}</text>
          </g>
        ))}

        {/* hover crosshair */}
        {hover !== null ? (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--viz-ink-soft)" strokeWidth={1} opacity={0.35} />
        ) : null}

        {/* series: 2px lines, ≥8px markers, 2px surface ring where marks overlap */}
        {series.map((s) => {
          const segs: string[] = [];
          let open = false;
          s.points.forEach((p, i) => {
            if (p === null) { open = false; return; }
            segs.push(`${open ? 'L' : 'M'}${x(i)},${y(p)}`);
            open = true;
          });
          const last = [...s.points].map((p, i) => ({ p, i })).filter((d) => d.p !== null).pop();
          return (
            <g key={s.key}>
              <path
                d={segs.join(' ')} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
              />
              {s.points.map((p, i) =>
                p === null ? null : (
                  <circle
                    key={i} cx={x(i)} cy={y(p)} r={hover === i ? 5.5 : 4.5}
                    fill={s.color} stroke="var(--surface-1)" strokeWidth={2}
                  />
                ),
              )}
              {/* direct label at the series end, so identity never rests on colour alone */}
              {last && last.p !== null ? (
                <text
                  x={x(last.i) + 9} y={y(last.p) + 3.5} fontSize={11} fill="var(--viz-ink-soft)"
                  className="tnum"
                >
                  {s.label.length > 15 ? `${s.label.slice(0, 14)}…` : s.label} {last.p.toFixed(1)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* tooltip */}
        {hover !== null ? (
          <g>
            {(() => {
              const rows = series.filter((s) => s.points[hover] !== null);
              const bw = 162;
              const bh = 20 + rows.length * 15;
              const bx = Math.min(x(hover) + 10, W - bw - 2);
              const by = PAD.t + 2;
              return (
                <>
                  <rect x={bx} y={by} width={bw} height={bh} rx={5} fill="var(--surface-1)" stroke="var(--viz-grid)" />
                  <text x={bx + 8} y={by + 14} fontSize={10.5} fontWeight={600} fill="var(--viz-ink)">{xLabels[hover]}</text>
                  {rows.map((s, k) => (
                    <g key={s.key}>
                      <rect x={bx + 8} y={by + 22 + k * 15} width={8} height={8} rx={2} fill={s.color} />
                      <text x={bx + 21} y={by + 29.5 + k * 15} fontSize={10.5} fill="var(--viz-ink-soft)">
                        {s.label}
                      </text>
                      <text x={bx + bw - 8} y={by + 29.5 + k * 15} fontSize={10.5} textAnchor="end" fill="var(--viz-ink)" className="tnum">
                        {(s.points[hover] as number).toFixed(1)}%
                      </text>
                    </g>
                  ))}
                </>
              );
            })()}
          </g>
        ) : null}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView xLabels={xLabels} series={series} caption={caption} />
    </figure>
  );
}

// ------------------------------------------------------------------ horizontal bars
export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Optional right-hand annotation, e.g. "42.3% → 24.4%". */
  note?: string;
  tone?: keyof typeof STATUS_COLOR;
}

/** Signed horizontal bars around a zero line. Used for per-school change in pp. */
export function DivergingBars({
  data, caption, unit = ' pp', height = 26,
}: { data: BarDatum[]; caption: string; unit?: string; height?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const W = 760;
  const labelW = 190;
  const noteW = 150;
  const plotW = W - labelW - noteW;
  const zero = labelW + plotW / 2;
  const titleId = useId();
  const H = Math.max(40, data.length * height + 24);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{caption}</title>
        <line x1={zero} x2={zero} y1={4} y2={H - 20} stroke="var(--viz-axis)" strokeWidth={1} />
        <text x={zero} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--viz-axis)">0</text>
        {data.map((d, i) => {
          const w = (Math.abs(d.value) / max) * (plotW / 2 - 8);
          const neg = d.value < 0;
          const yTop = 6 + i * height;
          const color = STATUS_COLOR[d.tone ?? (neg ? 'critical' : 'good')];
          return (
            <g
              key={d.key}
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              {/* a hit target larger than the mark */}
              <rect x={0} y={yTop - 2} width={W} height={height} fill={hover === d.key ? 'var(--viz-grid)' : 'transparent'} opacity={0.5} />
              <text x={labelW - 10} y={yTop + height / 2 - 1} textAnchor="end" fontSize={11.5} fill="var(--viz-ink)">
                {d.label.length > 26 ? `${d.label.slice(0, 25)}…` : d.label}
              </text>
              {/* 4px rounded data-end, anchored at zero */}
              <rect
                x={neg ? zero - w : zero} y={yTop + 3} width={Math.max(2, w)} height={height - 12} fill={color}
                rx={4}
              />
              <text
                x={neg ? zero - w - 7 : zero + w + 7} y={yTop + height / 2 - 1}
                textAnchor={neg ? 'end' : 'start'} fontSize={11} fill="var(--viz-ink)" className="tnum"
              >
                {d.value > 0 ? '+' : d.value < 0 ? '−' : ''}{Math.abs(d.value).toFixed(1)}{unit}
              </text>
              {d.note ? (
                <text x={W - 4} y={yTop + height / 2 - 1} textAnchor="end" fontSize={10.5} fill="var(--viz-ink-soft)" className="tnum">
                  {d.note}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ DiD interval
/**
 * The point estimate with its 95% interval, against zero and the success threshold.
 * This is the chart that must not overclaim: when the interval crosses zero the chart shows
 * it crossing zero, and the caller prints the parallel-trends caveat beside it.
 */
export function EffectInterval({
  did, ciLow, ciHigh, threshold, caption,
}: { did: number; ciLow: number | null; ciHigh: number | null; threshold: number; caption: string }) {
  const W = 760;
  const H = 104;
  const PAD = 30;
  const lo = Math.min(ciLow ?? did, 0, -threshold) - 4;
  const hi = Math.max(ciHigh ?? did, 0, threshold) + 4;
  const x = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
  const mid = 46;
  const titleId = useId();
  const crossesZero = ciLow !== null && ciHigh !== null && ciLow <= 0 && ciHigh >= 0;

  const ticks = useMemo(() => {
    const span = hi - lo;
    const step = span > 200 ? 100 : span > 80 ? 25 : span > 40 ? 10 : 5;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }, [lo, hi]);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{caption}</title>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={mid - 22} y2={mid + 22} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={x(v)} y={H - 26} fontSize={10} textAnchor="middle" fill="var(--viz-axis)" className="tnum">{v}</text>
          </g>
        ))}
        {/* zero and the success threshold */}
        <line x1={x(0)} x2={x(0)} y1={mid - 26} y2={mid + 26} stroke="var(--viz-ink-soft)" strokeWidth={1.5} />
        <text x={x(0)} y={mid - 31} fontSize={10} textAnchor="middle" fill="var(--viz-ink-soft)">no effect</text>
        <line x1={x(threshold)} x2={x(threshold)} y1={mid - 26} y2={mid + 26} stroke="var(--status-good)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={x(threshold)} y={H - 10} fontSize={10} textAnchor="middle" fill="var(--status-good)" className="tnum">
          target +{threshold}
        </text>

        {/* interval */}
        {ciLow !== null && ciHigh !== null ? (
          <>
            <line x1={x(ciLow)} x2={x(ciHigh)} y1={mid} y2={mid} stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" />
            <line x1={x(ciLow)} x2={x(ciLow)} y1={mid - 7} y2={mid + 7} stroke="var(--series-1)" strokeWidth={2} />
            <line x1={x(ciHigh)} x2={x(ciHigh)} y1={mid - 7} y2={mid + 7} stroke="var(--series-1)" strokeWidth={2} />
          </>
        ) : null}
        <circle cx={x(did)} cy={mid} r={6} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
        <text x={x(did)} y={mid + 23} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--viz-ink)" className="tnum">
          {did > 0 ? '+' : did < 0 ? '−' : ''}{Math.abs(did).toFixed(1)} pp
        </text>
      </svg>
      <p className="mt-1 text-xs leading-snug text-ink-soft">
        {ciLow === null || ciHigh === null
          ? 'No interval could be computed — too few schools with both rounds.'
          : crossesZero
            ? `95% interval ${ciLow.toFixed(1)} to ${ciHigh.toFixed(1)} pp. It crosses zero, so "no real change" stays consistent with this data.`
            : `95% interval ${ciLow.toFixed(1)} to ${ciHigh.toFixed(1)} pp — entirely ${ciLow > 0 ? 'above' : 'below'} zero.`}
      </p>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ slope (before → after)
/** Two groups, each measured twice. Shows the DiD as two slopes rather than four bars. */
export function SlopeChart({
  groups, xLabels, caption, yMax = 100,
}: {
  groups: { key: string; label: string; color: string; from: number | null; to: number | null }[];
  xLabels: [string, string];
  caption: string;
  yMax?: number;
}) {
  const W = 760;
  const H = 210;
  const PAD = { t: 16, r: 150, b: 28, l: 38 };
  const innerH = H - PAD.t - PAD.b;
  const xa = PAD.l + 40;
  const xb = W - PAD.r;
  const y = (v: number) => PAD.t + innerH - (Math.max(0, Math.min(yMax, v)) / yMax) * innerH;
  const titleId = useId();
  const ticks = [0, 25, 50, 75, 100].filter((v) => v <= yMax);

  return (
    <figure className="m-0">
      <Legend series={groups.map((g) => ({ key: g.key, label: g.label, color: g.color, points: [] }))} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{caption}</title>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={xb + 6} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD.l - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--viz-axis)" className="tnum">{v}</text>
          </g>
        ))}
        <text x={xa} y={H - 9} fontSize={10.5} textAnchor="middle" fill="var(--viz-axis)">{xLabels[0]}</text>
        <text x={xb} y={H - 9} fontSize={10.5} textAnchor="middle" fill="var(--viz-axis)">{xLabels[1]}</text>

        {groups.map((g) => {
          if (g.from === null || g.to === null) return null;
          const change = g.to - g.from;
          return (
            <g key={g.key}>
              <line x1={xa} x2={xb} y1={y(g.from)} y2={y(g.to)} stroke={g.color} strokeWidth={2} strokeLinecap="round" />
              <circle cx={xa} cy={y(g.from)} r={5} fill={g.color} stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={xb} cy={y(g.to)} r={5} fill={g.color} stroke="var(--surface-1)" strokeWidth={2} />
              <text x={xa - 10} y={y(g.from) + 3.5} textAnchor="end" fontSize={11} fill="var(--viz-ink)" className="tnum">
                {g.from.toFixed(1)}
              </text>
              <text x={xb + 10} y={y(g.to) + 3.5} fontSize={11} fill="var(--viz-ink)" className="tnum">
                {g.to.toFixed(1)} ({change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change).toFixed(1)})
              </text>
              <text x={xb + 10} y={y(g.to) + 16} fontSize={10} fill="var(--viz-ink-soft)">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ sparkline
export function Sparkline({
  points, width = 90, height = 22, color = SERIES.one, label,
}: { points: (number | null)[]; width?: number; height?: number; color?: string; label: string }) {
  const live = points.filter((p): p is number => p !== null);
  if (live.length < 2) return <span className="text-2xs text-ink-faint">—</span>;
  const min = Math.min(...live);
  const max = Math.max(...live);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const segs: string[] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p === null) { open = false; return; }
    segs.push(`${open ? 'L' : 'M'}${x(i)},${y(p)}`);
    open = true;
  });
  const lastIdx = points.map((p, i) => ({ p, i })).filter((d) => d.p !== null).pop()!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="align-middle">
      <path d={segs.join(' ')} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(lastIdx.i)} cy={y(lastIdx.p as number)} r={2.5} fill={color} />
    </svg>
  );
}
