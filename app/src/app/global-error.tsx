'use client';

import { PALETTE } from '@/lib/tokens';

/**
 * The last resort, when the root layout itself fails (the database cannot be opened, say).
 * It replaces the whole document, so it carries its own html and body and inline styles: the
 * app's stylesheet and shell may be what broke.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: PALETTE.ivory.DEFAULT, color: PALETTE.ink.DEFAULT }}>
        <main style={{ maxWidth: 520, margin: '15vh auto', padding: '0 16px' }} role="alert">
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Karyavahi could not start this page</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: PALETTE.ink.soft, margin: '0 0 16px' }}>
            The app hit an error before it could draw anything. If you are running the demo locally, check the
            terminal running the server; the demo database may need resetting with <code>npm run db:init -- --force</code>.
          </p>
          {error.digest ? <p style={{ fontSize: 12, color: PALETTE.ink.faint }}>Reference {error.digest}</p> : null}
          <button type="button" onClick={reset}
            style={{ font: 'inherit', fontSize: 14, padding: '8px 14px', borderRadius: 8, border: 0, background: PALETTE.brand.DEFAULT, color: PALETTE.paper.DEFAULT, cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
