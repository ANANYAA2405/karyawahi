import type { Language } from '@domain/types';

/**
 * Real schools are never shown by their real name or UDISE code: the learning results beside
 * them are simulated. Each is labelled by its demo number and demo block, "School 0412 ·
 * Rampur Sadar", which is what schools.name holds. This turns that label into Hindi. Safe in
 * client and server code (no data access).
 */
export const BLOCK_HI: Record<string, string> = {
  'Rampur Sadar': 'रामपुर सदर', Bhatpura: 'भटपुरा', Kundanpur: 'कुंदनपुर', Saraiya: 'सरैया', Naugaon: 'नौगाँव', Belaghat: 'बेलाघाट',
  Kesarganj: 'केसरगंज', Motipur: 'मोतीपुर', Harinagar: 'हरिनगर', Chandrapur: 'चंद्रपुर', Sonbarsa: 'सोनबरसा', Dhanaura: 'धनौरा',
  Amarpur: 'अमरपुर', Kamalpur: 'कमलपुर', Indrapuri: 'इंद्रपुरी', Devkali: 'देवकली', Sundarpur: 'सुंदरपुर', Madhuban: 'मधुबन',
};

const LABEL = /^School (\d{4}) · (.+)$/;

export const schoolLabelEn = (schoolId: string, block: string): string => `School ${schoolId.slice(-4)} · ${block}`;
export const schoolLabelHi = (schoolId: string, block: string): string => `विद्यालय ${schoolId.slice(-4)} · ${BLOCK_HI[block] ?? block}`;

/** The school's display name in the reader's language. Names that are not an anonymised label pass through. */
export function schoolName(name: string | null | undefined, lang: Language): string {
  if (!name) return '';
  if (lang !== 'hi') return name;
  const m = LABEL.exec(name);
  return m ? `विद्यालय ${m[1]} · ${BLOCK_HI[m[2]] ?? m[2]}` : name;
}
