import Link from 'next/link';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { districtFigures, reconciliation } from '@/lib/sources';
import { Pill } from './labels';
import { Icon } from './Icon';

/**
 * Published figures about a district, shown beside the learning picture: ASER 2024 (rural) and a
 * few NFHS-5 indicators, and PRS 2024 Class 3 next to the demo's calibrated Class 3 average.
 * Labelled "context, not cause": none of these explains a particular cluster's drop.
 */
export function DistrictContext({ districtIds, lang }: { districtIds: string[]; lang: Language }) {
  const ds = districtIds.map((id) => ({ id, f: districtFigures(id) })).filter((x) => x.f);
  if (!ds.length) return null;
  const recon = reconciliation();
  const L = (en: string, hi: string) => pick(lang, en, hi);
  return (
    <section className="card" aria-labelledby="district-context-title" data-testid="district-context">
      <header className="card-head">
        <div className="min-w-0">
          <h2 id="district-context-title" className="text-md font-semibold tracking-tight text-ink">
            {ds.length === 1 ? L(`${ds[0].f!.name}: district context`, `${ds[0].f!.name}: ज़िला संदर्भ`) : L('District context', 'ज़िला संदर्भ')}
          </h2>
          <p className="mt-0.5 text-sm leading-snug text-ink-soft">{L('Published figures for the district as a whole. They describe the setting; they do not explain any one cluster’s drop.', 'पूरे ज़िले के प्रकाशित आँकड़े। ये परिस्थिति बताते हैं; किसी एक संकुल की गिरावट का कारण नहीं।')}</p>
        </div>
        <div className="shrink-0"><Pill tone="warn" title={L('Observed at district level; not linked to any finding', 'ज़िला स्तर पर; किसी निष्कर्ष से जुड़ा नहीं')}>{L('Context, not cause', 'संदर्भ, कारण नहीं')}</Pill></div>
      </header>
      <div className={`grid divide-y divide-line ${ds.length > 1 ? 'lg:grid-cols-3 lg:divide-x lg:divide-y-0' : ''}`}>
        {ds.map(({ id, f }) => {
          const lang3 = recon.find((r) => r.districtId === id && r.subject === 'language');
          const math3 = recon.find((r) => r.districtId === id && r.subject === 'mathematics');
          const nf = f!.nfhs;
          const rows: [string, string, number | null][] = [
            [L('Std III–V who can read a Std II text', 'कक्षा 3–5: कक्षा 2 का पाठ पढ़ सकते हैं'), 'ASER 2024', f!.aser.std3_5_read_std2],
            [L('Std III–V who can do at least subtraction', 'कक्षा 3–5: कम से कम घटाव कर सकते हैं'), 'ASER 2024', f!.aser.std3_5_subtraction],
            [L('Children 6–14 in government schools', '6–14 वर्ष के बच्चे सरकारी विद्यालयों में'), 'ASER 2024', f!.aser.govt_school_enrolment_6_14],
            [L('Children 6–14 not in school', '6–14 वर्ष के बच्चे विद्यालय से बाहर'), 'ASER 2024', f!.aser.not_in_school_6_14],
            ...Object.values(nf).map((v) => [pick(lang, v.en, v.hi), 'NFHS-5', v.nfhs5] as [string, string, number | null]),
          ];
          return (
            <div key={id} className="p-4 sm:p-5">
              {ds.length > 1 ? <p className="mb-2 text-sm font-semibold text-ink">{f!.name}</p> : null}
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-line bg-paper-sunk/60 px-3 py-2">
                  <dt className="text-2xs text-ink-faint">{L('PRS 2024 · Class 3 language', 'परख 2024 · कक्षा 3 भाषा')}</dt>
                  <dd className="tnum text-lg font-semibold text-ink">{f!.prs.language}%</dd>
                  {lang3?.simulated != null ? <dd className="text-2xs text-ink-faint">{L('demo R0', 'डेमो R0')} {lang3.simulated.toFixed(1)}%</dd> : null}
                </div>
                <div className="rounded-lg border border-line bg-paper-sunk/60 px-3 py-2">
                  <dt className="text-2xs text-ink-faint">{L('PRS 2024 · Class 3 maths', 'परख 2024 · कक्षा 3 गणित')}</dt>
                  <dd className="tnum text-lg font-semibold text-ink">{f!.prs.mathematics}%</dd>
                  {math3?.simulated != null ? <dd className="text-2xs text-ink-faint">{L('demo R0', 'डेमो R0')} {math3.simulated.toFixed(1)}%</dd> : null}
                </div>
              </dl>
              <ul className="mt-3 divide-y divide-line text-sm">
                {rows.map(([label, src, v]) => (
                  <li key={label} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0 text-ink-soft">{label} <span className="text-2xs text-ink-faint">· {src}</span></span>
                    <span className="tnum shrink-0 font-medium text-ink">{v === null ? '—' : `${v.toFixed(1)}%`}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-xs leading-snug text-ink-faint sm:px-5">
        <Icon name="info" size={13} className="mt-0.5 shrink-0" />
        <span>{L('ASER 2024: rural households, government and private schools. NFHS-5: 2019-21. PRS 2024: average % correct, which the demo’s Class 3 results are calibrated to.', 'असर 2024: ग्रामीण परिवार, सरकारी व निजी विद्यालय। NFHS-5: 2019-21। परख 2024: औसत % सही, जिससे डेमो के कक्षा 3 परिणाम अंशांकित हैं।')}{' '}
          <Link href="/sources" className="link">{L('Sources', 'स्रोत')}</Link></span>
      </p>
    </section>
  );
}

/** The demo districts a scope covers: all three for the state, otherwise the one the scope sits in. */
export function districtsForScope(scopeType: string, scopeId: string, lookup: (sql: string, id: string) => string | null): string[] {
  if (scopeType === 'state') return ['DST-01', 'DST-02', 'DST-03'];
  if (scopeType === 'district') return [scopeId];
  const sql = scopeType === 'block' ? 'select district_id d from blocks where id = ?'
    : scopeType === 'cluster' ? 'select district_id d from clusters where id = ?'
      : 'select district_id d from schools where id = ?';
  const d = lookup(sql, scopeId);
  return d ? [d] : [];
}
