import Link from 'next/link';
import type { Language } from '@domain/types';
import type { Rollup, Headline } from '@/lib/dash';
import { pick, OUTCOME_LABEL } from '@/lib/i18n';
import { Card, CardHead, Grid, Stat, Empty, Bar, fmtInt } from './ui';
import { Pill } from './labels';
import type { OutcomeCategory } from '@domain/types';

/** Panels shared by the role dashboards. */

export function HeadlineStats({ h, lang, basePath = '/cases' }: { h: Headline; lang: Language; basePath?: string }) {
  return (
    <Grid cols={5}>
      <Stat
        label={pick(lang, 'Open cases', 'खुले प्रकरण')} value={h.open_cases} tone="brand"
        href={`${basePath}?status=open`}
        sub={h.critical > 0 ? `${h.critical} ${pick(lang, 'critical', 'अति गंभीर')}` : undefined}
      />
      <Stat
        label={pick(lang, 'Waiting on a decision', 'निर्णय की प्रतीक्षा')} value={h.awaiting_approval} tone="pend"
        href="/approvals"
      />
      <Stat
        label={pick(lang, 'Overdue tasks', 'विलंबित काम')} value={h.overdue_tasks} tone={h.overdue_tasks > 0 ? 'crit' : 'neutral'}
        sub={h.escalated_tasks > 0 ? `${h.escalated_tasks} ${pick(lang, 'escalated', 'उच्चाधिकारी को')}` : undefined}
      />
      <Stat
        label={pick(lang, 'Proof to check', 'जाँचने योग्य सबूत')} value={h.evidence_pending} tone={h.evidence_pending > 0 ? 'warn' : 'neutral'}
        href="/evidence"
      />
      <Stat
        label={pick(lang, 'Closed on a verified gain', 'सत्यापित सुधार पर बंद')} value={h.closed_verified} tone="good"
        href={`${basePath}?status=closed`}
        sub={h.reopened > 0 ? `${h.reopened} ${pick(lang, 'reopened at least once', 'फिर खोले गए')}` : undefined}
      />
    </Grid>
  );
}

