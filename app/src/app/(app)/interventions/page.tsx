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
import { CostSource, unitLabel, isRealCost } from '@/components/cost';
import type { Intervention } from '@domain/types';
import { searchLibrary } from '@/lib/evidence-search';

/**
 * Intervention Studio. Without a case it is the catalogue: a picture of what it covers, who can
 * approve what, and how the options have fared in this ledger, then one card per intervention.
 * Opened from a case (?case=CASE-0184) it ranks the catalogue against that case with
 * transparent, rule-based points and lets the officer tick two or three to compare side by side.
 *
 * Three cards cite published evidence (flagged: verify before production); fifteen make no
 * effect-size claim at all. Every cost is illustrative.
 */

type SP = { case?: string; subject?: string; category?: string; lever?: string; evidence?: string; q?: string; view?: string };

const CATEGORY: Record<string, { en: string; hi: string }> = {
  numeracy: { en: 'Numeracy', hi: 'गणित' },
  literacy: { en: 'Literacy', hi: 'भाषा' },
  attendance: { en: 'Attendance', hi: 'उपस्थिति' },
  teacher_support: { en: 'Teacher support', hi: 'शिक्षक सहायता' },
  staffing: { en: 'Staffing', hi: 'स्टाफ़' },
  materials: { en: 'Materials', hi: 'सामग्री' },
};
const LEVER: Record<string, { en: string; hi: string }> = {
  block: { en: 'Block', hi: 'खंड' }, district: { en: 'District', hi: 'ज़िला' }, pab: { en: 'PAB', hi: 'PAB' },
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
  const cat = (k: string) => (CATEGORY[k] ? pick(lang, CATEGORY[k].en, CATEGORY[k].hi) : k);
  const lever = (k: string) => (LEVER[k] ? pick(lang, LEVER[k].en, LEVER[k].hi) : k);

  // Ranked full-text search over the cards (evidence, delivery conditions, limitations) and the
  // reader's own checked cases, so "teacher shortage" finds cards that never use those exact words.
  const lib = q ? searchLibrary(session, q, { interventions: 40, cases: 6 }) : null;
  const libHit = new Set(lib?.interventions.map((h) => h.id) ?? []);
  const rows: { iv: Intervention; m: InterventionMatch | null }[] = ranked
    ? ranked.matches.map((m) => ({ iv: m.intervention, m }))
    : interventions().map((iv) => ({ iv, m: null }));
  const shown = rows.filter(({ iv }) =>
    (!sp.subject || iv.domains.includes(sp.subject as 'literacy' | 'numeracy')) &&
    (!sp.category || iv.category === sp.category) &&
    (!sp.lever || iv.lever === sp.lever) &&
    (!sp.evidence || iv.evidence.status === sp.evidence) &&
    (!q || libHit.has(iv.id) || `${iv.id} ${iv.name} ${iv.description} ${CATEGORY[iv.category]?.en ?? ''}`.toLowerCase().includes(q)));

  const sel = 'h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink';
  const sourced = rows.filter((r) => r.iv.evidence.status === 'sourced_summary_verify').length;
  const filtered = Boolean(q || sp.subject || sp.category || sp.lever || sp.evidence);
  const view = sp.view === 'table' ? 'table' : 'cards';
  const link = (over: Partial<SP>) => {
    const u = new URLSearchParams(Object.entries({ case: caseId, subject: sp.subject, category: sp.category, lever: sp.lever, evidence: sp.evidence, q: sp.q, view: view === 'table' ? 'table' : undefined, ...over })
      .filter(([, v]) => v) as [string, string][]);
    return `/interventions${u.size ? `?${u}` : ''}`;
  };

  // The catalogue picture.
  const byCategory = Object.keys(CATEGORY).map((k) => {
    const inCat = rows.filter((r) => r.iv.category === k);
    return { k, n: inCat.length, src: inCat.filter((r) => r.iv.evidence.status === 'sourced_summary_verify').length };
  }).filter((c) => c.n > 0);
  const catMax = Math.max(1, ...byCategory.map((c) => c.n));
  const byLever = (['block', 'district', 'pab'] as const).map((k) => ({ k, n: rows.filter((r) => r.iv.lever === k).length, can: authorityFor(session, k).canApprove }));
  const track = [...hist.values()].reduce((a, h) => ({ evaluated: a.evaluated + h.evaluated, improved: a.improved + h.improved, not: a.not + h.notImproved, inc: a.inc + h.inconclusive }), { evaluated: 0, improved: 0, not: 0, inc: 0 });
  const triedCount = rows.filter((r) => (hist.get(r.iv.id)?.evaluated ?? 0) > 0).length;
  const fitTop = ranked ? ranked.matches.filter((m) => m.eligible).slice(0, 8) : [];
  const fitMax = Math.max(1, ...fitTop.map((m) => m.points));

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Interventions', 'हस्तक्षेप')}
        sub={pick(lang,
          'Choose what to do about a learning decline: what each option targets, costs, needs approval from, and what the evidence actually says.',
          'गिरावट पर क्या करें — लक्ष्य, लागत, स्वीकृति अधिकार और आधार।')}
        meta={<>{caseId ? `${pick(lang, 'Ranked for', 'इस प्रकरण हेतु क्रम:')} ${caseId}` : pick(lang, 'Full catalogue', 'पूरी सूची')} · {pick(lang, 'costs are illustrative', 'लागत केवल उदाहरण')}</>}
        right={<Link href={`/interventions/compare${caseId ? `?case=${caseId}` : ''}`} className="btn-primary"><Icon name="scale" size={15} />{pick(lang, 'Compare options', 'तुलना')}</Link>}
      />

      {ranked && caseId ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-brand/30 bg-brand-light/40 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">{pick(lang, 'Ranked for', 'इस प्रकरण हेतु क्रम:')} {caseId}</p>
              <p className="mt-0.5 text-md font-semibold text-ink">{ranked.caseTitle}</p>
              {ranked.factors.length ? <p className="mt-1 text-sm text-ink-soft">{pick(lang, 'Diagnosis', 'निदान')}: {ranked.factors.map((f) => f.label).join(' · ')}</p> : null}
              <p className="mt-1.5 text-xs text-ink-faint">{pick(lang, 'Points come from listed rules (competency fit, condition fit, cited evidence, ledger history). They are not a predicted effect.', 'अंक सूचीबद्ध नियमों से आते हैं (दक्षता, परिस्थिति, उद्धृत आधार, पिछला रिकॉर्ड)। ये अनुमानित प्रभाव नहीं हैं।')}</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/cases/${caseId}#plan`} className="btn-quiet btn-sm">{pick(lang, 'Back to case', 'प्रकरण पर लौटें')}</Link>
              <Link href="/interventions" className="btn-ghost btn-sm">{pick(lang, 'Clear case', 'प्रकरण हटाएँ')}</Link>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <p className="flex items-baseline justify-between gap-2">
              <span className="label">{pick(lang, 'Best fits by rule points', 'नियम-अंकों से सबसे उपयुक्त')}</span>
              <span className="text-xs text-ink-faint"><span className="tnum font-semibold text-ink">{ranked.matches.filter((m) => m.eligible).length}</span> {pick(lang, 'fit', 'उपयुक्त')} · <span className="tnum">{ranked.matches.filter((m) => !m.eligible).length}</span> {pick(lang, 'not a fit', 'अनुपयुक्त')}</span>
            </p>
            {fitTop.length === 0 ? <p className="mt-4 text-sm text-ink-faint">{pick(lang, 'Nothing in the catalogue fits this case.', 'सूची में कुछ भी इस प्रकरण के अनुकूल नहीं।')}</p> : (
              <ol className="mt-4 space-y-2">
                {fitTop.map((m) => (
                  <li key={m.intervention.id}>
                    <Link href={`/interventions/${m.intervention.id}?case=${caseId}`} className="group grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_52px] items-center gap-2 text-xs">
                      <span className="truncate text-ink-soft group-hover:text-brand"><span className="font-mono text-ink-faint">{m.intervention.id}</span> {m.intervention.name}</span>
                      <span className="h-3 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${m.isCurrentPlan ? 'bg-brand' : 'bg-navy-600/60'}`} style={{ width: `${Math.max(4, (100 * m.points) / fitMax)}%` }} /></span>
                      <span className="tnum text-right font-semibold text-ink">{m.points} {pick(lang, 'pts', 'अंक')}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      ) : (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-label={pick(lang, 'The catalogue at a glance', 'सूची एक नज़र में')}>
          <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <p className="flex items-baseline justify-between gap-2">
              <span className="label">{pick(lang, 'What the catalogue covers', 'सूची में क्या है')}</span>
              <span className="text-xs text-ink-faint"><span className="tnum kpi-num mr-1 text-ink">{rows.length}</span>{pick(lang, 'options', 'विकल्प')}</span>
            </p>
            <ul className="mt-4 space-y-2">
              {byCategory.map((c) => {
                const on = sp.category === c.k;
                return (
                  <li key={c.k}>
                    <Link href={link({ category: on ? undefined : c.k })} aria-current={on ? 'true' : undefined}
                      className={`grid grid-cols-[110px_minmax(0,1fr)_28px] items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition-colors ${on ? 'bg-brand-light' : 'hover:bg-paper-sunk'}`}>
                      <span className={on ? 'font-semibold text-brand' : 'text-ink-soft'}>{cat(c.k)}</span>
                      <span className="flex h-3 overflow-hidden rounded-full bg-paper-deep" style={{ width: `${Math.max(8, (100 * c.n) / catMax)}%` }}>
                        {c.src ? <span className="h-full bg-amber" style={{ width: `${(100 * c.src) / c.n}%` }} /> : null}
                        <span className="h-full flex-1 bg-navy-600/50" />
                      </span>
                      <span className="tnum text-right font-semibold text-ink">{c.n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex flex-wrap gap-3 text-2xs text-ink-soft">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" />{pick(lang, 'Cites a source', 'स्रोत उद्धृत')} <span className="tnum font-semibold">{sourced}</span></span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-navy-600/50" />{pick(lang, 'No effect claim', 'प्रभाव का दावा नहीं')} <span className="tnum font-semibold">{rows.length - sourced}</span></span>
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <p className="label">{pick(lang, 'Who has to approve', 'किसकी स्वीकृति चाहिए')}</p>
            <ol className="mt-4 space-y-2">
              {byLever.map((l, i) => {
                const on = sp.lever === l.k;
                return (
                  <li key={l.k}>
                    <Link href={link({ lever: on ? undefined : l.k })} aria-current={on ? 'true' : undefined}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${on ? 'border-brand/40 bg-brand-light/50' : 'border-line hover:border-line-strong'}`}>
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-2xs font-semibold ${['bg-brand-light text-brand', 'bg-navy-100 text-navy-700', 'bg-amber-light text-warn'][i]}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{lever(l.k)}</span>
                        <span className={`block text-2xs ${l.can ? 'text-good' : 'text-ink-faint'}`}>{l.can ? pick(lang, 'you can approve', 'आप स्वीकृत कर सकते हैं') : pick(lang, 'needs a higher level', 'उच्च स्तर आवश्यक')}</span>
                      </span>
                      <span className="tnum text-lg font-semibold text-ink">{l.n}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <p className="flex items-baseline justify-between gap-2">
              <span className="label">{pick(lang, 'How they fared in this ledger', 'इस पंजी में परिणाम')}</span>
              <span className="text-xs text-ink-faint"><span className="tnum font-semibold text-ink">{track.evaluated}</span> {pick(lang, 'checks', 'जाँचें')}</span>
            </p>
            <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-paper-deep" role="img"
              aria-label={`${track.improved} ${pick(lang, 'gain shown', 'सुधार दिखा')}, ${track.not} ${pick(lang, 'no gain', 'सुधार नहीं')}, ${track.inc} ${pick(lang, 'inconclusive', 'अनिर्णीत')}`}>
              {track.improved ? <span className="h-full bg-good" style={{ width: `${(100 * track.improved) / Math.max(1, track.evaluated)}%` }} /> : null}
              {track.not ? <span className="h-full bg-warn" style={{ width: `${(100 * track.not) / Math.max(1, track.evaluated)}%` }} /> : null}
              {track.inc ? <span className="h-full bg-navy-200" style={{ width: `${(100 * track.inc) / Math.max(1, track.evaluated)}%` }} /> : null}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { en: 'Gain shown', hi: 'सुधार दिखा', n: track.improved, dot: 'bg-good' },
                { en: 'No gain', hi: 'सुधार नहीं', n: track.not, dot: 'bg-warn' },
                { en: 'Inconclusive', hi: 'अनिर्णीत', n: track.inc, dot: 'bg-navy-200' },
              ].map((x) => (
                <div key={x.en} className="rounded-lg bg-paper-sunk px-2 py-1.5">
                  <dt className="flex items-center justify-center gap-1 text-2xs text-ink-soft"><span className={`h-2 w-2 rounded-full ${x.dot}`} />{pick(lang, x.en, x.hi)}</dt>
                  <dd className="tnum text-md font-semibold text-ink">{x.n}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-2xs text-ink-faint">{triedCount} {pick(lang, 'of', 'में से')} {rows.length} {pick(lang, 'options have been checked at least once. Aggregate only; not a causal estimate.', 'विकल्प कम से कम एक बार जाँचे गए। केवल कुल योग; कारण का अनुमान नहीं।')}</p>
          </div>
        </section>
      )}

      <form method="get" action="/interventions" className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
        {view === 'table' ? <input type="hidden" name="view" value="table" /> : null}
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder={pick(lang, 'Search interventions…', 'हस्तक्षेप खोजें…')} aria-label={pick(lang, 'Search interventions', 'हस्तक्षेप खोजें')} className="input h-9 pl-9 text-sm" />
        </div>
        <select name="subject" defaultValue={sp.subject ?? ''} className={sel} aria-label={pick(lang, 'Subject', 'विषय')}><option value="">{pick(lang, 'All subjects', 'सभी विषय')}</option><option value="numeracy">{cat('numeracy')}</option><option value="literacy">{cat('literacy')}</option></select>
        <select name="category" defaultValue={sp.category ?? ''} className={sel} aria-label={pick(lang, 'Type', 'प्रकार')}><option value="">{pick(lang, 'All types', 'सभी प्रकार')}</option>{Object.keys(CATEGORY).map((k) => <option key={k} value={k}>{cat(k)}</option>)}</select>
        <select name="lever" defaultValue={sp.lever ?? ''} className={sel} aria-label={pick(lang, 'Approval authority', 'स्वीकृति अधिकार')}><option value="">{pick(lang, 'Any authority', 'कोई भी अधिकार')}</option><option value="block">{lever('block')}</option><option value="district">{lever('district')}</option><option value="pab">PAB</option></select>
        <select name="evidence" defaultValue={sp.evidence ?? ''} className={sel} aria-label={pick(lang, 'Evidence', 'आधार')}><option value="">{pick(lang, 'Any evidence', 'कोई भी आधार')}</option><option value="sourced_summary_verify">{pick(lang, 'Cites a source', 'स्रोत उद्धृत')}</option><option value="illustrative">{pick(lang, 'No effect claim', 'प्रभाव का दावा नहीं')}</option></select>
        <button type="submit" className="btn-quiet h-9"><Icon name="filter" size={14} />{pick(lang, 'Apply', 'लागू करें')}</button>
        {filtered ? <Link href={caseId ? `/interventions?case=${caseId}` : '/interventions'} className="btn-ghost h-9">{pick(lang, 'Clear', 'हटाएँ')}</Link> : null}
      </form>

      {lib && lib.cases.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-4" aria-labelledby="tried-title">
          <h2 id="tried-title" className="text-sm font-semibold text-ink">{pick(lang, 'Tried before in your area, and checked', 'आपके क्षेत्र में पहले आज़माया गया, और जाँचा गया')}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">{pick(lang, 'Cases with an outcome check that match your search: what was tried, and what the next assessment showed.', 'खोज से मेल खाते, परिणाम-जाँच वाले प्रकरण: क्या आज़माया गया, और अगले आकलन ने क्या दिखाया।')}</p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {lib.cases.map((c) => {
              const good = c.outcome?.category === 'improved_confirmed' || c.outcome?.category === 'improved_indicative';
              return (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className={`block h-full rounded-xl border border-line border-l-4 px-3 py-2 hover:border-line-strong ${good ? 'border-l-sev-improving' : 'border-l-warn'}`}>
                    <span className="block text-sm font-medium text-ink">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{c.detail}</span>
                    <span className={`mt-1 inline-block text-xs font-medium ${good ? 'text-good' : 'text-warn'}`}>
                      {(c.outcome?.category ?? '').replace(/_/g, ' ')}{c.outcome?.did_pp == null ? '' : ` · ${c.outcome.did_pp > 0 ? '+' : ''}${c.outcome.did_pp} pp`}
                    </span>
                    <span className="ml-1 font-mono text-2xs text-ink-faint">{c.id}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <form method="get" action="/interventions/compare" className="space-y-3">
        {caseId ? <input type="hidden" name="case" value={caseId} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-ink-soft"><span className="font-medium text-ink">{shown.length}</span> {pick(lang, 'interventions', 'हस्तक्षेप')}{ranked ? ` · ${pick(lang, 'ranked by fit', 'उपयुक्तता के क्रम में')}` : ''} <span className="text-ink-faint">· {pick(lang, 'tick two or three to compare', 'तुलना हेतु दो या तीन चुनें')}</span></p>
          <span className="ml-auto inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={pick(lang, 'View', 'दृश्य')}>
            <Link href={link({ view: undefined })} aria-current={view === 'cards' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'cards' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="grid" size={14} />{pick(lang, 'Cards', 'कार्ड')}</Link>
            <Link href={link({ view: 'table' })} aria-current={view === 'table' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'table' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="list" size={14} />{pick(lang, 'Table', 'तालिका')}</Link>
          </span>
          <button type="submit" className="btn-primary btn-sm"><Icon name="scale" size={14} />{pick(lang, 'Compare selected', 'चुने हुए की तुलना')}</button>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-12 text-center text-sm text-ink-faint">{pick(lang, 'No interventions match these filters.', 'इन छन्नों से कोई हस्तक्षेप मेल नहीं खाता।')}</div>
        ) : view === 'cards' ? (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map(({ iv, m }, idx) => {
              const h = hist.get(iv.id);
              const auth = m?.authority ?? authorityFor(session, iv.lever);
              const stripe = m && !m.eligible ? 'bg-line-strong' : m?.isCurrentPlan ? 'bg-brand' : iv.evidence.status === 'sourced_summary_verify' ? 'bg-amber' : 'bg-navy-600/40';
              return (
                <li key={iv.id} className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white p-4 pl-5 transition-colors hover:border-line-strong ${m?.isCurrentPlan ? 'border-brand/40' : 'border-line'} ${m && !m.eligible ? 'opacity-60' : ''}`}>
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 hover:border-line-strong">
                      <input type="checkbox" name="id" value={iv.id} aria-label={`${pick(lang, 'Compare', 'तुलना')} ${iv.name}`} className="h-3.5 w-3.5 accent-brand" defaultChecked={Boolean(m?.isCurrentPlan)} />
                      <span>{pick(lang, 'Compare', 'तुलना')}</span>
                    </label>
                    <span className="font-mono">{iv.id}</span><span>· {cat(iv.category)}</span>
                    {m && m.eligible ? <span className="ml-auto inline-flex items-center gap-1"><span className="tnum rounded bg-navy px-1.5 py-0.5 text-2xs font-semibold text-white">{m.points} {pick(lang, 'pts', 'अंक')}</span><span className="text-2xs">#{idx + 1}</span></span> : null}
                  </span>
                  <Link href={`/interventions/${iv.id}${caseId ? `?case=${caseId}` : ''}`} className="mt-2 line-clamp-2 text-md font-semibold leading-snug text-ink hover:text-brand">{iv.name}</Link>
                  <p className="mt-1 line-clamp-2 text-sm leading-snug text-ink-soft">{iv.description}</p>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <EvidenceStrength status={iv.evidence.status} lang={lang} />
                    {m?.isCurrentPlan ? <span className="chip border-brand/30 bg-brand-light text-brand">{pick(lang, 'Current plan', 'वर्तमान योजना')}</span> : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-paper-sunk px-2 py-0.5 text-ink-soft">{pick(lang, 'Class', 'कक्षा')} {iv.grades.join(', ')}</span>
                  </span>
                  {m && !m.eligible ? <p className="mt-1.5 text-xs text-ink-faint">{pick(lang, 'Not a fit', 'अनुपयुक्त')}: {m.excludedBecause}</p> : null}
                  {m && m.eligible && m.risks.length ? <p className="mt-1.5 text-xs text-warn"><Icon name="alert" size={12} className="mr-1 inline" />{m.risks[0].text}</p> : null}
                  <span className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                    <span className="min-w-0"><span className="block text-2xs text-ink-faint">{pick(lang, 'Approval', 'स्वीकृति')}</span><span className="block truncate font-medium text-ink">{lever(iv.lever)}</span>{auth.canApprove ? <span className="block text-2xs text-good">{pick(lang, 'you can approve', 'आप स्वीकृत कर सकते हैं')}</span> : null}</span>
                    <span className="min-w-0"><span className="block text-2xs text-ink-faint">{isRealCost(iv.cost_basis) ? pick(lang, 'Cost (UP PAB 2025-26)', 'लागत (उ.प्र. PAB 2025-26)') : pick(lang, 'Cost (illustrative)', 'लागत (उदाहरण)')}</span><span className="tnum block font-medium text-ink">{fmtInr(iv.cost_basis.amount_inr)}</span><span className="block truncate text-2xs text-ink-faint" title={iv.cost_basis.unit}>{unitLabel(iv.cost_basis.unit, lang)}{isRealCost(iv.cost_basis) ? ` · ${pick(lang, 'p.', 'पृ.')} ${iv.cost_basis.citation?.pdf_page}${iv.cost_basis.basis === 'pab_proxy' ? pick(lang, ' (nearest line)', ' (निकटतम पंक्ति)') : ''}` : ''}</span></span>
                    <span className="min-w-0"><span className="block text-2xs text-ink-faint">{pick(lang, 'Track record', 'पिछला परिणाम')}</span>{h && h.evaluated ? <span className="block font-medium text-ink"><span className="tnum">{h.improved}/{h.evaluated}</span> <span className="font-normal text-ink-faint">{pick(lang, 'gained', 'सुधरे')}</span></span> : <span className="block text-ink-faint">{pick(lang, 'not evaluated', 'जाँचा नहीं')}</span>}<span className="block text-2xs text-ink-faint">{iv.duration_weeks ? `${iv.duration_weeks} ${pick(lang, 'weeks', 'सप्ताह')}` : pick(lang, 'PAB cycle', 'PAB चक्र')}</span></span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="overflow-x-auto">
              <table className="table min-w-[980px]">
                <thead>
                  <tr>
                    <th className="w-10"><span className="sr-only">{pick(lang, 'Compare', 'तुलना')}</span></th>
                    <th>{pick(lang, 'Intervention', 'हस्तक्षेप')}</th>
                    {ranked ? <th className="text-right">{pick(lang, 'Fit', 'उपयुक्तता')}</th> : null}
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
                        <td><input type="checkbox" name="id" value={iv.id} aria-label={`${pick(lang, 'Compare', 'तुलना')} ${iv.name}`} className="h-4 w-4 accent-brand" defaultChecked={Boolean(m?.isCurrentPlan)} /></td>
                        <td className="max-w-[440px]">
                          <Link href={`/interventions/${iv.id}${caseId ? `?case=${caseId}` : ''}`} className="text-base font-medium text-ink hover:text-brand">{iv.name}</Link>
                          {m?.isCurrentPlan ? <span className="chip ml-2 border-brand/30 bg-brand-light text-brand">{pick(lang, 'Current plan', 'वर्तमान योजना')}</span> : null}
                          <p className="mt-0.5 text-xs text-ink-faint"><span className="font-mono">{iv.id}</span> · {cat(iv.category)} · {pick(lang, 'Class', 'कक्षा')} {iv.grades.join(', ')} · {iv.competency_ids.map((c) => comps.get(c) ?? c).slice(0, 3).join(', ')}{iv.competency_ids.length > 3 ? '…' : ''}</p>
                          {m && !m.eligible ? <p className="mt-0.5 text-xs text-ink-faint">{pick(lang, 'Not a fit', 'अनुपयुक्त')}: {m.excludedBecause}</p> : null}
                          {m && m.eligible && m.risks.length ? <p className="mt-0.5 text-xs text-warn"><Icon name="alert" size={12} className="mr-1 inline" />{m.risks[0].text}</p> : null}
                        </td>
                        {ranked ? <td className="text-right">{m && m.eligible ? <span className="inline-flex flex-col items-end"><span className="tnum whitespace-nowrap rounded bg-navy px-1.5 py-0.5 text-xs font-semibold text-white">{m.points} {pick(lang, 'pts', 'अंक')}</span><span className="mt-0.5 text-2xs text-ink-faint">#{idx + 1}</span></span> : <span className="text-ink-faint">—</span>}</td> : null}
                        <td><EvidenceStrength status={iv.evidence.status} lang={lang} /></td>
                        <td className="text-sm">{lever(iv.lever)}{auth.canApprove ? <span className="block text-xs text-good">{pick(lang, 'you can approve', 'आप स्वीकृत कर सकते हैं')}</span> : null}</td>
                        <td className="tnum text-right text-sm">{fmtInr(iv.cost_basis.amount_inr)}<span className="block text-2xs text-ink-faint">{unitLabel(iv.cost_basis.unit, lang)}</span><span className="mt-0.5 block"><CostSource cost={iv.cost_basis} lang={lang} /></span></td>
                        <td className="whitespace-nowrap text-sm">{iv.duration_weeks ? `${iv.duration_weeks} ${pick(lang, 'weeks', 'सप्ताह')}` : pick(lang, 'PAB cycle', 'PAB चक्र')}</td>
                        <td className="text-sm">{h && h.evaluated ? <><span className="font-medium text-ink">{h.improved}/{h.evaluated}</span> <span className="text-ink-faint">{pick(lang, 'gained', 'सुधरे')}</span></> : <span className="text-ink-faint">{pick(lang, 'not evaluated', 'जाँचा नहीं')}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </form>

      <p className="text-xs text-ink-faint">{pick(lang, 'All costs are illustrative card figures, never PAB unit costs. INT-01–03 quote J-PAL’s TaRL policy insight and are flagged “verify before production”.', 'सभी लागतें उदाहरणार्थ हैं, PAB इकाई लागत नहीं। INT-01–03 J-PAL के TaRL नीति-सार को उद्धृत करते हैं और “उपयोग से पहले जाँचें” चिह्नित हैं।')}</p>
    </div>
  );
}
