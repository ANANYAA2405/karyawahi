import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { Pill } from './labels';

/**
 * Where a piece of proof was handed in, as the server judged it from the phone's GPS fix
 * (src/lib/proof-gps.ts): at the school (within 250 m), how far away, or not available.
 * Older rows carry only the status, so "away" without a distance is said without a number.
 */
export function fmtDistance(lang: Language, m: number): string {
  if (m >= 1000) {
    const km = (m / 1000).toFixed(m >= 10_000 ? 0 : 1);
    return pick(lang, `${km} km`, `${km} किमी`);
  }
  return pick(lang, `${Math.round(m)} m`, `${Math.round(m)} मीटर`);
}

export function gpsText(lang: Language, status: string, distance?: number | null): string {
  if (status === 'matched') return pick(lang, 'GPS: at the school', 'GPS: विद्यालय पर');
  if (status === 'outside_radius') {
    return distance !== null && distance !== undefined
      ? pick(lang, `GPS: ${fmtDistance(lang, distance)} away`, `GPS: ${fmtDistance(lang, distance)} दूर`)
      : pick(lang, 'GPS: away from the school', 'GPS: विद्यालय से दूर');
  }
  return pick(lang, 'GPS: not available', 'GPS: उपलब्ध नहीं');
}

export function GpsBadge({ status, distance, accuracy, lang }: {
  status: string; distance?: number | null; accuracy?: number | null; lang: Language;
}) {
  const tone = status === 'matched' ? 'good' : status === 'outside_radius' ? 'warn' : 'neutral';
  const title = accuracy !== null && accuracy !== undefined
    ? pick(lang, `Phone's accuracy ±${fmtDistance('en', accuracy)}. Checked by the server against the school's position (within 250 m counts as at the school).`,
      `फ़ोन की सटीकता ±${fmtDistance('hi', accuracy)}। सर्वर ने विद्यालय की स्थिति से जाँचा (250 मीटर के भीतर = विद्यालय पर)।`)
    : undefined;
  return <Pill tone={tone} title={title}>{gpsText(lang, status, distance)}</Pill>;
}
