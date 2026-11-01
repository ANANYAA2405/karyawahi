import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listCases, countCases, type CaseFilter } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { scopeName, blocks, clusters, competencies } from '@/lib/repo';
import { all } from '@/lib/db';
import { tasksPred, and } from '@/lib/scope';
import { today, daysBetween } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { PageHead, Mono, fmtDate } from '@/components/ui';
import { StatusPill, OutcomePill } from '@/components/labels';
import { nextAction, STAGES, stageIndex, statusesForStage } from '@/lib/case-stage';
import { Icon } from '@/components/Icon';
import type { CaseStatus, Severity } from '@domain/types';

/**
 * Cases & action plans. The page opens on a picture: the seven stages from detection to a
 * verified outcome, each with its count, and the cases as cards that show how far each one has
 * come and what happens next. Quick views (open, critical, waiting on a decision, late…), a
 * stage filter, search and a table view for whoever wants one — all in the URL.
 */

const SEV_WORD: Record<Severity, { en: string; hi: string }> = { critical: { en: 'Critical', hi: 'अति गंभीर' }, high: { en: 'High', hi: 'उच्च' }, medium: { en: 'Medium', hi: 'मध्यम' } };
const OPEN: CaseStatus[] = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];

type SP = { tab?: string; status?: string; severity?: string; q?: string; order?: string; page?: string; block?: string; cluster?: string; district?: string; comp?: string; grade?: string; stage?: string; view?: string };

const SEV_BAR: Record<Severity, string> = { critical: 'bg-crit', high: 'bg-amber', medium: 'bg-ink-faint/50' };

const TABS: { key: string; en: string; hi: string; filter: Partial<CaseFilter> }[] = [
  { key: 'open', en: 'Open', hi: 'खुले', filter: { open: true } },
  { key: 'critical', en: 'Critical', hi: 'अति गंभीर', filter: { open: true, severity: ['critical'] } },
  { key: 'approval', en: 'Pending approval', hi: 'स्वीकृति लंबित', filter: { status: ['awaiting_approval', 'revision_requested'] } },
  { key: 'overdue', en: 'Overdue', hi: 'विलंबित', filter: { open: true, overdue: true } },
  { key: 'verification', en: 'Awaiting verification', hi: 'सत्यापन प्रतीक्षित', filter: { status: ['awaiting_verification', 'outcome_pending'] } },
  { key: 'reopened', en: 'Reopened', hi: 'फिर खोले', filter: { reopened: true } },
  { key: 'closed', en: 'Closed', hi: 'बंद', filter: { status: ['closed'] } },
  { key: 'all', en: 'All', hi: 'सभी', filter: {} },
];

