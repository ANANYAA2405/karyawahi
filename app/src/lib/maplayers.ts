/**
 * Severity colours and labels shared by the map component (client) and pages (server).
 * Every map label also carries its value as text, so no status is carried by colour alone;
 * "insufficient data" is additionally drawn with a hatch pattern.
 */
import { SEVERITY } from './tokens';

/** Map fills from the shared severity ramp. MapLibre needs literal colours, not CSS variables. */
export const SEVERITY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(SEVERITY).map(([k, v]) => [k, v.fill]),
);
export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical decline', significant: 'Significant decline', moderate: 'Moderate concern', stable: 'Stable', improving: 'Improving', insufficient: 'Insufficient data',
};
