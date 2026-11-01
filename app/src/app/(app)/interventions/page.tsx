import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { interventions, competencies } from '@/lib/repo';
import { getCase } from '@/lib/cases';
import { matchForCase, interventionHistory, authorityFor, type InterventionMatch } from '@/lib/studio';
import { pick } from '@/lib/i18n';
import { PageHead, fmtInr } from '@/components/ui';
import { EvidenceStrength } from '@/components/labels';
import { Icon } from '@/components/Icon';
import type { Intervention } from '@domain/types';

/**
 * Intervention Studio. Without a case it is the catalogue — searchable rows. Opened from a case
 * (?case=CASE-0184) it ranks the catalogue against that case with transparent, rule-based
 * points and lets the officer tick two or three to compare side by side.
 *
 * Three cards cite published evidence (flagged: verify before production); fifteen make no
 * effect-size claim at all. Every cost is illustrative.
 */

type SP = { case?: string; subject?: string; category?: string; lever?: string; evidence?: string; q?: string };

const CATEGORY: Record<string, string> = {
  numeracy: 'Numeracy', literacy: 'Literacy', attendance: 'Attendance', teacher_support: 'Teacher support', staffing: 'Staffing', materials: 'Materials',
};

export default async function StudioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const caseId = sp.case && getCase(session, sp.case.toUpperCase()) ? sp.case.toUpperCase() : undefined;
  const ranked = caseId ? matchForCase(session, caseId) : null;
  const hist = interventionHistory();
  const q = sp.q?.trim().toLowerCase().slice(0, 60) || '';
  const comps = new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)]));

  const rows: { iv: Intervention; m: InterventionMatch | null }[] = ranked
    ? ranked.matches.map((m) => ({ iv: m.intervention, m }))
    : interventions().map((iv) => ({ iv, m: null }));
  const shown = rows.filter(({ iv }) =>
    (!sp.subject || iv.domains.includes(sp.subject as 'literacy' | 'numeracy')) &&
    (!sp.category || iv.category === sp.category) &&
    (!sp.lever || iv.lever === sp.lever) &&
    (!sp.evidence || iv.evidence.status === sp.evidence) &&
    (!q || `${iv.id} ${iv.name} ${iv.description} ${CATEGORY[iv.category] ?? ''}`.toLowerCase().includes(q)));

  const sel = 'h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink';
  const sourced = rows.filter((r) => r.iv.evidence.status === 'sourced_summary_verify').length;
  const filtered = Boolean(q || sp.subject || sp.category || sp.lever || sp.evidence);

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Interventions', 'हस्तक्षेप')}
        sub={pick(lang,
          'Choose what to do about a learning decline: what each option targets, costs, needs approval from, and what the evidence actually says.',
          'गिरावट पर क्या करें — लक्ष्य, लागत, स्वीकृति अधिकार और आधार।')}
        meta={<>{caseId ? `Ranked for ${caseId}` : 'Full catalogue'} · costs are illustrative</>}
        right={<Link href={`/interventions/compare${caseId ? `?case=${caseId}` : ''}`} className="btn-primary"><Icon name="scale" size={15} />{pick(lang, 'Compare options', 'तुलना')}</Link>}
      />

      {ranked && caseId ? (
        <section className="card flex flex-wrap items-start justify-between gap-4 border-brand/30 bg-brand-light/40 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">Ranked for {caseId}</p>
            <p className="mt-0.5 text-md font-semibold text-ink">{ranked.caseTitle}</p>
            {ranked.factors.length ? <p className="mt-1 text-sm text-ink-soft">Diagnosis: {ranked.factors.map((f) => f.label).join(' · ')}</p> : null}
            <p className="mt-1.5 text-xs text-ink-faint">Points come from listed rules (competency fit, condition fit, cited evidence, ledger history). They are not a predicted effect.</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/cases/${caseId}#plan`} className="btn-quiet btn-sm">Back to case</Link>
            <Link href="/interventions" className="btn-ghost btn-sm">Clear case</Link>
          </div>
        </section>
      ) : (
        <div className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3.5"><p className="text-sm text-ink-soft">In the catalogue</p><p className="kpi-num mt-1 text-ink">{rows.length}</p></div>
          <div className="px-5 py-3.5"><p className="text-sm text-ink-soft">Cite a published source</p><p className="kpi-num mt-1 text-warn">{sourced}</p><p className="text-xs text-ink-faint">flagged: verify before production</p></div>
          <div className="px-5 py-3.5"><p className="text-sm text-ink-soft">Make no effect claim</p><p className="kpi-num mt-1 text-ink">{rows.length - sourced}</p><p className="text-xs text-ink-faint">plausible, unevidenced here</p></div>
        </div>
      )}

      <form method="get" action="/interventions" className="card flex flex-wrap items-center gap-2 p-3">
        {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder={pick(lang, 'Search interventions…', 'हस्तक्षेप खोजें…')} aria-label="Search interventions" className="input h-9 pl-9 text-sm" />
        </div>
        <select name="subject" defaultValue={sp.subject ?? ''} className={sel} aria-label="Subject"><option value="">All subjects</option><option value="numeracy">Numeracy</option><option value="literacy">Literacy</option></select>
        <select name="category" defaultValue={sp.category ?? ''} className={sel} aria-label="Type"><option value="">All types</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="lever" defaultValue={sp.lever ?? ''} className={sel} aria-label="Approval authority"><option value="">Any authority</option><option value="block">Block</option><option value="district">District</option><option value="pab">PAB</option></select>
        <select name="evidence" defaultValue={sp.evidence ?? ''} className={sel} aria-label="Evidence"><option value="">Any evidence</option><option value="sourced_summary_verify">Cites a source</option><option value="illustrative">No effect claim</option></select>
        <button type="submit" className="btn-quiet h-9"><Icon name="filter" size={14} />Apply</button>
        {filtered ? <Link href={caseId ? `/interventions?case=${caseId}` : '/interventions'} className="btn-ghost h-9">Clear</Link> : null}
      </form>

      <form method="get" action="/interventions/compare" className="card overflow-hidden">
        {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <p className="text-sm text-ink-soft"><span className="font-medium text-ink">{shown.length}</span> {pick(lang, 'interventions', 'हस्तक्षेप')}{ranked ? ' · ranked by fit' : ''} <span className="text-ink-faint">· tick two or three to compare</span></p>
          <button type="submit" className="btn-primary btn-sm"><Icon name="scale" size={14} />Compare selected</button>
        </div>
        {shown.length === 0 ? <p className="px-6 py-12 text-center text-sm text-ink-faint">No interventions match these filters.</p> : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {shown.map(({ iv, m }) => (
              <li key={iv.id} className={`flex gap-3 px-4 py-3 ${m && !m.eligible ? 'opacity-60' : ''}`}>
                <input type="checkbox" name="id" value={iv.id} aria-label={`Compare ${iv.name}`} className="mt-1 h-4 w-4 shrink-0 accent-brand" defaultChecked={Boolean(m?.isCurrentPlan)} />
                <Link href={`/interventions/${iv.id}${caseId ? `?case=${caseId}` : ''}`} className="min-w-0 flex-1">
                  <span className="block text-base font-medium leading-snug text-ink">{iv.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint"><span className="font-mono">{iv.id}</span> · {CATEGORY[iv.category]} · {fmtInr(iv.cost_basis.amount_inr)} {iv.cost_basis.unit} · {iv.duration_weeks ? `${iv.duration_weeks} wk` : 'PAB'}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><EvidenceStrength status={iv.evidence.status} lang={lang} />{m && m.eligible ? <span className="tnum rounded bg-navy px-1.5 py-0.5 text-2xs font-semibold text-white">{m.points} pts</span> : null}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="table min-w-[980px]">
              <thead>
                <tr>
                  <th className="w-10"><span className="sr-only">Compare</span></th>
                  <th>{pick(lang, 'Intervention', 'हस्तक्षेप')}</th>
                  {ranked ? <th className="text-right">Fit</th> : null}
                  <th>{pick(lang, 'Evidence', 'आधार')}</th>
                  <th>{pick(lang, 'Approval', 'स्वीकृति')}</th>
                  <th className="text-right">{pick(lang, 'Cost (illustrative)', 'लागत')}</th>
                  <th>{pick(lang, 'Duration', 'अवधि')}</th>
                  <th>{pick(lang, 'Track record', 'पिछला परिणाम')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ iv, m }, idx) => {
                  const h = hist.get(iv.id);
                  const auth = m?.authority ?? authorityFor(session, iv.lever);
                  return (
                    <tr key={iv.id} className={m && !m.eligible ? 'opacity-60' : m?.isCurrentPlan ? 'bg-brand-light/40' : ''}>
                      <td><input type="checkbox" name="id" value={iv.id} aria-label={`Compare ${iv.name}`} className="h-4 w-4 accent-brand" defaultChecked={Boolean(m?.isCurrentPlan)} /></td>
                      <td className="max-w-[440px]">
                        <Link href={`/interventions/${iv.id}${caseId ? `?case=${caseId}` : ''}`} className="text-base font-medium text-ink hover:text-brand">{iv.name}</Link>
                        {m?.isCurrentPlan ? <span className="chip ml-2 border-brand/30 bg-brand-light text-brand">Current plan</span> : null}
                        <p className="mt-0.5 text-xs text-ink-faint"><span className="font-mono">{iv.id}</span> · {CATEGORY[iv.category]} · Class {iv.grades.join(', ')} · {iv.competency_ids.map((c) => comps.get(c) ?? c).slice(0, 3).join(', ')}{iv.competency_ids.length > 3 ? '…' : ''}</p>
                        {m && !m.eligible ? <p className="mt-0.5 text-xs text-ink-faint">Not a fit: {m.excludedBecause}</p> : null}
                        {m && m.eligible && m.risks.length ? <p className="mt-0.5 text-xs text-warn"><Icon name="alert" size={12} className="mr-1 inline" />{m.risks[0].text}</p> : null}
                      </td>
                      {ranked ? <td className="text-right">{m && m.eligible ? <span className="inline-flex flex-col items-end"><span className="tnum whitespace-nowrap rounded bg-navy px-1.5 py-0.5 text-xs font-semibold text-white">{m.points} pts</span><span className="mt-0.5 text-2xs text-ink-faint">#{idx + 1}</span></span> : <span className="text-ink-faint">—</span>}</td> : null}
                      <td><EvidenceStrength status={iv.evidence.status} lang={lang} /></td>
                      <td className="text-sm">{iv.lever === 'pab' ? 'PAB' : iv.lever === 'block' ? 'Block' : 'District'}{auth.canApprove ? <span className="block text-xs text-good">you can approve</span> : null}</td>
                      <td className="tnum text-right text-sm">{fmtInr(iv.cost_basis.amount_inr)}<span className="block text-2xs text-ink-faint">{iv.cost_basis.unit}</span></td>
                      <td className="whitespace-nowrap text-sm">{iv.duration_weeks ? `${iv.duration_weeks} weeks` : 'PAB cycle'}</td>
                      <td className="text-sm">{h && h.evaluated ? <><span className="font-medium text-ink">{h.improved}/{h.evaluated}</span> <span className="text-ink-faint">gained</span></> : <span className="text-ink-faint">not evaluated</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </form>

      <p className="text-xs text-ink-faint">All costs are illustrative card figures, never PAB unit costs. INT-01–03 quote J-PAL’s TaRL policy insight and are flagged “verify before production”.</p>
    </div>
  );
}
