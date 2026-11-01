import { Suspense } from 'react';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { comparableRounds, roundPair, RULES } from '@/lib/hotspots';
import { competencies, scopeName } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { HotspotWorkspace } from '@/components/HotspotWorkspace';
import { SEVERITY_COLORS, SEVERITY_LABEL } from '@/lib/maplayers';
import { one } from '@/lib/db';
import { DistrictContext, districtsForScope } from '@/components/DistrictContext';

/**
 * Learning hotspots — a map-first workspace. The page is a thin server shell; the map, context
 * panel and list view live in HotspotWorkspace and talk to /api/geo/map and /api/geo/detail,
 * both of which filter by the signed-in user's scope on the server.
 */
export default async function HotspotsPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const rounds = comparableRounds().map((r) => ({ id: r.id, label: `${r.code} · ${r.label}` }));
  const comps = competencies().map((c) => ({ id: c.id, label: pick(lang, c.name_en, c.name_hi) }));
  const pair = roundPair();
  const latest = pair ? `${pair.prev.code} → ${pair.curr.code}` : 'No comparable rounds';
  const realMap = one<{ g: string }>(`select geometry_source g from geo_units where level = 'state' limit 1`)?.g === 'osm';

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'Learning hotspots', 'अधिगम हॉटस्पॉट')}
        sub={pick(lang, 'Where proficiency is falling faster than the district, and what is already being done about it.', 'प्रवीणता ज़िले से तेज़ी से कहाँ गिर रही है, और उस पर क्या काम चल रहा है।')}
        meta={<>{scopeName(session.scope_type, session.scope_id)} · {latest} · <span className="text-warn">{realMap
          ? pick(lang, 'real boundaries and schools, simulated learning data', 'वास्तविक सीमाएँ व विद्यालय, काल्पनिक अधिगम डेटा')
          : pick(lang, 'illustrative boundaries, fictional data', 'उदाहरण हेतु सीमाएँ, काल्पनिक डेटा')}</span></>}
      />
      <Suspense fallback={<div className="skeleton h-[600px] w-full" />}>
        <HotspotWorkspace rounds={rounds} competencies={comps} latestLabel={latest} />
      </Suspense>
      <DistrictContext lang={lang} districtIds={districtsForScope(session.scope_type, session.scope_id, (sql, id) => one<{ d: string }>(sql, id)?.d ?? null)} />
      <details className="card group px-5 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink">
          <Icon name="info" size={14} className="text-ink-faint" />How severity is decided
          <Icon name="chevron-down" size={14} className="ml-auto text-ink-faint transition group-open:rotate-180" />
        </summary>
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm leading-snug text-ink-soft sm:grid-cols-2 lg:grid-cols-3">
          {(['critical', 'significant', 'moderate', 'improving', 'stable', 'insufficient'] as const).map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: SEVERITY_COLORS[s] }} aria-hidden />
              <span><strong className="font-medium text-ink">{SEVERITY_LABEL[s]}</strong>{' — '}{
                s === 'critical' ? `≤ ${RULES.critical.relPp} pp vs district and z ≤ ${RULES.critical.z}`
                : s === 'significant' ? `≤ ${RULES.significant.relPp} pp and z ≤ ${RULES.significant.z}`
                : s === 'moderate' ? `≤ ${RULES.moderate.relPp} pp and z ≤ ${RULES.moderate.z}`
                : s === 'improving' ? `≥ +${RULES.improving.relPp} pp and z ≥ ${RULES.improving.z}`
                : s === 'stable' ? 'within normal variation'
                : `too few students assessed, or participation < ${RULES.minParticipation * 100}% — unknown, not stable`
              }</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 border-t border-line pt-2 text-xs text-ink-faint">An area takes the severity of its worst class × competency cell. “vs district” subtracts the district’s own change, removing seasonal shifts between rounds.</p>
      </details>
    </div>
  );
}
