import Link from 'next/link';
import type { BuiltReport } from '@/lib/reports';
import { REPORT_TYPES } from '@/lib/reports';
import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';
import { fmtDate } from './ui';
import { Icon } from './Icon';
import { REPORT_ICON, REPORT_HI } from './ReportsRail';

/**
 * The picture at the top of a report page: the headline figures as bars, and what the document
 * contains (each section, sized by its rows). Built only from the report object itself, so the
 * picture can never say more than the document under it.
 */
export function ReportPicture({ r, lang }: { r: BuiltReport; lang: Language }) {
  const figures = r.summary.map((s) => ({ ...s, n: Number(String(s.value).replace(/[^\d.-]/g, '')) }));
  const figMax = Math.max(1, ...figures.map((f) => (Number.isFinite(f.n) ? f.n : 0)));
  const rowMax = Math.max(1, ...r.sections.map((s) => s.rows.length));
  const totalRows = r.sections.reduce((a, s) => a + s.rows.length, 0);
  const tones = ['bg-brand/70', 'bg-good', 'bg-pend/60', 'bg-warn', 'bg-crit/70', 'bg-navy-600/60'];

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] no-print" aria-label={pick(lang, 'This report at a glance', 'यह रिपोर्ट एक नज़र में')}>
      <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
        <p className="flex items-baseline justify-between gap-2">
          <span className="label">{pick(lang, 'The headline figures', 'मुख्य आँकड़े')}</span>
          <span className="tnum text-xs text-ink-faint">{fmtDate(r.period.from, false, lang)} – {fmtDate(r.period.to, false, lang)}</span>
        </p>
        {figures.length === 0 ? <p className="mt-4 text-sm text-ink-faint">{pick(lang, 'This report has no summary figures.', 'इस रिपोर्ट में सारांश आँकड़े नहीं हैं।')}</p> : (
          <ul className="mt-4 space-y-2.5">
            {figures.map((f, i) => (
              <li key={f.label} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_44px] items-center gap-2 text-xs">
                <span className="truncate text-ink-soft" title={f.label}>{f.label}</span>
                <span className="h-3 overflow-hidden rounded-full bg-paper-deep">
                  <span className={`block h-full rounded-full ${tones[i % tones.length]}`} style={{ width: `${Number.isFinite(f.n) && f.n > 0 ? Math.max(4, (100 * f.n) / figMax) : 0}%` }} />
                </span>
                <span className="tnum text-right text-sm font-semibold text-ink">{f.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
        <p className="flex items-baseline justify-between gap-2">
          <span className="label">{pick(lang, 'What the document contains', 'दस्तावेज़ में क्या है')}</span>
          <span className="text-xs text-ink-faint"><span className="tnum font-semibold text-ink">{totalRows}</span> {pick(lang, 'rows', 'पंक्तियाँ')} · <span className="tnum font-semibold text-ink">{r.caseIds.length}</span> {pick(lang, 'cases', 'प्रकरण')}</span>
        </p>
        <ul className="mt-4 space-y-2.5">
          {r.sections.map((s, i) => (
            <li key={`${s.title}-${i}`} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_44px] items-center gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-soft"><Icon name="layers" size={12} className="shrink-0 text-ink-faint" /><span className="truncate" title={s.title}>{s.title}</span></span>
              <span className="h-3 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-navy-600/50" style={{ width: `${s.rows.length ? Math.max(4, (100 * s.rows.length) / rowMax) : 0}%` }} /></span>
              <span className="tnum text-right font-semibold text-ink">{s.rows.length}</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5 pt-1 text-xs text-ink-faint">
            <Icon name="info" size={12} className="shrink-0" />
            {r.caveats.length} {pick(lang, 'caveats printed at the foot of the document', 'सावधानियाँ दस्तावेज़ के अंत में')}
          </li>
        </ul>
      </div>
    </section>
  );
}

/** A row of report-type chips, so another kind of report is one click away without a side rail. */
export function ReportTypeChips({ active, lang }: { active?: string | null; lang: Language }) {
  return (
    <nav aria-label={pick(lang, 'Report types', 'रिपोर्ट प्रकार')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-print">
      {REPORT_TYPES.map((t) => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={`/reports/new?type=${t.key}`} aria-current={on ? 'page' : undefined} title={pick(lang, t.blurb, REPORT_HI[t.key]?.blurb ?? t.blurb)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink'}`}>
            <Icon name={REPORT_ICON[t.key] ?? 'file'} size={14} className={on ? 'text-white' : 'text-ink-faint'} />
            {pick(lang, t.label, REPORT_HI[t.key]?.label ?? t.label)}
          </Link>
        );
      })}
    </nav>
  );
}
