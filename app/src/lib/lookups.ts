import 'server-only';
import { placeNames, schoolNames, userNames, competencies } from './repo';
import { pick } from './i18n';
import type { Lookups } from '@/components/lists';
import type { Language } from '@domain/types';
import { schoolName } from './school-label';

/** Builds the id → name maps the shared tables need, in one place. */
export function lookupsFor(
  lang: Language,
  ids: { users?: readonly string[]; schools?: readonly string[] } = {},
): Lookups {
  const places = placeNames();
  return {
    users: userNames(ids.users ?? []),
    schools: new Map([...schoolNames([...new Set((ids.schools ?? []).filter(Boolean))])].map(([id, n]) => [id, schoolName(n, lang)])),
    clusters: places.clusters,
    blocks: places.blocks,
    competencies: new Map(competencies().map((c) => [c.id, pick(lang, c.name_en, c.name_hi)])),
  };
}
