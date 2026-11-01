import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { PALETTE, PALETTE_DARK, SEVERITY, CHART, rgbChannels } from './src/lib/tokens';

/**
 * Design tokens — "civic intelligence workspace". The values live in src/lib/tokens.ts; this
 * file only turns them into CSS variables and Tailwind utilities.
 *
 * Every palette colour is a variable (`--c-ink`, `--c-brand-light`, …) and the utilities read
 * the variable, so `surface-dark` can re-point a whole region (a map, an evidence board) at the
 * dark palette without a single class changing inside it. Surfaces are flat: hairline borders,
 * elevation only for things that float (menus, drawers).
 */

const varName = (group: string, shade: string) => `--c-${group}${shade === 'DEFAULT' ? '' : `-${shade}`}`;

function cssVars(palette: Record<string, Partial<Record<string, string>>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [group, shades] of Object.entries(palette)) {
    for (const [shade, hex] of Object.entries(shades)) if (hex) out[varName(group, shade)] = rgbChannels(hex);
  }
  return out;
}

const colors = Object.fromEntries(
  Object.entries(PALETTE).map(([group, shades]) => [
    group,
    Object.fromEntries(Object.keys(shades).map((shade) => [shade, `rgb(var(${varName(group, shade)}) / <alpha-value>)`])),
  ]),
);

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...colors,
        sev: Object.fromEntries(Object.entries(SEVERITY).flatMap(([k, v]) => [
          [k, v.fill], [`${k}-text`, v.text], [`${k}-border`, v.border], [`${k}-on`, v.on],
        ])),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'var(--font-deva)', '"Segoe UI"', 'ui-sans-serif', 'system-ui', '"Noto Sans Devanagari"', 'sans-serif'],
        display: ['var(--font-serif)', 'var(--font-deva)', 'Georgia', '"Noto Sans Devanagari"', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: 'none',
        lift: '0 1px 2px rgba(16,30,56,0.06)',
        pop: '0 12px 32px -8px rgba(16,30,56,0.22), 0 2px 6px -2px rgba(16,30,56,0.08)',
      },
      borderRadius: { lg: '8px', xl: '12px', '2xl': '14px' },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-in': 'fade-in .16s ease-out both', 'slide-in': 'slide-in .18s ease-out both', shimmer: 'shimmer 1.4s infinite' },
    },
    // The type scale. Every text size in the app is one of these; sizes only, so line height
    // still comes from the surrounding text (1.5, or 1.65 for Hindi).
    fontSize: {
      '2xs': '11px',
      xs: '12px',
      sm: '13px',
      base: '14px',
      md: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '26px',
      '3xl': '34px',
      '4xl': '44px',
      '5xl': '52px',
    },
  },
  plugins: [
    plugin(({ addBase, addComponents }) => {
      addBase({
        ':root': {
          ...cssVars(PALETTE),
          '--surface-1': CHART.surface,
          '--series-1': CHART.series[0],
          '--series-2': CHART.series[1],
          '--series-3': CHART.series[2],
          '--status-good': CHART.status.good,
          '--status-warning': CHART.status.warning,
          '--status-serious': CHART.status.serious,
          '--status-critical': CHART.status.critical,
          '--viz-grid': CHART.grid,
          '--viz-axis': CHART.axis,
          '--viz-ink': CHART.ink,
          '--viz-ink-soft': CHART.inkSoft,
        },
      });
      addComponents({
        '.surface-dark': { ...cssVars(PALETTE_DARK), colorScheme: 'dark' },
      });
    }),
  ],
} satisfies Config;
