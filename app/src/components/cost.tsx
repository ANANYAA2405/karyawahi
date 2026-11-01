import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { Pill, Illustrative } from './labels';

/**
 * How an intervention card's cost is labelled. A cost from the UP PAB 2025-26 minutes carries
 * its page; a rate borrowed from a neighbouring PAB line says so; everything else stays
 * "illustrative". The page link opens the archived PDF at that page.
 */
export interface CostBasisLike {
  amount_inr: number; unit: string; note: string; illustrative: boolean;
  basis?: 'pab' | 'pab_proxy'; amount_composite_inr?: number | null; note_hi?: string;
  citation?: { doc: string; url: string; pdf_page: number; printed_page: string; line: string };
}

const UNIT_HI: Record<string, string> = {
  'per child': 'प्रति बच्चा', 'per teacher': 'प्रति शिक्षक', 'per school': 'प्रति विद्यालय', 'per school (travel)': 'प्रति विद्यालय (यात्रा)',
  'per case': 'प्रति प्रकरण', 'per post per year': 'प्रति पद प्रति वर्ष', 'per training batch': 'प्रति प्रशिक्षण बैच',
};
export const unitLabel = (unit: string, lang: Language): string => pick(lang, unit, UNIT_HI[unit] ?? unit);
export const costNote = (c: CostBasisLike, lang: Language): string => pick(lang, c.note, c.note_hi ?? c.note);
export const isRealCost = (c: CostBasisLike): boolean => !c.illustrative && !!c.citation;

/** The badge beside a cost: PAB line with page, a borrowed PAB rate, or illustrative. */
export function CostSource({ cost, lang }: { cost: CostBasisLike; lang: Language }) {
  if (!isRealCost(cost)) return <Illustrative lang={lang} />;
  const c = cost.citation!;
  const page = pick(lang, `p. ${c.pdf_page}`, `पृ. ${c.pdf_page}`);
  return (
    <a href={`${c.url}#page=${c.pdf_page}`} target="_blank" rel="noreferrer noopener" className="no-underline" title={`${c.doc} — ${c.line} (PDF page ${c.pdf_page}, printed page ${c.printed_page})`}>
      {cost.basis === 'pab'
        ? <Pill tone="good">{pick(lang, 'UP PAB 2025-26', 'उ.प्र. PAB 2025-26')} · {page}</Pill>
        : <Pill tone="active">{pick(lang, 'PAB rate, nearest line', 'PAB दर, निकटतम पंक्ति')} · {page}</Pill>}
    </a>
  );
}

/** "₹165 / per child" plus, for a per-school cost that differs by school type, the composite rate. */
export function costAmountText(cost: CostBasisLike, lang: Language, fmt: (n: number) => string): string {
  const base = `${fmt(cost.amount_inr)} ${unitLabel(cost.unit, lang)}`;
  return cost.amount_composite_inr ? `${base} ${pick(lang, `(composite school ${fmt(cost.amount_composite_inr)})`, `(कंपोज़िट विद्यालय ${fmt(cost.amount_composite_inr)})`)}` : base;
}
