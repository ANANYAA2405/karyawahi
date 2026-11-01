import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { categories, routeFor } from '@/lib/complaints';
import { can } from '@/lib/authz';
import { pathOf, chainAbove, managerOf, type ScopeType } from '@/lib/org';
import { all } from '@/lib/db';
import { schoolsPred } from '@/lib/scope';
import { userNames } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { PageHead, Callout } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ActionForm } from '@/components/ActionForm';
import { NoteMic } from '@/components/voice';
import { createComplaintAction } from '@/lib/actions';

/**
 * Raise a complaint. Before submitting, the officer sees exactly who each category will go to
 * — computed with the same routing rules the server applies on submit.
 */

export default async function NewComplaint({ searchParams }: { searchParams: Promise<{ category?: string; case?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;
  if (!can(session, 'create_complaint')) {
    return <div className="mx-auto max-w-2xl"><PageHead title="Raise a complaint" /><Callout tone="warn">Your role cannot raise complaints here.</Callout></div>;
  }
  const cats = categories();
  const cat = cats.find((c) => c.key === sp.category) ?? null;
  const path = pathOf(session.scope_type as ScopeType, session.scope_id);
  const geo = { state_id: path?.state ?? null, district_id: path?.district ?? null, block_id: path?.block ?? null, cluster_id: path?.cluster ?? null };
  const chain = [managerOf(session.user_id), ...chainAbove(session.user_id)].filter((x): x is string => !!x);
  const names = userNames(chain);
  const routes = new Map(cats.map((c) => [c.key, routeFor(session.user_id, c.key, 'medium', geo, c.confidential_default ? chain[0] ?? null : null)]));
  const routeNames = userNames([...routes.values()].map((r) => r.assignee ?? ''));
  const roleOf = (id: string | null) => (id ? all<{ role: string }>('select role from user_roles where user_id = ? limit 1', id)[0]?.role?.toUpperCase() ?? '' : '');
  const schoolOptions = session.scope_type === 'school' ? [] : (() => {
    const p = schoolsPred(session, 'sc');
    return all<{ id: string; name: string }>(`select sc.id, sc.name from schools sc where ${p.sql} order by sc.name limit 400`, ...p.params);
  })();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHead
        breadcrumb={<Link href="/complaints" className="link">{pick(lang, 'Complaints', 'शिकायतें')}</Link>}
        title={pick(lang, 'Raise a complaint', 'शिकायत दर्ज करें')}
        sub={pick(lang, 'Choose what it is about. You will see who it goes to before you submit.', 'विषय चुनें। जमा करने से पहले आप देखेंगे कि यह किसे जाएगी।')}
      />

      <section aria-label="Category">
        <h2 className="h-section mb-2">1 · What is it about?</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {cats.map((c) => {
            const r = routes.get(c.key)!;
            const on = c.key === cat?.key;
            return (
              <li key={c.key}>
                <Link href={`/complaints/new?category=${c.key}${sp.case ? `&case=${sp.case}` : ''}`} aria-current={on ? 'true' : undefined}
                  className={`flex h-full flex-col rounded-xl border bg-white p-3.5 shadow-card transition-all hover:shadow-lift ${on ? 'border-brand ring-2 ring-brand/25' : 'border-line'}`}>
                  <span className="flex items-center gap-2 text-base font-semibold text-ink">{c.confidential_default ? <Icon name="lock" size={14} className="text-crit" /> : null}{c.label}</span>
                  <span className="mt-0.5 text-sm leading-snug text-ink-soft">{c.description}</span>
                  <span className="mt-2 text-xs text-ink-faint"><Icon name="arrow-right" size={12} className="mr-1 inline" />Goes to <strong className="font-medium text-ink-soft">{routeNames.get(r.assignee ?? '') ?? 'no authority configured'}</strong> {r.assignee ? `(${roleOf(r.assignee)})` : ''}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {cat ? (
        <section aria-label="Details" className="card p-5">
          <h2 className="h-section mb-3">2 · Details</h2>
          <ActionForm action={createComplaintAction} hidden={{ category: cat.key, ...(sp.case ? { case_id: sp.case } : {}) }} label={pick(lang, 'Submit complaint', 'शिकायत जमा करें')}>
            <div className="space-y-3">
              <label className="block"><span className="text-sm font-medium text-ink">Title</span>
                <input name="title" required minLength={6} maxLength={160} className="input mt-1" placeholder="One line: what is wrong" /></label>
              <label className="block"><span className="text-sm font-medium text-ink">What is happening</span>
                <textarea name="description" required minLength={15} rows={5} className="input mt-1 resize-y" placeholder="What happened, since when, and what it is stopping." /></label>
              <NoteMic field="description" lang={lang} className="!mb-0" />
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block"><span className="text-sm font-medium text-ink">Priority</span>
                  <select name="priority" defaultValue="medium" className="input mt-1">
                    <option value="low">Low — can wait</option><option value="medium">Medium</option><option value="high">High — work is stopped</option><option value="critical">Critical — children affected today</option>
                  </select></label>
                <label className="block"><span className="text-sm font-medium text-ink">Severity</span>
                  <select name="severity" defaultValue="moderate" className="input mt-1">
                    <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option>
                  </select></label>
                {schoolOptions.length ? (
                  <label className="block"><span className="text-sm font-medium text-ink">School (optional)</span>
                    <select name="school_id" defaultValue="" className="input mt-1">
                      <option value="">My whole {session.scope_type}</option>
                      {schoolOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select></label>
                ) : <input type="hidden" name="school_id" value={session.scope_id} />}
              </div>
              {cat.confidential_default ? (
                <div className="rounded-lg border border-crit/25 bg-crit-light/50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-crit"><Icon name="lock" size={14} />Restricted complaint</p>
                  <p className="mt-0.5 text-sm text-ink-soft">Visible only to you, the authority it is routed to, anyone it is later escalated to, and the state auditor. Never to the officer it concerns.</p>
                  <label className="mt-2 block"><span className="text-sm font-medium text-ink">Which officer does it concern?</span>
                    <select name="accused_user_id" className="input mt-1" defaultValue={chain[0] ?? ''}>
                      {chain.map((u) => <option key={u} value={u}>{names.get(u) ?? u} ({roleOf(u)})</option>)}
                    </select></label>
                  <input type="hidden" name="restricted" value="1" />
                </div>
              ) : (
                <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="restricted" value="1" className="h-4 w-4 accent-brand" />Mark as restricted (sensitive; limits who can see it)</label>
              )}
              <p className="rounded-lg bg-paper-sunk px-3 py-2 text-sm text-ink-soft">
                <Icon name="arrow-right" size={13} className="mr-1 inline text-brand" />
                {routes.get(cat.key)?.explicit ?? 'Goes to your designated authority.'} Recipient: <strong className="text-ink">{routeNames.get(routes.get(cat.key)?.assignee ?? '') ?? '—'}</strong>.
                {' '}Critical priority may route directly to the district for staffing and infrastructure.
              </p>
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