export function RollupTable({
  rows, lang, title, hint, label, hrefFor,
}: {
  rows: Rollup[]; lang: Language; title: string; hint?: string; label: string;
  hrefFor?: (r: Rollup) => string;
}) {
  return (
    <Card>
      <CardHead title={title} hint={hint} />
      {rows.length === 0 ? <Empty /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{label}</th>
                <th scope="col">{pick(lang, 'Open', 'खुले')}</th>
                <th scope="col">{pick(lang, 'Critical', 'अति गंभीर')}</th>
                <th scope="col">{pick(lang, 'Awaiting a decision', 'निर्णय प्रतीक्षित')}</th>
                <th scope="col">{pick(lang, 'Overdue tasks', 'विलंबित काम')}</th>
                <th scope="col">{pick(lang, 'Proof pending', 'सबूत प्रतीक्षित')}</th>
                <th scope="col">{pick(lang, 'Closed', 'बंद')}</th>
                <th scope="col">{pick(lang, 'Reopened', 'फिर खोले')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">
                    {hrefFor ? <Link href={hrefFor(r)} className="link">{r.name}</Link> : r.name}
                  </td>
                  <td className="tnum">{r.open_cases}</td>
                  <td className="tnum">
                    {r.critical > 0 ? <span className="font-semibold text-crit">{r.critical}</span> : <span className="text-ink-faint">0</span>}
                  </td>
                  <td className="tnum">{r.awaiting_approval || <span className="text-ink-faint">0</span>}</td>
                  <td className="tnum">
                    {r.overdue_tasks > 0 ? <span className="font-semibold text-crit">{r.overdue_tasks}</span> : <span className="text-ink-faint">0</span>}
                  </td>
                  <td className="tnum">{r.evidence_pending || <span className="text-ink-faint">0</span>}</td>
                  <td className="tnum text-good">{r.closed || <span className="text-ink-faint">0</span>}</td>
                  <td className="tnum">
                    {r.reopened > 0 ? <span className="text-warn">{r.reopened}</span> : <span className="text-ink-faint">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * How the closed and evaluated cases actually turned out.
 *
 * This panel is the honest counterweight to a dashboard of green numbers: "improved —
 * indicative" is not the same claim as "improved — confirmed", and worsened, no-change and
 * inconclusive are shown at the same size as the wins.
 */
export function OutcomeMix({
  rows, lang, title,
}: { rows: { category: string; c: number }[]; lang: Language; title?: string }) {
  const total = rows.reduce((t, r) => t + r.c, 0);
  const tone = (cat: string) =>
    cat === 'improved_confirmed' ? 'good'
    : cat === 'improved_indicative' ? 'good'
    : cat === 'worsened' ? 'crit'
    : cat === 'below_target' ? 'warn'
    : 'brand';
  return (
    <Card>
      <CardHead
        title={title ?? pick(lang, 'What the outcome checks found', 'परिणाम जाँच ने क्या पाया')}
        hint={pick(
          lang,
          'Every evaluation in scope, including the ones that found nothing. "Confirmed" means the interval excluded zero; "indicative" means it did not.',
          'आपके दायरे की हर जाँच, उन सहित जिनमें कुछ नहीं मिला। "पुष्ट" का अर्थ अंतराल शून्य से अलग था।',
        )}
      />
      {total === 0 ? <Empty /> : (
        <ul className="card-pad space-y-2">
          {rows.map((r) => {
            const l = OUTCOME_LABEL[r.category as OutcomeCategory];
            return (
              <li key={r.category} className="flex flex-wrap items-center gap-3">
                <span className="min-w-[13rem] text-sm text-ink">
                  {l ? pick(lang, l.en, l.hi) : r.category.replace(/_/g, ' ')}
                </span>
                <Bar value={r.c} max={Math.max(...rows.map((x) => x.c))} tone={tone(r.category) as 'good' | 'crit' | 'warn' | 'brand'} width={160} />
                <span className="tnum text-sm font-medium text-ink">{r.c}</span>
                <span className="tnum text-xs text-ink-faint">{Math.round((r.c / total) * 100)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function DetectionHealth({
  rows, lang,
}: { rows: { status: string; c: number }[]; lang: Language }) {
  const labels: Record<string, { en: string; hi: string; tone: 'critical' | 'warn' | 'neutral' }> = {
    case_opened: { en: 'Became a case', hi: 'प्रकरण बना', tone: 'critical' },
    monitoring: { en: 'Watching', hi: 'निगरानी', tone: 'warn' },
    rejected_noise: { en: 'Rejected as noise', hi: 'अस्थिरता', tone: 'neutral' },
    rejected_data_quality: { en: 'Too thin to judge', hi: 'डेटा अपर्याप्त', tone: 'neutral' },
    manual: { en: 'Opened by hand', hi: 'स्वयं खोला', tone: 'neutral' },
  };
  const total = rows.reduce((t, r) => t + r.c, 0);
  return (
    <Card>
      <CardHead
        title={pick(lang, 'What the detector did', 'पहचान-तंत्र ने क्या किया')}
        hint={pick(
          lang,
          'Candidates it refused are counted here too, so the thresholds can be argued with rather than trusted.',
          'जिन्हें ख़ारिज किया, वे भी गिने गए हैं, ताकि सीमाओं पर बहस हो सके।',
        )}
        right={<Link href="/findings" className="link text-sm">{pick(lang, 'All findings', 'सभी निष्कर्ष')}</Link>}
      />
      {total === 0 ? <Empty /> : (
        <ul className="card-pad space-y-2">
          {rows.map((r) => {
            const l = labels[r.status] ?? { en: r.status, hi: r.status, tone: 'neutral' as const };
            return (
              <li key={r.status} className="flex flex-wrap items-center gap-3">
                <span className="min-w-[12rem]"><Pill tone={l.tone}>{pick(lang, l.en, l.hi)}</Pill></span>
                <Bar value={r.c} max={Math.max(...rows.map((x) => x.c))} tone={l.tone === 'critical' ? 'crit' : l.tone === 'warn' ? 'warn' : 'brand'} width={160} />
                <span className="tnum text-sm font-medium text-ink">{fmtInt(r.c)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Latest-round proficiency by grade and competency. A small-multiples grid, not a heat map. */
export function CompetencyGrid({
  rows, competencyNames, lang, roundLabel,
}: {
  rows: { competency_id: string; grade: number; pct: number | null; prev_pct: number | null; n: number }[];
  competencyNames: Map<string, string>;
  lang: Language;
  roundLabel: string;
}) {
  const comps = [...new Set(rows.map((r) => r.competency_id))];
  return (
    <Card>
      <CardHead
        title={pick(lang, 'Where children are now', 'बच्चे अभी कहाँ हैं')}
        hint={`${pick(lang, 'Share at the grade benchmark,', 'ग्रेड मानक पर प्रतिशत,')} ${roundLabel}`}
      />
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{pick(lang, 'Competency', 'दक्षता')}</th>
              {[1, 2, 3].map((g) => (
                <th key={g} scope="col">{pick(lang, 'Class', 'कक्षा')} {g}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comps.map((cid) => (
              <tr key={cid}>
                <td className="font-medium">{competencyNames.get(cid) ?? cid}</td>
                {[1, 2, 3].map((g) => {
                  const r = rows.find((x) => x.competency_id === cid && x.grade === g);
                  const change = r && r.pct !== null && r.prev_pct !== null ? Math.round((r.pct - r.prev_pct) * 10) / 10 : null;
                  return (
                    <td key={g}>
                      {!r || r.pct === null ? <span className="text-ink-faint">—</span> : (
                        <>
                          <span className="tnum font-medium">{r.pct.toFixed(1)}%</span>
                          {change !== null ? (
                            <span className={`tnum ml-1.5 text-xs ${change > 0 ? 'text-good' : change < 0 ? 'text-crit' : 'text-ink-faint'}`}>
                              {change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change).toFixed(1)}
                            </span>
                          ) : null}
                          <span className="block text-2xs text-ink-faint">{fmtInt(r.n)} {pick(lang, 'assessed', 'आकलित')}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
