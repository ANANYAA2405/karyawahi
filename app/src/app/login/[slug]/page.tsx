import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLanguage, getSession } from '@/lib/session';
import { usersByRole, demoAccounts, scopeName } from '@/lib/repo';
import { homeFor } from '@/lib/nav';
import { Card, CardHead, PageHead, Callout } from '@/components/ui';
import { Pill } from '@/components/labels';
import { ROLE_LABELS } from '@domain/permissions';
import { pick } from '@/lib/i18n';
import { AuthFrame } from '@/components/Brand';
import type { RoleCode } from '@domain/types';

/** Per-role entry points. The slugs come from ROLE_LABELS[...].login in the domain package. */

const SLUG_ROLES: Record<string, RoleCode[]> = {
  'block-officer': ['beo'],
  'resource-coordinator': ['brc', 'crc'],
  headmaster: ['headmaster'],
  'district-officer': ['deo'],
  state: ['state_admin'],
  auditor: ['auditor'],
  admin: ['demo_admin'],
};

export default async function RoleLogin({ params }: { params: Promise<{ slug: string }> }) {
  const existing = await getSession();
  if (existing) redirect(homeFor(existing));

  const { slug } = await params;
  const roles = SLUG_ROLES[slug];
  if (!roles) notFound();

  const lang = await getLanguage();
  const demo = new Set(demoAccounts().map((a) => a.id));
  // Demo accounts first, then a sample of real seeded officers in that role.
  const accounts = roles.flatMap((r) => usersByRole(r, undefined, 12))
    .sort((a, b) => Number(demo.has(b.id)) - Number(demo.has(a.id)));

  const title = roles.map((r) => pick(lang, ROLE_LABELS[r].en, ROLE_LABELS[r].hi)).join(' / ');

  return (
    <AuthFrame right={<Link href="/demo" className="btn-quiet">All personas</Link>}>
    <div className="mx-auto max-w-2xl px-5 py-10">
      <nav aria-label="Roles" className="mb-5 flex flex-wrap gap-1.5">
        {Object.keys(SLUG_ROLES).map((k) => (
          <Link key={k} href={`/login/${k}`} aria-current={k === slug ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${k === slug ? 'border-navy bg-navy text-white' : 'border-line-strong bg-white text-ink-soft hover:text-ink'}`}>
            {pick(lang, ROLE_LABELS[SLUG_ROLES[k][0]].en, ROLE_LABELS[SLUG_ROLES[k][0]].hi).replace(/^Block Resource Coordinator$/, 'Resource coordinators')}
          </Link>
        ))}
      </nav>
      <PageHead
        title={pick(lang, `Sign in — ${title}`, `साइन इन — ${title}`)}
        breadcrumb={<Link href="/demo" className="link">{pick(lang, 'Demo personas', 'डेमो खाते')}</Link>}
        sub={pick(
          lang,
          'Any seeded account in this role can be used. Each one is scoped to its own block, cluster or school.',
          'इस भूमिका का कोई भी खाता उपयोग करें। हर खाता अपने खंड, संकुल या विद्यालय तक सीमित है।',
        )}
      />
      <Card>
        <CardHead title={pick(lang, 'Accounts', 'खाते')} hint={`${accounts.length} ${pick(lang, 'shown', 'दिखाए')}`} />
        <ul className="divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-medium text-ink">{a.full_name}</p>
                  <Pill>{scopeName(a.scope_type, a.scope_id)}</Pill>
                  {demo.has(a.id) ? <Pill tone="active">{pick(lang, 'Demo account', 'डेमो खाता')}</Pill> : null}
                </div>
                <p className="text-xs text-ink-faint">{a.email}</p>
              </div>
              <form action="/api/sign-in" method="post">
                <input type="hidden" name="user_id" value={a.id} />
                <input type="hidden" name="from" value="demo" />
                <button type="submit" className="btn-quiet">{pick(lang, 'Sign in', 'साइन इन')}</button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4">
        <Callout tone="method">
          {pick(
            lang,
            'No password is asked for. In a real deployment this screen is replaced by the state single sign-on; the role and scope rows behind it are what actually decide what you can see and do.',
            'कोई पासवर्ड नहीं। वास्तविक तैनाती में यह स्क्रीन राज्य SSO से बदल जाती है; अधिकार भूमिका और दायरे से तय होते हैं।',
          )}
        </Callout>
      </div>
    </div>
    </AuthFrame>
  );
}
