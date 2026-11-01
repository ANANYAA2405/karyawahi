import Link from 'next/link';
import type { BuiltReport } from '@/lib/reports';
import { Logo } from './Brand';
import { fmtDate } from './ui';

/** A built report, laid out for screen and paper. Pure presentation of a deterministic object. */

const caseLink = (v: string) => {
  const m = v.match(/^(CASE-\d{4})/);
  return m ? <><Link href={`/cases/${m[1]}`} className="font-medium text-ink hover:text-brand print:text-black">{m[1]}</Link>{v.slice(m[1].length)}</> : v;
};

export function ReportView({ r, snapshotId }: { r: BuiltReport; snapshotId?: string }) {
  return (
    <article className="mx-auto max-w-[960px] overflow-hidden rounded-md border border-line-strong bg-white shadow-lift print:max-w-none print:border-0 print:shadow-none">
      <header className="border-b-[3px] border-navy px-6 pb-5 pt-6 sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Karyavahi · {snapshotId ? `Snapshot ${snapshotId}` : 'Preview — not saved'}</p>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-ink">{r.title}</h2>
            </div>
          </div>
          <span className="chip shrink-0 border-warn/30 bg-warn-light text-warn">Fictional demo data</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="label">Scope</dt><dd className="text-ink">{r.scope}</dd></div>
          <div><dt className="label">Period</dt><dd className="tnum text-ink">{fmtDate(r.period.from)} – {fmtDate(r.period.to)}</dd></div>
          <div><dt className="label">Generated</dt><dd className="tnum text-ink">{fmtDate(r.generatedAt, true)}</dd></div>
          <div><dt className="label">By</dt><dd className="text-ink">{r.generatedBy}</dd></div>
        </dl>
      </header>

      {r.summary.length ? (
        <section className="border-b border-line px-6 py-5 sm:px-10">
          <h3 className="h-section mb-2">Summary</h3>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {r.summary.map((s) => (
              <div key={s.label} className="rounded-lg border border-line px-3 py-2">
                <dt className="text-xs leading-tight text-ink-faint">{s.label}</dt>
                <dd className="tnum mt-0.5 text-xl font-semibold text-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {r.sections.map((sec) => (
        <section key={sec.title} className="border-b border-line px-6 py-5 sm:px-10 print:break-inside-auto">
          <h3 className="text-md font-semibold text-ink">{sec.title} <span className="font-normal text-ink-faint">({sec.rows.length})</span></h3>
          {sec.note ? <p className="mt-0.5 text-sm text-ink-soft">{sec.note}</p> : null}
          {sec.rows.length === 0 ? <p className="mt-2 text-sm text-ink-faint">No records.</p> : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="table text-sm">
                <thead><tr>{sec.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {sec.rows.slice(0, 300).map((row, i) => (
                    <tr key={i}>{sec.columns.map((c) => <td key={c.key} className="align-top">{typeof row[c.key] === 'string' ? caseLink(String(row[c.key])) : row[c.key] ?? '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {sec.rows.length > 300 ? <p className="border-t border-line px-3 py-2 text-xs text-ink-faint">Showing 300 of {sec.rows.length}. The CSV and Excel exports contain every row.</p> : null}
            </div>
          )}
        </section>
      ))}

      <footer className="space-y-1.5 px-6 py-5 text-xs text-ink-soft sm:px-10">
        <p className="font-semibold text-ink">Limitations and caveats</p>
        <ul className="list-disc space-y-0.5 pl-5">{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <p className="pt-2 font-semibold uppercase tracking-wide text-warn">{r.disclaimer}</p>
        <p className="text-ink-faint">Built deterministically from the case ledger. No AI text in this report.</p>
      </footer>
    </article>
  );
}
