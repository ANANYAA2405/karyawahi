import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { realDataVersion } from '@/lib/ext/realdata';

/** Brand mark and the frame used by the signed-out pages (landing, sign-in, demo personas). */

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#167D78" />
      {/* A rising line that ends in a check: a learning gap turned into a verified outcome. */}
      <path d="M7 20.5 12 15.5l4 3.5 4.5-6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19.5 21 2.5 2.5 4.5-5" fill="none" stroke="#a7e3d8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={30} />
      <span className={`font-display text-lg font-semibold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>Karyavahi</span>
    </span>
  );
}

export const WORKFLOW = [
  { key: 'flag', en: 'Flag', hi: 'पहचान', icon: 'alert' },
  { key: 'diagnose', en: 'Diagnose', hi: 'निदान', icon: 'search' },
  { key: 'recommend', en: 'Recommend', hi: 'सुझाव', icon: 'flask' },
  { key: 'approve', en: 'Approve', hi: 'स्वीकृति', icon: 'shield' },
  { key: 'assign', en: 'Assign', hi: 'सौंपना', icon: 'users' },
  { key: 'track', en: 'Track', hi: 'निगरानी', icon: 'activity' },
  { key: 'verify', en: 'Verify', hi: 'सत्यापन', icon: 'check-circle' },
  { key: 'report', en: 'Report', hi: 'रिपोर्ट', icon: 'file' },
] as const;

/** Signed-out frame: a slim header with the wordmark, the page, and the demo disclosure. */
export function AuthFrame({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <header className="border-b border-line/70 bg-ivory/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="Karyavahi home"><Wordmark /></Link>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      </header>
      <main id="main-content" className="flex-1">{children}</main>
      <footer className="border-t border-line/70 py-5">
        <p className="mx-auto flex max-w-6xl items-start gap-2 px-5 text-xs leading-relaxed text-ink-faint">
          <Icon name="info" size={14} className="mt-0.5" />
          {realDataVersion() ? (
            <span>
              <strong className="font-semibold text-warn">Demo mode — not actual government statistics.</strong>{' '}
              Schools, enrolment, teachers and locations are real (UDISE+ via India Data Portal, about 2020-21; names withheld). Learning results are simulated and calibrated to PRS 2024; costs are from the UP PAB 2025-26 minutes. People, cases and outcomes are fictional.{' '}
              <Link href="/sources" className="link">Sources and credits</Link> · <Link href="/roadmap" className="link">Roadmap</Link>
            </span>
          ) : (
            <span>
              <strong className="font-semibold text-warn">Demo mode — fictional seed data — not actual government statistics.</strong>{' '}
              Every school, person, score, cost and outcome is generated. Nothing is connected to UDISE+, NAS, ASER, a state VSK, WhatsApp or IVR.{' '}
              <Link href="/sources" className="link">Sources</Link> · <Link href="/roadmap" className="link">Roadmap</Link>
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}
