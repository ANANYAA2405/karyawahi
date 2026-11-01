import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { complaintAccess } from '@/lib/complaints';
import { userNames } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Callout, Mono, fmtDate } from '@/components/ui';
import { ComplaintDetail } from '@/components/ComplaintDetail';

/**
 * One complaint, full page (also the mobile view of the inbox drawer). The content and the
 * access rule live in ComplaintDetail so the page and the drawer cannot drift apart.
 */
export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;
  const { submitted } = await searchParams;
  const a = complaintAccess(session, id.toUpperCase());
  if (!a) notFound();
  const c = a.complaint;
  const assignee = submitted ? userNames([c.assigned_user_id ?? '']).get(c.assigned_user_id ?? '') : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <p className="text-sm text-ink-faint"><Link href="/complaints" className="link">{pick(lang, 'Complaints', 'शिकायतें')}</Link> › <Mono>{c.id}</Mono></p>
      {submitted ? <Callout tone="good" title="Complaint submitted">It has been sent to {assignee ?? 'your designated authority'}, who must acknowledge it by {fmtDate(c.ack_due)}. You will be notified of every update.</Callout> : null}
      <ComplaintDetail session={session} id={c.id} />
    </div>
  );
}