export default async function CasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  // Back-compat: ?status=x from older links and the dashboard.
  let tabKey = sp.tab ?? (sp.status === 'open' ? 'open' : sp.status ? '' : sp.severity === 'critical' ? 'critical' : 'open');
  if (!TABS.some((t) => t.key === tabKey)) tabKey = '';
  const tab = TABS.find((t) => t.key === tabKey);

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const perPage = 25;
  const base: CaseFilter = {
    q: sp.q?.trim().slice(0, 80) || undefined,
    blockId: sp.block || undefined, clusterId: sp.cluster || undefined, districtId: sp.district || undefined,
    competencyId: sp.comp || undefined,
    grade: ['1', '2', '3'].includes(sp.grade ?? '') ? Number(sp.grade) : undefined,
  };
  const stage = /^[0-6]$/.test(sp.stage ?? '') ? Number(sp.stage) : null;
  const filter: CaseFilter = {
    ...base,
    ...(tab ? tab.filter : sp.status && sp.status !== 'open' ? { status: [sp.status as CaseStatus] } : {}),
    ...(stage !== null ? { status: statusesForStage(stage), open: undefined } : {}),
    ...(sp.severity && tabKey !== 'critical' ? { severity: [sp.severity as Severity] } : {}),
    order: (['severity', 'recent', 'due', 'oldest'].includes(sp.order ?? '') ? sp.order : 'severity') as CaseFilter['order'],
    limit: perPage, offset: (page - 1) * perPage,
  };

  const cases = listCases(session, filter);
  const total = countCases(session, { ...filter, limit: undefined, offset: undefined });
  const tabCounts = Object.fromEntries(TABS.map((t) => [t.key, countCases(session, { ...base, ...t.filter })]));
  const stageCounts = STAGES.map((_, i) => countCases(session, { ...base, status: statusesForStage(i) }));
  const stageMax = Math.max(1, ...stageCounts);
  const view = sp.view === 'table' ? 'table' : 'cards';
  const look = lookupsFor(lang, { users: cases.map((c) => c.owner_user_id) });

  // Overdue task counts for the rows on this page.
  const ids = cases.map((c) => c.id);
  const late = new Map<string, number>();
  if (ids.length) {
    const p = and(tasksPred(session, 't'), { sql: `t.case_id in (${ids.map(() => '?').join(',')}) and t.submitted_at is null and t.due_date < ?`, params: [...ids, today()] });
    for (const r of all<{ case_id: string; n: number }>(`select t.case_id, count(*) n from tasks t where ${p.sql} group by t.case_id`, ...p.params)) late.set(r.case_id, Number(r.n));
  }

  const showBlock = session.scope_type === 'state' || session.scope_type === 'district';
  const blockOpts = showBlock ? blocks(session.scope_type === 'district' ? session.scope_id : undefined) : [];
  const clusterOpts = session.scope_type === 'block' ? clusters(session.scope_id) : sp.block ? clusters(sp.block) : [];
  const comps = competencies();

  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged: SP = { ...sp, ...patch };
    if ('tab' in patch) { delete merged.status; delete merged.severity; delete merged.stage; }
    if ('stage' in patch && patch.stage) { delete merged.tab; delete merged.status; }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    if (!('page' in patch)) p.delete('page');
    return `/cases${p.toString() ? `?${p}` : ''}`;
  };
  const sel = 'h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15';
  const filtersActive = Boolean(base.q || base.blockId || base.clusterId || base.districtId || base.competencyId || base.grade);

  const initials = (name: string) => name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Cases', 'प्रकरण')}
        sub={pick(lang, 'Each case is one learning decline, followed from detection to a verified outcome.', 'प्रत्येक प्रकरण एक गिरावट है, पहचान से सत्यापित परिणाम तक।')}
        meta={<>{scopeName(session.scope_type, session.scope_id)} · {tabCounts.open} {pick(lang, 'open', 'खुले')} · {tabCounts.approval} {pick(lang, 'awaiting approval', 'स्वीकृति लंबित')}</>}
        right={
          <div className="flex gap-2">
            <Link href="/hotspots" className="btn-quiet"><Icon name="map" size={15} />{pick(lang, 'Map', 'मानचित्र')}</Link>
            <Link href="/approvals" className="btn-primary"><Icon name="shield" size={15} />{pick(lang, 'Review approvals', 'स्वीकृतियाँ देखें')}</Link>
          </div>
        }
      />

      {/* The stage river: where every case stands, from detection to a verified outcome. */}
      <nav aria-label={pick(lang, 'Cases by stage', 'चरण के अनुसार प्रकरण')} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
        <ol className="grid grid-cols-7 items-end gap-1.5 sm:gap-3">
          {STAGES.map((st, i) => {
            const on = stage === i;
            const n = stageCounts[i];
            return (
              <li key={st.key} className="min-w-0">
                <Link href={link({ stage: on ? undefined : String(i), tab: undefined })} aria-current={on ? 'page' : undefined}
                  className={`group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors ${on ? 'bg-brand-light' : 'hover:bg-paper-sunk'}`}>
                  <span className={`tnum text-lg font-semibold leading-none sm:text-xl ${n ? 'text-ink' : 'text-ink-faint'}`}>{n}</span>
                  <span className="flex h-14 w-full items-end justify-center" aria-hidden>
                    <span className={`w-full max-w-[56px] rounded-t-lg ${i === 6 ? 'bg-good/70' : i >= 4 ? 'bg-brand/70' : i >= 2 ? 'bg-amber/80' : 'bg-crit/70'} ${on ? 'ring-2 ring-brand ring-offset-2' : ''}`}
                      style={{ height: `${Math.max(6, Math.round((56 * n) / stageMax))}px` }} />
                  </span>
                  <span className={`w-full truncate text-center text-2xs sm:text-xs ${on ? 'font-semibold text-brand' : 'text-ink-soft'}`}>{pick(lang, st.en, st.hi)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="mt-1 h-1 rounded-full bg-gradient-to-r from-crit/40 via-amber/40 via-60% to-good/50" aria-hidden />
      </nav>

      {/* Quick views, search and filters in one quiet row. */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => {
          const on = t.key === tabKey && stage === null;
          return (
            <Link key={t.key} href={link({ tab: t.key })} aria-current={on ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink'}`}>
              {pick(lang, t.en, t.hi)}
              <span className={`tnum text-2xs font-semibold ${on ? 'text-white/80' : t.key === 'critical' && tabCounts[t.key] ? 'text-crit' : t.key === 'overdue' && tabCounts[t.key] ? 'text-warn' : 'text-ink-faint'}`}>{tabCounts[t.key]}</span>
            </Link>
          );
        })}
      </div>

      <form method="get" action="/cases" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value={tabKey || 'all'} />
        {stage !== null ? <input type="hidden" name="stage" value={String(stage)} /> : null}
        <input type="hidden" name="view" value={view} />
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder={pick(lang, 'Search case titles or ids…', 'शीर्षक या आईडी खोजें…')} aria-label="Search cases" className="input h-9 rounded-xl pl-9 text-sm" />
        </div>
        {showBlock ? (
          <select name="block" defaultValue={sp.block ?? ''} className={sel} aria-label="Block">
            <option value="">{pick(lang, 'All blocks', 'सभी खंड')}</option>
            {blockOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
        {clusterOpts.length ? (
          <select name="cluster" defaultValue={sp.cluster ?? ''} className={sel} aria-label="Cluster">
            <option value="">{pick(lang, 'All clusters', 'सभी संकुल')}</option>
            {clusterOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
        <select name="grade" defaultValue={sp.grade ?? ''} className={sel} aria-label="Grade">
          <option value="">{pick(lang, 'All classes', 'सभी कक्षाएँ')}</option><option value="1">Class 1</option><option value="2">Class 2</option><option value="3">Class 3</option>
        </select>
        <select name="comp" defaultValue={sp.comp ?? ''} className={sel} aria-label="Competency">
          <option value="">{pick(lang, 'All competencies', 'सभी दक्षताएँ')}</option>
          {comps.map((c) => <option key={c.id} value={c.id}>{pick(lang, c.name_en, c.name_hi)}</option>)}
        </select>
        <select name="order" defaultValue={sp.order ?? 'severity'} className={sel} aria-label="Sort">
          <option value="severity">{pick(lang, 'Sort: severity', 'क्रम: गंभीरता')}</option>
          <option value="recent">{pick(lang, 'Sort: last updated', 'क्रम: हाल में')}</option>
          <option value="due">{pick(lang, 'Sort: due date', 'क्रम: नियत तिथि')}</option>
          <option value="oldest">{pick(lang, 'Sort: oldest first', 'क्रम: पुराने')}</option>
        </select>
        <button type="submit" className="btn-quiet h-9"><Icon name="filter" size={14} />{pick(lang, 'Apply', 'लागू करें')}</button>
        {filtersActive ? <Link href={link({ q: undefined, block: undefined, cluster: undefined, district: undefined, comp: undefined, grade: undefined })} className="btn-ghost h-9">{pick(lang, 'Clear', 'हटाएँ')}</Link> : null}
        <span className="ml-auto inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={pick(lang, 'View', 'दृश्य')}>
          <Link href={link({ view: undefined })} aria-current={view === 'cards' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'cards' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="grid" size={14} />{pick(lang, 'Cards', 'कार्ड')}</Link>
          <Link href={link({ view: 'table' })} aria-current={view === 'table' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'table' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="list" size={14} />{pick(lang, 'Table', 'तालिका')}</Link>
        </span>
      </form>

      <p className="text-sm text-ink-soft">
        <span className="font-medium text-ink">{stage !== null ? pick(lang, STAGES[stage].en, STAGES[stage].hi) : tab ? pick(lang, tab.en, tab.hi) : sp.status ?? pick(lang, 'Cases', 'प्रकरण')}</span>
        {' · '}{total} {pick(lang, 'in scope', 'दायरे में')}
        {total > perPage ? <span className="tnum text-ink-faint"> · {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)}</span> : null}
      </p>

      {cases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
          <Icon name="briefcase" size={28} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-medium text-ink">{pick(lang, 'No cases match', 'कोई प्रकरण नहीं मिला')}</p>
          <p className="mt-1 text-sm text-ink-soft">{filtersActive ? pick(lang, 'Try clearing a filter.', 'कोई फ़िल्टर हटाएँ।') : pick(lang, 'Nothing in this view right now.', 'इस दृश्य में अभी कुछ नहीं।')}</p>
        </div>
      ) : view === 'cards' ? (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {cases.map((c) => {
            const overdue = late.get(c.id) ?? 0;
            const dueLate = c.due_date && c.due_date < today() && OPEN.includes(c.status);
            const next = nextAction(c.status);
            const at = stageIndex(c.status);
            const owner = look.users.get(c.owner_user_id) ?? c.owner_user_id;
            return (
              <li key={c.id}>
                <Link href={`/cases/${c.id}`} className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white p-4 pl-5 transition-colors hover:border-line-strong">
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${SEV_BAR[c.severity]}`} aria-hidden />
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    <span className="font-mono">{c.id}</span>
                    <span className="truncate">· {look.clusters.get(c.cluster_id) ?? c.cluster_id}{showBlock ? `, ${look.blocks.get(c.block_id) ?? c.block_id}` : ''}</span>
                    <span className="ml-auto shrink-0">{pick(lang, SEV_WORD[c.severity].en, SEV_WORD[c.severity].hi)}</span>
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-md font-semibold leading-snug text-ink group-hover:text-brand">{c.title}</span>
                  <span className="mt-0.5 text-xs text-ink-faint">{pick(lang, 'Class', 'कक्षा')} {c.grade} · {look.competencies.get(c.competency_id) ?? c.competency_id}</span>

                  {/* How far the case has come: seven steps, the current one ringed. */}
                  <span className="mt-3 flex items-center gap-1" role="img" aria-label={`${pick(lang, 'Stage', 'चरण')} ${at + 1} / 7: ${STAGES[at].en}`}>
                    {STAGES.map((st, i) => (
                      <span key={st.key} className={`h-1.5 flex-1 rounded-full ${i < at ? 'bg-brand/60' : i === at ? (c.status === 'closed' ? 'bg-good' : 'bg-brand') : 'bg-paper-deep'}`} />
                    ))}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2"><StatusPill status={c.status} lang={lang} />{c.closure_type ? <OutcomePill category={c.closure_type} lang={lang} /> : null}{c.reopen_count > 0 ? <span className="text-xs text-warn">{pick(lang, 'reopened', 'फिर खोला')} ×{c.reopen_count}</span> : null}</span>

                  <span className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-xs">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-100 text-2xs font-semibold text-navy-700" title={owner}>{initials(owner)}</span>
                    <span className={`tnum ${dueLate ? 'font-medium text-crit' : 'text-ink-soft'}`}>
                      <Icon name="calendar" size={12} className="mr-1 inline" />{fmtDate(c.due_date, false, lang)}
                      {overdue ? <span className="ml-1.5 text-crit">· {overdue} {pick(lang, 'late', 'विलंबित')}</span> : null}
                    </span>
                    <span className={`ml-auto inline-flex items-center gap-1 font-medium ${OPEN.includes(c.status) ? 'text-brand' : 'text-ink-faint'}`}>{pick(lang, next.en, next.hi)}{OPEN.includes(c.status) ? <Icon name="arrow-right" size={13} /> : null}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table min-w-[1080px]">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Case', 'प्रकरण')}</th>
                  <th scope="col">{pick(lang, 'Finding', 'निष्कर्ष')}</th>
                  <th scope="col">{pick(lang, 'Area', 'क्षेत्र')}</th>
                  <th scope="col">{pick(lang, 'Severity', 'गंभीरता')}</th>
                  <th scope="col">{pick(lang, 'Owner', 'उत्तरदायी')}</th>
                  <th scope="col">{pick(lang, 'Deadline', 'समय-सीमा')}</th>
                  <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
                  <th scope="col">{pick(lang, 'Next action', 'अगला कदम')}</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const overdue = late.get(c.id) ?? 0;
                  const dueLate = c.due_date && c.due_date < today() && OPEN.includes(c.status);
                  const next = nextAction(c.status);
                  return (
                    <tr key={c.id} className="group">
                      <td className="whitespace-nowrap">
                        <Link href={`/cases/${c.id}`} className="font-mono text-sm font-medium text-ink hover:text-brand">{c.id}</Link>
                        {c.reopen_count > 0 ? <span className="block text-xs text-warn">{pick(lang, 'reopened', 'फिर खोला')} ×{c.reopen_count}</span> : null}
                      </td>
                      <td className="max-w-[340px]">
                        <Link href={`/cases/${c.id}`} className="line-clamp-2 text-sm font-medium leading-snug text-ink hover:text-brand">{c.title}</Link>
                        <p className="mt-0.5 truncate text-xs text-ink-faint">{pick(lang, 'Class', 'कक्षा')} {c.grade} · {look.competencies.get(c.competency_id) ?? c.competency_id}</p>
                      </td>
                      <td className="text-sm">
                        {look.clusters.get(c.cluster_id) ?? c.cluster_id}
                        {showBlock ? <span className="block text-xs text-ink-faint">{look.blocks.get(c.block_id) ?? c.block_id}</span> : null}
                      </td>
                      <td className="whitespace-nowrap text-sm"><span className="inline-flex items-center gap-1.5"><span className={`dot ${c.severity === 'critical' ? 'bg-crit' : c.severity === 'high' ? 'bg-amber' : 'bg-ink-faint'}`} />{pick(lang, SEV_WORD[c.severity].en, SEV_WORD[c.severity].hi)}</span></td>
                      <td className="text-sm">{look.users.get(c.owner_user_id) ?? c.owner_user_id}</td>
                      <td className={`tnum whitespace-nowrap text-sm ${dueLate ? 'font-medium text-crit' : ''}`}>
                        {fmtDate(c.due_date)}
                        {overdue ? <span className="block text-xs font-normal text-crit">{overdue} {pick(lang, 'late task', 'विलंबित काम')}{overdue > 1 ? 's' : ''}</span> : null}
                      </td>
                      <td className="space-y-1"><StatusPill status={c.status} lang={lang} />{c.closure_type ? <OutcomePill category={c.closure_type} lang={lang} /> : null}</td>
                      <td className="text-sm">
                        <Link href={`/cases/${c.id}`} className={`${OPEN.includes(c.status) ? 'font-medium text-brand hover:text-brand-dark' : 'text-ink-faint'}`}>{pick(lang, next.en, next.hi)}{OPEN.includes(c.status) ? <Icon name="arrow-right" size={13} className="ml-1 inline" /> : null}</Link>
                        <span className="block text-xs text-ink-faint">{pick(lang, 'updated', 'अद्यतन')} {daysBetween(c.updated_at.slice(0, 10), today())}d ago</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {total > perPage ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={link({ page: String(page - 1) })} className="btn-quiet btn-sm"><Icon name="chevron-left" size={14} />{pick(lang, 'Previous', 'पिछला')}</Link> : <span />}
          <span className="tnum text-ink-faint">{pick(lang, 'Page', 'पृष्ठ')} {page} / {Math.ceil(total / perPage)}</span>
          {page * perPage < total ? <Link href={link({ page: String(page + 1) })} className="btn-quiet btn-sm">{pick(lang, 'Next', 'अगला')}<Icon name="chevron-right" size={14} /></Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
