import Link from 'next/link';
import type { Language } from '@domain/types';
import type { Case, Task, Evidence, Finding } from '@/lib/cases';
import { pick } from '@/lib/i18n';
import { Empty, Mono, Delta, fmtDate, fmtPct, fmtInt } from './ui';
import { GpsBadge } from './GpsBadge';
import {
  StatusPill, SeverityPill, TaskStatusPill, EvidenceStatusPill, OutcomePill, Pill,
  OverduePill, EscalatedPill, CrossSourcePill, EvidenceTypeName, RoleName,
} from './labels';
import { EvidenceSummary } from './EvidenceSummary';

/** Shared tables. Each row links to the record; none of them invent a number. */

export interface Lookups {
  users: Map<string, string>;
  schools: Map<string, string>;
  clusters: Map<string, string>;
  blocks: Map<string, string>;
  competencies: Map<string, string>;
}

const g = (m: Map<string, string>, id: string | null | undefined, f = '—') => (!id ? f : m.get(id) ?? id);

export function CaseTable({
  cases, look, lang, showBlock = true, emptyText,
}: { cases: Case[]; look: Lookups; lang: Language; showBlock?: boolean; emptyText?: string }) {
  if (cases.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{pick(lang, 'Case', 'प्रकरण')}</th>
            <th scope="col">{pick(lang, 'Where', 'कहाँ')}</th>
            <th scope="col">{pick(lang, 'Severity', 'गंभीरता')}</th>
            <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
            <th scope="col">{pick(lang, 'Officer', 'अधिकारी')}</th>
            <th scope="col">{pick(lang, 'Due', 'नियत')}</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id}>
              <td className="max-w-sm">
                <Link href={`/cases/${c.id}`} className="link font-medium">{c.title}</Link>
                <p className="mt-0.5 text-xs text-ink-faint">
                  <Mono>{c.id}</Mono> · {pick(lang, 'Class', 'कक्षा')} {c.grade} ·{' '}
                  {g(look.competencies, c.competency_id)}
                  {c.reopen_count > 0 ? (
                    <> · <span className="text-warn">{pick(lang, 'reopened', 'फिर खोला')} ×{c.reopen_count}</span></>
                  ) : null}
                </p>
              </td>
              <td className="text-sm">
                {g(look.clusters, c.cluster_id)}
                {showBlock ? <span className="block text-xs text-ink-faint">{g(look.blocks, c.block_id)}</span> : null}
              </td>
              <td><SeverityPill severity={c.severity} lang={lang} /></td>
              <td className="space-y-1">
                <StatusPill status={c.status} lang={lang} />
                {c.closure_type ? <OutcomePill category={c.closure_type} lang={lang} /> : null}
              </td>
              <td className="text-sm">{g(look.users, c.owner_user_id)}</td>
              <td className="tnum whitespace-nowrap text-sm">{fmtDate(c.due_date, false, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FindingTable({
  findings, look, lang, emptyText,
}: { findings: Finding[]; look: Lookups; lang: Language; emptyText?: string }) {
  if (findings.length === 0) return <Empty>{emptyText}</Empty>;
  const statusPill = (s: string) => {
    const map: Record<string, { tone: 'good' | 'warn' | 'neutral' | 'critical'; en: string; hi: string }> = {
      case_opened: { tone: 'critical', en: 'Case opened', hi: 'प्रकरण खुला' },
      monitoring: { tone: 'warn', en: 'Watching', hi: 'निगरानी' },
      rejected_noise: { tone: 'neutral', en: 'Rejected as noise', hi: 'अस्थिरता मानकर ख़ारिज' },
      rejected_data_quality: { tone: 'neutral', en: 'Rejected — data quality', hi: 'डेटा गुणवत्ता से ख़ारिज' },
      manual: { tone: 'neutral', en: 'Opened by hand', hi: 'स्वयं खोला' },
    };
    const m = map[s] ?? { tone: 'neutral' as const, en: s, hi: s };
    return <Pill tone={m.tone}>{pick(lang, m.en, m.hi)}</Pill>;
  };
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{pick(lang, 'Cluster', 'संकुल')}</th>
            <th scope="col">{pick(lang, 'What', 'क्या')}</th>
            <th scope="col">{pick(lang, 'Then → now', 'पहले → अब')}</th>
            <th scope="col">{pick(lang, 'Beyond district', 'ज़िले से अधिक')}</th>
            <th scope="col">z</th>
            <th scope="col">{pick(lang, 'Students', 'छात्र')}</th>
            <th scope="col">{pick(lang, 'Outcome', 'परिणाम')}</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id}>
              <td className="text-sm">
                {f.case_id ? (
                  <Link href={`/cases/${f.case_id}`} className="link font-medium">{g(look.clusters, f.cluster_id)}</Link>
                ) : (
                  <Link href={`/findings/${f.id}`} className="link font-medium">{g(look.clusters, f.cluster_id)}</Link>
                )}
                <span className="block text-xs text-ink-faint">{g(look.blocks, f.block_id)}</span>
              </td>
              <td className="text-sm">
                {pick(lang, 'Class', 'कक्षा')} {f.grade} · {g(look.competencies, f.competency_id)}
              </td>
              <td className="tnum whitespace-nowrap text-sm">
                {fmtPct(f.prev_value_pct)} → <span className="font-medium">{fmtPct(f.curr_value_pct)}</span>
              </td>
              <td><Delta pp={f.relative_change_pp} /></td>
              <td className="tnum text-sm">{f.z_score}</td>
              <td className="tnum text-sm text-ink-soft">{fmtInt(f.n_curr)}</td>
              <td>
                {statusPill(f.status)}
                {f.case_id ? <span className="ml-1"><Mono>{f.case_id}</Mono></span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskTable({
  tasks, look, lang, today, showCase = true, emptyText,
}: { tasks: Task[]; look: Lookups; lang: Language; today: string; showCase?: boolean; emptyText?: string }) {
  if (tasks.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{pick(lang, 'Task', 'काम')}</th>
            {showCase ? <th scope="col">{pick(lang, 'Case', 'प्रकरण')}</th> : null}
            <th scope="col">{pick(lang, 'Owner', 'ज़िम्मेदार')}</th>
            <th scope="col">{pick(lang, 'Proof', 'सबूत')}</th>
            <th scope="col">{pick(lang, 'Due', 'नियत')}</th>
            <th scope="col">{pick(lang, 'Status', 'स्थिति')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const days = Math.round(
              (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due_date.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
            );
            return (
              <tr key={t.id}>
                <td className="max-w-md">
                  <Link href={`/tasks/${t.id}`} className="link">{pick(lang, t.title_en, t.title_hi)}</Link>
                  {t.cross_source ? <span className="ml-1.5"><CrossSourcePill lang={lang} /></span> : null}
                  {t.school_id ? (
                    <p className="mt-0.5 text-xs text-ink-faint">{g(look.schools, t.school_id)}</p>
                  ) : null}
                </td>
                {showCase ? (
                  <td className="text-sm">
                    <Link href={`/cases/${t.case_id}`} className="link"><Mono>{t.case_id}</Mono></Link>
                  </td>
                ) : null}
                <td className="text-sm">
                  {g(look.users, t.owner_user_id)}
                  <span className="block text-xs text-ink-faint"><RoleName role={t.owner_role} lang={lang} /></span>
                </td>
                <td className="text-sm">
                  {t.proof_count} × <EvidenceTypeName type={t.proof_type} lang={lang} />
                </td>
                <td className="tnum whitespace-nowrap text-sm">{fmtDate(t.due_date, false, lang)}</td>
                <td className="space-y-1">
                  <TaskStatusPill status={t.status} lang={lang} />
                  {t.is_overdue ? <OverduePill lang={lang} days={days} /> : null}
                  {t.escalated_at ? <EscalatedPill lang={lang} /> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EvidenceList({
  evidence, look, lang, children, emptyText,
}: {
  evidence: Evidence[]; look: Lookups; lang: Language; emptyText?: string;
  /** Rendered per row, for the verify/send-back form. */
  children?: (e: Evidence) => React.ReactNode;
}) {
  if (evidence.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {evidence.map((e) => (
        <li key={e.id} className="px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  <EvidenceTypeName type={e.evidence_type} lang={lang} />
                </span>
                <EvidenceStatusPill status={e.status} lang={lang} />
                <GpsBadge status={e.gps_status} distance={e.gps_distance_m} accuracy={e.gps_accuracy_m} lang={lang} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                <Link href={`/cases/${e.case_id}`} className="link"><Mono>{e.case_id}</Mono></Link>
                {' · '}
                <Link href={`/tasks/${e.task_id}`} className="link"><Mono>{e.task_id}</Mono></Link>
                {e.school_id ? <> · {g(look.schools, e.school_id)}</> : null}
                {' · '}
                {pick(lang, 'by', 'द्वारा')} {g(look.users, e.submitted_by)}{' '}
                (<RoleName role={e.submitted_role} lang={lang} />) {fmtDate(e.submitted_at, false, lang)}
              </p>
              <EvidenceSummary id={e.id} summary={e.summary} lang={lang} />
            </div>
            {children ? <div className="shrink-0 no-print">{children(e)}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A row of filter links that preserve the rest of the query string. */
export function FilterChips({
  base, param, options, current, lang,
}: {
  base: string; param: string;
  options: { value: string; label: string; count?: number }[];
  current?: string; lang: Language;
}) {
  return (
    <nav aria-label={pick(lang, 'Filter', 'छानें')} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = (current ?? '') === o.value;
        const href = o.value ? `${base}?${param}=${encodeURIComponent(o.value)}` : base;
        return (
          <Link
            key={o.value || 'all'}
            href={href}
            aria-current={active ? 'true' : undefined}
            className={`chip ${active ? 'border-brand bg-brand text-white' : 'border-line-strong bg-white text-ink-soft hover:bg-paper-sunk'}`}
          >
            {o.label}
            {o.count !== undefined ? <span className="tnum opacity-70"> {o.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
