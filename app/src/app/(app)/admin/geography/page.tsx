import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { getLanguage, requireSession } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { can, requirePermission } from '@/lib/authz';
import { all, one, run, tx } from '@/lib/db';
import { appendAudit } from '@/lib/write';
import { Refused } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { PageHead, Callout } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ActionForm } from '@/components/ActionForm';

/**
 * Geography: the configured hierarchies and levels, what geometry each level has and where it
 * came from, and the urban (city) memberships — which are app-owned and editable here, with an
 * audit entry for every change. Administrative units themselves come from the seed.
 */

async function cityMemberAction(_prev: { error?: string; ok?: string }, form: FormData): Promise<{ error?: string; ok?: string }> {
  'use server';
  const s = await requireSession();
  try {
    requirePermission(s, 'manage_geography');
    const city = String(form.get('city') ?? ''); const cluster = String(form.get('cluster') ?? '').toUpperCase(); const op = String(form.get('op') ?? '');
    if (!one(`select 1 x from geo_units where id = ? and level = 'city'`, city)) throw new Refused('Unknown city.', 'input');
    const cl = one<{ district_id: string }>('select district_id from clusters where id = ?', cluster);
    if (!cl) throw new Refused('Unknown cluster.', 'input');
    const cityDistrict = one<{ parent_id: string }>(`select parent_id from geo_relationships where child_id = ? and hierarchy_id = 'urban'`, city)?.parent_id;
    if (cityDistrict !== cl.district_id) throw new Refused('A city can only contain clusters of its own district.', 'input');
    tx(() => {
      if (op === 'add') run(`insert into geo_relationships values (?, ?, 'urban') on conflict(child_id, hierarchy_id) do update set parent_id = excluded.parent_id`, cluster, city);
      else run(`delete from geo_relationships where child_id = ? and parent_id = ? and hierarchy_id = 'urban'`, cluster, city);
      appendAudit({ actorUserId: s.user_id, actorLabel: s.full_name, actorRole: s.role, action: `geography.city_${op === 'add' ? 'add' : 'remove'}_cluster`, entityType: 'geo_unit', entityId: city, after: { cluster } });
    });
    revalidatePath('/admin/geography');
    return { ok: `${cluster} ${op === 'add' ? 'added to' : 'removed from'} ${city}. The city map shape is unchanged until boundaries are regenerated.` };
  } catch (e) {
    return { error: e instanceof Refused ? e.message : (e as Error).message };
  }
}

export default async function GeographyPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const manage = can(session, 'manage_geography');
  const hier = all<{ id: string; name: string; description: string }>('select * from geo_hierarchies order by id');
  const levels = all<{ hierarchy_id: string; level: string; rank: number; label: string }>('select * from geo_levels order by hierarchy_id, rank');
  const stats = all<{ level: string; geometry_source: string; n: number }>('select level, geometry_source, count(*) n from geo_units group by level, geometry_source');
  const cities = all<{ id: string; name: string; district: string; members: string | null }>(
    `select u.id, u.name, (select d.name from geo_relationships r join districts d on d.id = r.parent_id where r.child_id = u.id and r.hierarchy_id = 'urban') district,
            (select group_concat(c.name || ' (' || c.id || ')', ', ') from geo_relationships r2 join clusters c on c.id = r2.child_id where r2.parent_id = u.id and r2.hierarchy_id = 'urban') members
       from geo_units u where u.level = 'city' order by u.id`,
  );

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/admin" className="link">Administration</Link>}
        title={pick(lang, 'Geography', 'भूगोल')}
        sub={pick(lang, 'Hierarchies are data, not code: each defines its own levels, and the map follows whichever one is selected.', 'पदानुक्रम डेटा हैं, कोड नहीं।')}
      />
      <Callout tone="warn" title="All geometry in this demo is illustrative">
        The state is fictional, so its district, block and cluster shapes and school positions are generated (hex-grid partition, nested exactly). They sit at 0°,0° so they cannot be mistaken for real places. India’s outline is not drawn, because widely available open datasets show borders that differ from India’s official map. To use real boundaries, load a licensed GeoJSON into <code className="font-mono text-xs">geo_units.boundary</code> with <code className="font-mono text-xs">geometry_source = &apos;verified&apos;</code>; the map, scope checks and layers need no code change.
      </Callout>

      <div className="grid gap-5 lg:grid-cols-2">
        {hier.map((h) => (
          <section key={h.id} className="card p-4">
            <h2 className="text-base font-semibold text-ink">{h.name} hierarchy</h2>
            <p className="text-sm text-ink-faint">{h.description}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
              {levels.filter((l) => l.hierarchy_id === h.id).map((l, i) => (
                <li key={l.level} className="flex items-center gap-1.5">{i > 0 ? <Icon name="chevron-right" size={13} className="text-ink-faint" /> : null}<span className="rounded-md border border-line bg-paper-sunk px-2 py-0.5">{l.label}</span></li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="card overflow-hidden">
        <header className="border-b border-line px-4 py-3"><h2 className="text-base font-semibold text-ink">Units and geometry provenance</h2></header>
        <table className="table">
          <thead><tr><th>Level</th><th>Units</th><th>Geometry</th></tr></thead>
          <tbody>
            {['country', 'state', 'district', 'city', 'block', 'cluster', 'school'].map((lv) => {
              const rows = stats.filter((r) => r.level === lv);
              return (
                <tr key={lv}>
                  <td className="text-sm capitalize">{lv}</td>
                  <td className="tnum text-sm">{rows.reduce((t, r) => t + Number(r.n), 0).toLocaleString('en-IN')}</td>
                  <td className="text-sm">{rows.map((r) => <span key={r.geometry_source} className={`chip mr-1 ${r.geometry_source === 'verified' ? 'border-good/30 bg-good-light text-good' : r.geometry_source === 'none' ? 'border-line-strong bg-paper-sunk text-ink-faint' : 'border-warn/30 bg-warn-light text-warn'}`}>{r.geometry_source === 'none' ? 'not drawn' : r.geometry_source}</span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card overflow-hidden">
        <header className="border-b border-line px-4 py-3"><h2 className="text-base font-semibold text-ink">Cities (urban hierarchy)</h2><p className="text-xs text-ink-faint">A city is not a district: it groups some of a district’s clusters.</p></header>
        <ul className="divide-y divide-line">
          {cities.map((c) => (
            <li key={c.id} className="px-4 py-3 text-sm">
              <p><span className="font-medium text-ink">{c.name}</span> <span className="text-ink-faint">· {c.id} · in {c.district}</span></p>
              <p className="text-sm text-ink-soft">Clusters: {c.members ?? 'none'}</p>
              {manage ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={cityMemberAction} hidden={{ city: c.id, op: 'add' }} label="Add cluster" tone="quiet" className="flex items-end gap-2">
                    <input name="cluster" required placeholder="CLU-005" className="input h-9 w-32 text-sm" />
                  </ActionForm>
                  <ActionForm action={cityMemberAction} hidden={{ city: c.id, op: 'remove' }} label="Remove cluster" tone="quiet" className="flex items-end gap-2">
                    <input name="cluster" required placeholder="CLU-005" className="input h-9 w-32 text-sm" />
                  </ActionForm>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
