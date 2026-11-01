import type { Language } from '@domain/types';
import { pick } from '@/lib/i18n';

/**
 * What a piece of proof says: the note, any counts it recorded, and its photo. The photo is a
 * link to the server route that re-hashes it before serving, so what opens is the file that was
 * submitted. Who submitted it and when are shown by the caller.
 */
const LABEL: Record<string, { en: string; hi: string }> = {
  note: { en: 'Note', hi: 'टिप्पणी' },
  sessions_recorded: { en: 'Sessions recorded', hi: 'दर्ज सत्र' },
  week: { en: 'Week', hi: 'सप्ताह' },
  students_checked: { en: 'Children checked', hi: 'जाँचे गए बच्चे' },
  at_benchmark: { en: 'At the benchmark', hi: 'मानक पर' },
  schools: { en: 'Schools', hi: 'विद्यालय' },
};
/** Recorded for the audit trail, and already shown beside the proof. */
const HIDDEN = new Set(['photo', 'declared_by', 'recorded_on', 'location_unavailable', 'saved_offline_at']);

export function EvidenceSummary({ id, summary, lang }: { id: string; summary: Record<string, unknown>; lang: Language }) {
  const rows = Object.entries(summary).filter(([k]) => !HIDDEN.has(k));
  const hasPhoto = typeof summary.photo === 'object' && summary.photo !== null;
  if (rows.length === 0 && !hasPhoto) return null;
  return (
    <div className="mt-1.5 flex items-start gap-3">
      {hasPhoto ? (
        <a href={`/api/evidence/${id}/photo`} target="_blank" rel="noreferrer" className="shrink-0" title={pick(lang, 'Open the photo', 'फ़ोटो खोलें')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by a scoped route that re-hashes the file */}
          <img src={`/api/evidence/${id}/photo`} alt={pick(lang, 'Photo submitted as proof', 'सबूत के रूप में जमा फ़ोटो')} className="h-16 w-16 rounded-md border border-line object-cover" loading="lazy" />
        </a>
      ) : null}
      {rows.length ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className={`flex gap-1 ${k === 'note' ? 'basis-full' : ''}`}>
              <dt className="text-ink-faint">{LABEL[k] ? pick(lang, LABEL[k].en, LABEL[k].hi) : k.replace(/_/g, ' ')}:</dt>
              <dd className="text-ink">{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
