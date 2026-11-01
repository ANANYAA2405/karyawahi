import { pageSession } from '@/lib/page-session';

/**
 * Every route in this group needs a signed-in user. The check sits here, in the layout, because
 * the layout renders before the group's loading screen is sent: a signed-out request gets a real
 * HTTP redirect to /login rather than a 200 with a skeleton and a redirect later in the stream.
 * The folder name is in parentheses, so it does not appear in any URL.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  await pageSession();
  return children;
}
