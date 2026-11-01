import type { ReactNode } from 'react';
import { STATUS_LABELS } from '@domain/lifecycle';
import type { CaseStatus, Language, OutcomeCategory, Severity, TaskStatus, RoleCode, Provenance } from '@domain/types';
import { ROLE_LABELS } from '@domain/permissions';
import { OUTCOME_LABEL, SEVERITY_LABEL, TASK_STATUS_LABEL, EVIDENCE_TYPE_LABEL, FACTOR_LABEL, pick } from '@/lib/i18n';

/**
 * Status chips and the honesty labels.
 *
 * Case-status wording comes from STATUS_LABELS in src/domain/lifecycle.ts, which carries the
 * officer-facing phrasing in both languages ("Waiting for approval" / "स्वीकृति की प्रतीक्षा")
 * and a tone. The UI never invents its own status words.
 */

const TONES = {
  neutral: 'border-line-strong bg-paper-sunk text-ink-soft',
  pending: 'border-pend/30 bg-pend-light text-pend',
  active: 'border-brand/30 bg-brand-light text-brand',
  good: 'border-good/30 bg-good-light text-good',
  warn: 'border-warn/30 bg-warn-light text-warn',
  critical: 'border-crit/30 bg-crit-light text-crit',
} as const;

export type Tone = keyof typeof TONES;

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`chip ${TONES[tone]}`} title={title}>{children}</span>;
}

export function StatusPill({ status, lang }: { status: CaseStatus; lang: Language }) {
  const s = STATUS_LABELS[status];
  if (!s) return <Pill>{status}</Pill>;
  return <Pill tone={s.tone} title={status}>{pick(lang, s.en, s.hi)}</Pill>;
}

export function SeverityPill({ severity, lang }: { severity: Severity; lang: Language }) {
  const tone: Tone = severity === 'critical' ? 'critical' : severity === 'high' ? 'warn' : 'neutral';
  const l = SEVERITY_LABEL[severity];
  // Severity is a status colour, so it ships with its word, never colour alone.
  return <Pill tone={tone}>{pick(lang, l.en, l.hi)}</Pill>;
}

export function OutcomePill({ category, lang }: { category: OutcomeCategory; lang: Language }) {
  const tone: Tone =
    category === 'improved_confirmed' ? 'good'
    : category === 'improved_indicative' ? 'good'
    : category === 'worsened' ? 'critical'
    : category === 'below_target' ? 'warn'
    : 'neutral';
  const l = OUTCOME_LABEL[category];
  return <Pill tone={tone}>{pick(lang, l.en, l.hi)}</Pill>;
}

export function TaskStatusPill({ status, lang }: { status: TaskStatus; lang: Language }) {
  const tone: Tone =
    status === 'verified' ? 'good'
    : status === 'sent_back' ? 'warn'
    : status === 'submitted' ? 'pending'
    : status === 'in_progress' || status === 'acknowledged' ? 'active'
    : status === 'cancelled' ? 'neutral'
    : 'neutral';
  const l = TASK_STATUS_LABEL[status];
  return <Pill tone={tone}>{pick(lang, l.en, l.hi)}</Pill>;
}

export function EvidenceStatusPill({ status, lang }: { status: 'pending' | 'verified' | 'rejected'; lang: Language }) {
  const map = {
    pending: { tone: 'pending' as Tone, en: 'Waiting to be checked', hi: 'जाँच बाकी' },
    verified: { tone: 'good' as Tone, en: 'Verified', hi: 'सत्यापित' },
    rejected: { tone: 'critical' as Tone, en: 'Sent back', hi: 'लौटाया गया' },
  }[status];
  return <Pill tone={map.tone}>{pick(lang, map.en, map.hi)}</Pill>;
}

export const RoleName = ({ role, lang }: { role: RoleCode; lang: Language }) => (
  <>{pick(lang, ROLE_LABELS[role]?.en ?? role, ROLE_LABELS[role]?.hi ?? role)}</>
);

export const EvidenceTypeName = ({ type, lang }: { type: keyof typeof EVIDENCE_TYPE_LABEL; lang: Language }) => {
  const l = EVIDENCE_TYPE_LABEL[type];
  return <>{l ? pick(lang, l.en, l.hi) : String(type).replace(/_/g, ' ')}</>;
};

export const FactorName = ({ factor, lang }: { factor: keyof typeof FACTOR_LABEL; lang: Language }) => {
  const l = FACTOR_LABEL[factor];
  return <>{l ? pick(lang, l.en, l.hi) : String(factor).replace(/_/g, ' ')}</>;
};

