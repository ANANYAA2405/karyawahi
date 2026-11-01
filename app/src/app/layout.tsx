import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Devanagari, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import Shell from '@/components/Shell';
import { getLanguage } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Karyavahi — data to action (demo)',
  description:
    'A demo of the Karyavahi case ledger: a learning drop is detected from assessment data, diagnosed from context, planned, assigned, verified with proof, and closed only on a measured gain. All data is fictional.',
  robots: { index: false, follow: false },
};

/** Rendering is per-request: every page reads the signed-in user's scope and the demo clock. */
export const dynamic = 'force-dynamic';

// Fonts are downloaded at build time and served from the app, so nothing is fetched from a
// font host when the page loads. Plex Sans Devanagari is drawn to match Plex Sans, so Hindi and
// English sit together on one line; Source Serif is for page and case titles only.
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const deva = IBM_Plex_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-deva', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['600'], variable: '--font-serif', display: 'swap' });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLanguage();
  return (
    <html lang={lang} className={`${sans.variable} ${deva.variable} ${mono.variable} ${serif.variable}`}>
      <body className="antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-base focus:shadow"
        >
          Skip to content
        </a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
