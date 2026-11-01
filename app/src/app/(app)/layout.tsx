import { pageSession } from '@/lib/page-session';
import { getLanguage } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { OfflineSupport } from '@/components/OfflineSupport';

/**
 * Every route in this group needs a signed-in user. The check sits here, in the layout, because
 * the layout renders before the group's loading screen is sent: a signed-out request gets a real
 * HTTP redirect to /login rather than a 200 with a skeleton and a redirect later in the stream.
 * The folder name is in parentheses, so it does not appear in any URL.
 *
 * Field staff (the roles that land on My day) also get offline support here: the service worker,
 * sending proof saved without signal, and the "offline — last updated" notice (OfflineSupport).
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  const lang = await getLanguage();
  return (
    <>
      {children}
      <OfflineSupport userId={session.user_id} field={homeFor(session) === '/today'} lang={lang} />
    </>
  );
}
