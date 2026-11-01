import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { all, one } from '@/lib/db';
import { AuthFrame } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { RegisterForm } from '@/components/RegisterForm';

/**
 * Request an account. The form collects the minimum: name, official email, optional mobile,
 * office, requested role and place, and an affiliation reference. Nothing is granted on submit.
 */
export default async function RegisterPage() {
  const s = await getSession();
  if (s) redirect(homeFor(s));
  // node:sqlite rows have a null prototype, which React refuses to pass to a client component.
  const plain = <T extends object>(rows: T[]): T[] => rows.map((r) => ({ ...r }));
  const state = { ...one<{ id: string; name: string }>('select id, name from states limit 1')! };
  const districts = plain(all<{ id: string; name: string }>('select id, name from districts order by name'));
  const blocks = plain(all<{ id: string; name: string; parent: string }>('select id, name, district_id parent from blocks order by name'));
  const clusters = plain(all<{ id: string; name: string; parent: string }>('select id, name, block_id parent from clusters order by name'));
  const schools = plain(all<{ id: string; name: string; parent: string }>('select id, name, cluster_id parent from schools order by name'));

  return (
    <AuthFrame right={<><Link href="/register/status" className="btn-ghost">Check a request</Link><Link href="/login" className="btn-quiet">Sign in</Link></>}>
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-12 lg:grid-cols-[1fr_320px]">
        <div className="card p-6 sm:p-8">
          <h1 className="font-display text-2xl font-semibold text-ink">Request an account</h1>
          <p className="mt-1 text-base text-ink-soft">For officers and school staff. Your request is verified, then approved by the officer responsible for the place you work.</p>
          <div className="mt-6"><RegisterForm state={state} districts={districts} blocks={blocks} clusters={clusters} schools={schools} /></div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-xl border border-warn/30 bg-warn-light p-4 text-sm text-ink">
            <p className="flex items-center gap-1.5 font-semibold text-warn"><Icon name="info" size={15} />Demo onboarding</p>
            <p className="mt-1 text-ink-soft">No email is sent and no real identity is checked. Use a fictional name and an address on demo.karyavahi.test. The verification code is shown on screen.</p>
          </div>
          <ol className="card space-y-3 p-4 text-sm">
            {[
              ['Submit', 'Your request is recorded. No access yet.'],
              ['Verify email', 'Enter the code sent to your official email.'],
              ['Affiliation check', 'Your staff reference is matched against the registry.'],
              ['Approval', 'A senior officer responsible for your place approves or rejects, with a reason.'],
              ['Active', 'You can sign in with exactly the role and scope approved.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-2xs font-semibold text-white">{i + 1}</span><span><span className="font-medium text-ink">{t}</span><span className="block text-ink-soft">{d}</span></span></li>
            ))}
          </ol>
        </aside>
      </div>
    </AuthFrame>
  );
}
