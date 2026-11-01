/** Hotspot severity styles — a neutral module so server pages and client components share them.
 *  The colours are the severity ramp in tokens.ts, through Tailwind's `sev-*` utilities. */

export type Sev = 'critical' | 'significant' | 'moderate' | 'stable' | 'improving' | 'insufficient';
export const SEV_META: Record<Sev, { label: string; tile: string; dot: string; text: string }> = {
  critical: { label: 'Critical decline', tile: 'bg-sev-critical text-sev-critical-on border-sev-critical-border', dot: 'bg-sev-critical', text: 'text-sev-critical-text' },
  significant: { label: 'Significant decline', tile: 'bg-sev-significant text-sev-significant-on border-sev-significant-border', dot: 'bg-sev-significant', text: 'text-sev-significant-text' },
  moderate: { label: 'Moderate concern', tile: 'bg-sev-moderate text-sev-moderate-on border-sev-moderate-border', dot: 'bg-sev-moderate', text: 'text-sev-moderate-text' },
  stable: { label: 'Stable', tile: 'bg-sev-stable text-sev-stable-on border-sev-stable-border', dot: 'bg-sev-stable-border', text: 'text-sev-stable-text' },
  improving: { label: 'Improving', tile: 'bg-sev-improving text-sev-improving-on border-sev-improving-border', dot: 'bg-sev-improving', text: 'text-sev-improving-text' },
  insufficient: { label: 'Insufficient data', tile: 'bg-[repeating-linear-gradient(45deg,theme(colors.sev.insufficient)_0_5px,white_5px_10px)] text-sev-insufficient-on border-sev-insufficient-border border-dashed', dot: 'bg-paper-deep', text: 'text-sev-insufficient-text' },
};