// ------------------------------------------------------------------ honesty labels
/**
 * These exist because the whole product rests on not overclaiming. Wherever a number is
 * modelled rather than measured, drafted by a template rather than written by an officer, or
 * queued to a channel that was never actually contacted, it says so on the surface.
 */

export const AiDrafted = ({ lang, model }: { lang: Language; model?: string | null }) => (
  <Pill tone="pending" title={model ? `Model: ${model}` : undefined}>
    <span aria-hidden>◆</span> {pick(lang, 'AI-drafted', 'AI द्वारा तैयार')}
  </Pill>
);

export const OfficerWritten = ({ lang }: { lang: Language }) => (
  <Pill tone="neutral">{pick(lang, 'Written by an officer', 'अधिकारी द्वारा लिखित')}</Pill>
);

export const Illustrative = ({ lang }: { lang: Language }) => (
  <Pill tone="warn" title="Not a PAB unit cost">
    {pick(lang, 'Illustrative figure', 'केवल उदाहरण')}
  </Pill>
);

export const NotSent = ({ lang }: { lang: Language }) => (
  <Pill tone="warn" title="No message was actually delivered">
    {pick(lang, 'Simulated — not sent', 'नकली — भेजा नहीं गया')}
  </Pill>
);

export const Association = ({ lang }: { lang: Language }) => (
  <Pill tone="warn" title="Observed alongside the drop, not shown to have caused it">
    {pick(lang, 'Association, not cause', 'संबंध, कारण नहीं')}
  </Pill>
);

export function ProvenanceChip({ provenance, lang }: { provenance: Provenance | string; lang: Language }) {
  const map: Record<string, { tone: Tone; en: string; hi: string; title: string }> = {
    synthetic_demo: { tone: 'warn', en: 'Fictional demo data', hi: 'काल्पनिक डेमो डेटा', title: 'Generated for the demo. Not a real record.' },
    udise_anonymised: { tone: 'good', en: 'Real school (UDISE+) · name withheld', hi: 'वास्तविक विद्यालय (यू-डाइस+) · नाम गोपनीय', title: 'A real government school from UDISE+ 2020-21 (India Data Portal, ODC-BY). Its name and code are withheld because its learning results here are simulated.' },
    public_historical: { tone: 'neutral', en: 'Public historical', hi: 'सार्वजनिक ऐतिहासिक', title: 'From a published public source.' },
    partner_provided: { tone: 'neutral', en: 'Partner-provided', hi: 'साझेदार द्वारा', title: 'Supplied by a partner organisation.' },
    user_uploaded: { tone: 'active', en: 'Uploaded in app', hi: 'ऐप में अपलोड', title: 'Uploaded by a user through the import wizard.' },
  };
  const m = map[provenance] ?? { tone: 'neutral' as Tone, en: String(provenance), hi: String(provenance), title: '' };
  return <Pill tone={m.tone} title={m.title}>{pick(lang, m.en, m.hi)}</Pill>;
}

export function EvidenceStrength({ status, lang }: { status: string; lang: Language }) {
  if (status === 'sourced_summary_verify') {
    return (
      <Pill tone="warn" title="Quotes a published source; the citation still needs checking before production use">
        {pick(lang, 'Cites a source — verify before production', 'स्रोत उद्धृत — उपयोग से पहले जाँचें')}
      </Pill>
    );
  }
  return (
    <Pill tone="neutral" title="Makes no effect-size claim">
      {pick(lang, 'No effect-size claim', 'प्रभाव का दावा नहीं')}
    </Pill>
  );
}

export const OverduePill = ({ lang, days }: { lang: Language; days?: number }) => (
  <Pill tone="critical">
    <span aria-hidden>!</span>{' '}
    {pick(lang, 'Overdue', 'विलंबित')}{days !== undefined && days > 0 ? ` · ${days}${pick(lang, 'd', ' दिन')}` : ''}
  </Pill>
);

export const EscalatedPill = ({ lang }: { lang: Language }) => (
  <Pill tone="critical">{pick(lang, 'Escalated to district', 'ज़िले को भेजा')}</Pill>
);

export const CrossSourcePill = ({ lang }: { lang: Language }) => (
  <Pill tone="active" title="Independent check by a different role — required before a case can close">
    {pick(lang, 'Independent check', 'स्वतंत्र जाँच')}
  </Pill>
);
