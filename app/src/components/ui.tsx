import type { ReactNode } from 'react';
import Link from 'next/link';

/** Layout and text primitives. No data access here — these are pure presentation. */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHead({
  title, hint, right, id,
}: { title: ReactNode; hint?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <header className="card-head" id={id}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold tracking-tight text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm leading-snug text-ink-soft">{hint}</p> : null}
      </div>
      {right ? <div className="shrink-0 no-print">{right}</div> : null}
    </header>
  );
}

export function Stat({
  label, value, sub, tone = 'neutral', href, icon,
}: {
  label: ReactNode; value: ReactNode; sub?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'crit' | 'pend' | 'brand';
  href?: string;
  icon?: ReactNode;
}) {
  const toneText = { neutral: 'text-ink', good: 'text-good', warn: 'text-warn', crit: 'text-crit', pend: 'text-pend', brand: 'text-brand' }[tone];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2"><span className="label">{label}</span>{icon ? <span className="text-ink-faint">{icon}</span> : null}</div>
      <div className={`kpi-num mt-1.5 ${toneText}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs leading-snug text-ink-faint">{sub}</div> : null}
    </>
  );
  const cls = `block rounded-xl border border-line bg-white px-4 py-3 ${href ? 'transition-colors hover:border-line-strong hover:bg-paper-sunk' : ''}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="val mt-0.5">{children}</dd>
      {hint ? <dd className="mt-0.5 text-xs text-ink-faint">{hint}</dd> : null}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-base text-ink-faint sm:px-5">
      {children ?? 'Nothing here yet'}
    </p>
  );
}

export function Callout({
  tone = 'note', title, children,
}: { tone?: 'note' | 'warn' | 'crit' | 'good' | 'method'; title?: ReactNode; children: ReactNode }) {
  const styles = {
    note: 'border-brand/25 bg-brand-light text-ink',
    method: 'border-line-strong bg-paper-sunk text-ink-soft',
    warn: 'border-warn/30 bg-warn-light text-ink',
    crit: 'border-crit/30 bg-crit-light text-ink',
    good: 'border-good/30 bg-good-light text-ink',
  }[tone];
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${styles}`}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

export function Bar({
  value, max, tone = 'brand', width = 120,
}: { value: number; max: number; tone?: 'brand' | 'crit' | 'good' | 'warn'; width?: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (Math.abs(value) / max) * 100)) : 0;
  const fill = { brand: 'bg-brand', crit: 'bg-crit', good: 'bg-good', warn: 'bg-warn' }[tone];
  return (
    <span
      className="inline-block overflow-hidden rounded bg-paper-deep align-middle"
      style={{ width, height: 8 }}
      role="presentation"
    >
      {/* 4px rounded data-end, anchored to the baseline. */}
      <span className={`block h-full rounded-r ${fill}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2 no-print">{children}</div>;
}

export function PageHead({
  title, sub, right, breadcrumb, meta,
}: { title: ReactNode; sub?: ReactNode; right?: ReactNode; breadcrumb?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-2 text-sm text-ink-faint lg:hidden">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">{title}</h1>
          {sub ? <p className="mt-1 max-w-3xl text-base leading-snug text-ink-soft">{sub}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">{meta}</div> : null}
        </div>
        {right ? <div className="shrink-0 no-print">{right}</div> : null}
      </div>
    </header>
  );
}

export function Grid({ cols = 4, children }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode }) {
  const c = {
    2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6',
  }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

/** A dl laid out in two columns, for record detail panels. */
export function Facts({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${c}`}>{children}</dl>;
}

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-xs text-ink-soft">{children}</span>
);

/** Signed percentage-point change, with the sign carried in text as well as colour. */
export function Delta({ pp, invert = false }: { pp: number | null; invert?: boolean }) {
  if (pp === null || pp === undefined) return <span className="text-ink-faint">—</span>;
  const good = invert ? pp < 0 : pp > 0;
  const cls = pp === 0 ? 'text-ink-soft' : good ? 'text-good' : 'text-crit';
  return (
    <span className={`tnum font-medium ${cls}`}>
      {pp > 0 ? '+' : pp < 0 ? '−' : ''}{Math.abs(pp).toFixed(1)} pp
    </span>
  );
}

export const fmtPct = (v: number | null | undefined, dp = 1): string =>
  v === null || v === undefined ? '—' : `${v.toFixed(dp)}%`;

export const fmtInr = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN')}`;

export const fmtInt = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-IN');

/** Dates are rendered in IST because every date column in the seed is IST. In Hindi the month
 *  names are Hindi too ("5 नव॰ 2026"). */
export function fmtDate(iso: string | null | undefined, withTime = false, lang: 'en' | 'hi' = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(d);
  if (!withTime || iso.length === 10) return date;
  const time = new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
  }).format(d);
  return `${date}, ${time}`;
}

export const shortHash = (h: string | null | undefined): string =>
  !h ? '—' : `${h.slice(0, 8)}…${h.slice(-4)}`;
