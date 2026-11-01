/**
 * Design tokens: the one place a colour is defined.
 *
 * Tailwind reads these (tailwind.config.ts turns them into CSS variables and utility classes),
 * the SVG charts read the CSS variables, and the map reads the hex values directly because
 * MapLibre paint expressions cannot resolve CSS variables. A colour that appears anywhere else
 * as a literal is a bug.
 *
 * No 'server-only' and no imports: tailwind.config.ts, server pages and client components all
 * load this file.
 */

/** The civic workspace palette: navy ink on an ivory canvas, teal for action, amber and
 *  terracotta for attention. Names are the ones the routes already use. */
export const PALETTE = {
  ink: { DEFAULT: '#101E38', soft: '#4A5568', faint: '#6B7385' },
  line: { DEFAULT: '#E6E2D8', strong: '#D3CEC2' },
  paper: { DEFAULT: '#FFFFFF', sunk: '#FAF9F5', deep: '#EFECE4' },
  ivory: { DEFAULT: '#F6F4EE', deep: '#EEEBE2' },
  mist: { DEFAULT: '#DDE5E8', light: '#EEF2F4' },
  navy: {
    DEFAULT: '#101E38', 950: '#0B1529', 900: '#101E38', 800: '#18294A', 700: '#22365C',
    600: '#3A5078', 300: '#93A2BD', 200: '#C3CCDC', 100: '#E8ECF3',
  },
  brand: { DEFAULT: '#167D78', dark: '#106561', light: '#E5F1F0', soft: '#6BB3AE' },
  good: { DEFAULT: '#167D78', light: '#E5F1F0' },
  amber: { DEFAULT: '#D9A441', light: '#FAF0DA' },
  warn: { DEFAULT: '#8A6416', light: '#FAF0DA' },
  crit: { DEFAULT: '#B94B3E', light: '#F8E7E4' },
  pend: { DEFAULT: '#5B4E8C', light: '#EEEBF6' },
  /** The map canvas (no basemap tiles) and the fill for a layer that is switched off. */
  map: { DEFAULT: '#ECEFEC', muted: '#F4F2EC' },
} as const;

/**
 * The same palette on a dark "evidence well": the surface for maps and linked charts, set
 * against the light paper of the narrative. Applied by the `surface-dark` class, which swaps
 * the variables, so every existing utility (text-ink, border-line, bg-paper) follows.
 */
export const PALETTE_DARK: { [K in keyof typeof PALETTE]?: Partial<Record<string, string>> } = {
  ink: { DEFAULT: '#E8ECF3', soft: '#B4BED0', faint: '#8E9AB0' },
  line: { DEFAULT: '#26375A', strong: '#34476D' },
  paper: { DEFAULT: '#132241', sunk: '#0F1C37', deep: '#1B2B4C' },
  ivory: { DEFAULT: '#0B1529', deep: '#101E38' },
  brand: { DEFAULT: '#4DB6AE', dark: '#3A9A93', light: '#163A3B', soft: '#2D6E6A' },
  good: { DEFAULT: '#4DB6AE', light: '#163A3B' },
  warn: { DEFAULT: '#E3B860', light: '#3A2F14' },
  crit: { DEFAULT: '#E58A7E', light: '#3D1F1C' },
  pend: { DEFAULT: '#A99BE0', light: '#272044' },
};

/**
 * One severity ramp for hotspots, map layers, chips and charts. `fill` is the tile or area,
 * `text` is the colour for words on a light surface, `border` edges a filled tile.
 * Insufficient data is never a colour alone: it is also hatched wherever it is drawn.
 */
export const SEVERITY = {
  critical: { fill: '#B94B3E', text: '#B94B3E', border: '#9E3E33', on: '#FFFFFF' },
  significant: { fill: '#D9774A', text: '#A8521F', border: '#C2622F', on: '#FFFFFF' },
  moderate: { fill: '#F2C14E', text: '#8A6416', border: '#E3B94F', on: '#101E38' },
  stable: { fill: '#DDE5E8', text: '#4A5568', border: '#CBD5DA', on: '#101E38' },
  improving: { fill: '#167D78', text: '#167D78', border: '#106561', on: '#FFFFFF' },
  insufficient: { fill: '#F3EFE6', text: '#6B7385', border: '#D3CEC2', on: '#4A5568' },
} as const;
export type Severity = keyof typeof SEVERITY;

/**
 * Chart roles. Series 1–3 are slots of a validated categorical palette, checked against the
 * white chart surface with --pairs all (CVD ΔE 9.2, normal-vision ΔE 24.0). Aqua is below 3:1
 * on white, so every chart using it also carries direct labels and a table view. Status colours
 * are the severity ramp, so a chart and a map say "critical" in the same colour.
 */
export const CHART = {
  surface: '#FFFFFF',
  series: ['#2A78D6', '#EB6834', '#1BAF7A'],
  status: {
    good: SEVERITY.improving.fill,
    warning: SEVERITY.moderate.border,
    serious: SEVERITY.significant.fill,
    critical: SEVERITY.critical.fill,
  },
  grid: '#EBE7DE',
  axis: '#898781',
  ink: '#101E38',
  inkSoft: '#52514E',
} as const;

/** "#167D78" → "22 125 120", the form Tailwind needs for colours with an alpha modifier. */
export function rgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
