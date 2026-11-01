import type { Language } from '@domain/types';
import { one } from '@/lib/db';
import { pick } from '@/lib/i18n';
import { OUTCOME_LABEL } from '@/lib/i18n';
import { Callout } from './ui';

const hasTable = (name: string) => !!one(`select 1 from sqlite_master where type = 'table' and name = ?`, name);

/**
 * Class 3 results were calibrated to PRS 2024 after this finding was decided. Its figures are
 * re-measured on the calibrated data; when that would move it across a detection gate, say so,
 * and say that the decision stands as it was made.
 */
export function FindingCalibrationNote({ findingId, lang }: { findingId: string; lang: Language }) {
  if (!hasTable('realdata_findings')) return null;
  const r = one<{ z_before: number; z_after: number; gate_before: string; gate_after: string }>(
    'select z_before, z_after, gate_before, gate_after from realdata_findings where finding_id = ?', findingId,
  );
  if (!r || r.gate_before === r.gate_after) return null;
  const now = r.gate_after === 'passes' ? pick(lang, 'would pass every statistical gate', 'हर सांख्यिकीय शर्त पूरी करता')
    : r.gate_after === 'noise' ? pick(lang, 'would not clear the noise test', 'शोर-परीक्षण पार नहीं करता')
      : pick(lang, 'would fall just short of the materiality line', 'महत्त्व की सीमा से थोड़ा कम रहता');
  return (
    <Callout tone="method" title={pick(lang, 'Re-measured after calibration', 'अंशांकन के बाद दोबारा मापा गया')}>
      {pick(lang,
        `Class 3 results were later shifted so each district’s average matches PRS 2024. On the shifted figures this finding has z ${r.z_after.toFixed(2)} (it was ${r.z_before.toFixed(2)} when it was decided) and ${now}. The drop itself barely moved; a higher level changes the z-test. The decision stands as it was recorded.`,
        `बाद में कक्षा 3 के परिणाम खिसकाए गए ताकि हर ज़िले का औसत परख 2024 से मेल खाए। खिसकाए गए आँकड़ों पर इस निष्कर्ष का z ${r.z_after.toFixed(2)} है (निर्णय के समय ${r.z_before.toFixed(2)} था) और यह ${now}। गिरावट लगभग वही रही; ऊँचा स्तर z-परीक्षण बदल देता है। निर्णय वैसा ही रहता है जैसा दर्ज हुआ था।`)}
    </Callout>
  );
}

/** The same for an outcome check whose verdict reads differently on the calibrated results than when it was made. */
export function OutcomeCalibrationNote({ outcomeId, lang }: { outcomeId: string; lang: Language }) {
  if (!hasTable('realdata_outcomes')) return null;
  const r = one<{ did_before: number | null; did_after: number | null; category_before: string; category_after: string }>(
    'select did_before, did_after, category_before, category_after from realdata_outcomes where outcome_id = ?', outcomeId,
  );
  if (!r || r.category_before === r.category_after) return null;
  const label = (c: string) => { const l = (OUTCOME_LABEL as Record<string, { en: string; hi: string }>)[c]; return l ? pick(lang, l.en, l.hi) : c; };
  const f = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
  return (
    <Callout tone="method" title={pick(lang, 'Re-measured after calibration', 'अंशांकन के बाद दोबारा मापा गया')}>
      {pick(lang,
        `Class 3 results were later calibrated to PRS 2024, and this check is shown re-derived from the calibrated school results: “${label(r.category_after)}”, DiD ${f(r.did_after)} pp. When it was made it read “${label(r.category_before)}”, DiD ${f(r.did_before)} pp, and the case moves that followed were decided on that reading; they stand as recorded.`,
        `बाद में कक्षा 3 के परिणाम परख 2024 से अंशांकित किए गए, और यह जाँच अंशांकित परिणामों से दोबारा निकाली गई दिखाई गई है: “${label(r.category_after)}”, DiD ${f(r.did_after)} pp। बनते समय यह “${label(r.category_before)}”, DiD ${f(r.did_before)} pp थी, और उसके बाद की प्रकरण कार्यवाही उसी आधार पर हुई; वह वैसी ही रहती है जैसी दर्ज हुई।`)}
    </Callout>
  );
}
