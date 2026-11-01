import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { evidenceToCheck, countEvidenceToCheck } from '@/lib/cases';
import type { Evidence } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { may } from '@/lib/guard';
import { grant } from '@/lib/guard';
import { today, daysBetween } from '@/lib/clock';
import { pick, EVIDENCE_TYPE_LABEL } from '@/lib/i18n';
import { Card, PageHead, Callout, fmtDate } from '@/components/ui';
import { EvidenceList } from '@/components/lists';
import { EvidenceStatusPill, EvidenceTypeName, Pill, RoleName } from '@/components/labels';
import { GpsBadge } from '@/components/GpsBadge';
import { EvidenceSummary } from '@/components/EvidenceSummary';
import { Icon } from '@/components/Icon';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { verifyEvidenceAction } from '@/lib/actions';

/**
 * Proof waiting to be checked.
 *
 * The queue is already filtered to exclude anything the signed-in user submitted — not as a
 * courtesy, but because verify_evidence() refuses it. A CRC's grant is 'spot', meaning they
 * may spot-check other people's proof, which is what makes the independent check independent.
 *
 * The page leads with a picture of the queue (how long proof has waited, and what kind it is),
 * then one card per piece of proof with the accept / send-back controls on it.
 */

const AGE = [
  { en: '0–2 days', hi: '0–2 दिन', min: 0, max: 2, tone: 'bg-brand/50' },
  { en: '3–7 days', hi: '3–7 दिन', min: 3, max: 7, tone: 'bg-amber' },
  { en: '8–14 days', hi: '8–14 दिन', min: 8, max: 14, tone: 'bg-warn' },
  { en: 'Over 14 days', hi: '14 दिन से अधिक', min: 15, max: Infinity, tone: 'bg-crit' },
];

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'evidence.verify')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Proof to check', 'जाँचने योग्य सबूत')} />
        <Callout tone="warn">
          {pick(
            lang,
            'Your role does not verify proof. Block and cluster coordinators, block officers and DEOs do.',
            'आपकी भूमिका सबूत सत्यापित नहीं करती। यह कार्य समन्वयक, खंड अधिकारी और DEO करते हैं।',
          )}
        </Callout>
      </div>
    );
  }

  const queue = evidenceToCheck(session, { limit: 100 });
  const total = countEvidenceToCheck(session);
  const look = lookupsFor(lang, {
    users: queue.map((e) => e.submitted_by),
    schools: queue.map((e) => e.school_id ?? ''),
  });
  const isSpotOnly = grant(session, 'evidence.verify') === 'spot';
  const view = sp.view === 'list' ? 'list' : 'cards';
  const now = today();
  const waited = (e: Evidence) => Math.max(0, daysBetween(e.submitted_at.slice(0, 10), now));

  // The picture: how long the shown proof has waited, and what kind of proof it is.
  const ages = AGE.map((b) => ({ ...b, n: queue.filter((e) => { const d = waited(e); return d >= b.min && d <= b.max; }).length }));
  const ageMax = Math.max(1, ...ages.map((b) => b.n));
  const byType = Object.entries(
    queue.reduce<Record<string, number>>((m, e) => { m[e.evidence_type] = (m[e.evidence_type] ?? 0) + 1; return m; }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(1, ...byType.map(([, n]) => n));
  const gpsOff = queue.filter((e) => e.gps_status === 'outside_radius').length;
  const oldest = queue.length ? Math.max(...queue.map(waited)) : 0;

  const actions = (e: Evidence) => (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <ActionForm
        action={verifyEvidenceAction}
        hidden={{
          evidence_id: e.id, case_id: e.case_id, accept: 'yes',
          method: isSpotOnly ? 'spot_check_visit' : 'desk_review',
        }}
        label={pick(lang, 'Accept', 'स्वीकारें')}
        tone="good"
        lang={lang}
      />
      <Disclose label={pick(lang, 'Send back', 'लौटाएँ')} tone="danger">
        <ActionForm
          action={verifyEvidenceAction}
          hidden={{ evidence_id: e.id, case_id: e.case_id, accept: 'no' }}
          label={pick(lang, 'Send back', 'लौटाएँ')}
          tone="danger"
          lang={lang}
        >
          <ReasonBox
            required
            lang={lang}
            label={pick(lang, 'What is wrong with it', 'इसमें क्या कमी है')}
            placeholder={pick(lang, 'The person who submitted it will see this.', 'जमा करने वाले को यह दिखेगा।')}
          />
        </ActionForm>
      </Disclose>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Proof to check', 'जाँचने योग्य सबूत')}
        sub={pick(
          lang,
          'Nobody checks their own work. Anything you submitted is not in this list, and the server refuses it even if asked directly.',
          'कोई अपना सबूत नहीं जाँचता। आपके जमा किए सबूत इस सूची में नहीं हैं।',
        )}
      />

      {/* The picture of the queue. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]" aria-label={pick(lang, 'The queue at a glance', 'कतार एक नज़र में')}>
        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="label">{pick(lang, 'How long proof has waited', 'सबूत कितने दिन से प्रतीक्षा में')}</span>
            <span className="text-xs text-ink-faint">{pick(lang, 'oldest', 'सबसे पुराना')} <span className={`tnum font-semibold ${oldest > 7 ? 'text-crit' : 'text-ink'}`}>{oldest}</span> {pick(lang, 'days', 'दिन')}</span>
          </p>
          <ul className="mt-4 space-y-2.5">
            {ages.map((b) => (
              <li key={b.en} className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-2 text-xs">
                <span className="text-ink-soft">{pick(lang, b.en, b.hi)}</span>
                <span className="h-3 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${b.tone}`} style={{ width: `${b.n ? Math.max(4, (100 * b.n) / ageMax) : 0}%` }} /></span>
                <span className="tnum text-right font-semibold text-ink">{b.n}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <p className="label">{pick(lang, 'What kind of proof', 'किस प्रकार का सबूत')}</p>
          {byType.length === 0 ? <p className="mt-4 text-sm text-ink-faint">{pick(lang, 'Nothing is waiting on you.', 'आपकी प्रतीक्षा में कुछ नहीं।')}</p> : (
            <ul className="mt-4 space-y-2.5">
              {byType.slice(0, 5).map(([type, n]) => (
                <li key={type} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_32px] items-center gap-2 text-xs">
                  <span className="truncate text-ink-soft"><EvidenceTypeName type={type as keyof typeof EVIDENCE_TYPE_LABEL} lang={lang} /></span>
                  <span className="h-3 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-pend/60" style={{ width: `${Math.max(4, (100 * n) / typeMax)}%` }} /></span>
                  <span className="tnum text-right font-semibold text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-white px-4 py-3">
            <p className="flex items-center justify-between gap-2"><span className="label">{pick(lang, 'Waiting on you', 'आपकी प्रतीक्षा में')}</span><Icon name="inbox" size={16} className="shrink-0 text-ink-faint" /></p>
            <p className={`kpi-num mt-2 ${total ? 'text-pend' : 'text-ink'}`}>{total}</p>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-white px-4 py-3">
            <p className="flex items-center justify-between gap-2"><span className="label">{pick(lang, 'GPS outside the school', 'GPS विद्यालय से बाहर')}</span><Icon name="pin" size={16} className="shrink-0 text-ink-faint" /></p>
            <p className={`kpi-num mt-2 ${gpsOff ? 'text-warn' : 'text-ink'}`}>{gpsOff}</p>
          </div>
        </div>
      </section>

      {isSpotOnly ? (
        <Callout tone="note" title={pick(lang, 'You verify by spot-check', 'आप त्वरित जाँच से सत्यापित करते हैं')}>
          {pick(
            lang,
            'As a cluster coordinator your verification carries weight precisely because you were not the one who did the work. Record what you actually saw at the school.',
            'संकुल समन्वयक के रूप में आपकी जाँच इसलिए मायने रखती है कि काम आपने नहीं किया। विद्यालय में जो देखा वही दर्ज करें।',
          )}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-soft">
          <span className="font-medium text-ink">{pick(lang, 'Waiting', 'प्रतीक्षा में')}</span> · {queue.length} {pick(lang, 'pieces of proof, oldest first', 'सबूत, पुराने पहले')}
          {total > queue.length ? <span className="text-ink-faint"> ({pick(lang, 'of', 'कुल')} {total})</span> : null}
        </p>
        <span className="ml-auto inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={pick(lang, 'View', 'दृश्य')}>
          <Link href="/evidence" aria-current={view === 'cards' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'cards' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="grid" size={14} />{pick(lang, 'Cards', 'कार्ड')}</Link>
          <Link href="/evidence?view=list" aria-current={view === 'list' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${view === 'list' ? 'bg-paper-deep font-medium text-ink' : 'text-ink-soft hover:text-ink'}`}><Icon name="list" size={14} />{pick(lang, 'List', 'सूची')}</Link>
        </span>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
          <Icon name="check-circle" size={28} className="mx-auto text-good" />
          <p className="mt-3 font-medium text-ink">{pick(lang, 'Nothing is waiting on you.', 'आपकी प्रतीक्षा में कुछ नहीं।')}</p>
        </div>
      ) : view === 'list' ? (
        <Card>
          <EvidenceList evidence={queue} look={look} lang={lang} emptyText={pick(lang, 'Nothing is waiting on you.', 'आपकी प्रतीक्षा में कुछ नहीं।')}>
            {(e) => actions(e)}
          </EvidenceList>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {queue.map((e) => {
            const d = waited(e);
            const stripe = d > 14 ? 'bg-crit' : d > 7 ? 'bg-warn' : d > 2 ? 'bg-amber' : 'bg-brand/40';
            const who = look.users.get(e.submitted_by) ?? e.submitted_by;
            return (
              <li key={e.id} className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white p-4 pl-5">
                <span className={`absolute inset-y-0 left-0 w-1.5 ${stripe}`} aria-hidden />
                <span className="flex items-center gap-2 text-xs text-ink-faint">
                  <span className="font-mono">{e.id}</span>
                  <span className="ml-auto shrink-0"><EvidenceStatusPill status={e.status} lang={lang} /></span>
                </span>
                <span className="mt-1.5 text-md font-semibold leading-snug text-ink"><EvidenceTypeName type={e.evidence_type} lang={lang} /></span>
                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-soft">
                  <Link href={`/tasks/${e.task_id}`} className="font-mono hover:text-brand">{e.task_id}</Link>
                  <span className="text-ink-faint">·</span>
                  <Link href={`/cases/${e.case_id}`} className="font-mono hover:text-brand">{e.case_id}</Link>
                </span>
                {e.school_id ? <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink-soft"><Icon name="school" size={13} className="shrink-0 text-ink-faint" />{look.schools.get(e.school_id) ?? e.school_id}</span> : null}
                <span className="mt-2"><GpsBadge status={e.gps_status} distance={e.gps_distance_m} accuracy={e.gps_accuracy_m} lang={lang} /></span>
                <EvidenceSummary id={e.id} summary={e.summary} lang={lang} />
                <span className="mt-3 flex items-center gap-2.5 border-t border-line pt-3 text-xs">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-100 text-2xs font-semibold text-navy-700" title={who}>{who.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <span className="min-w-0 truncate text-ink-soft">{who} <span className="text-ink-faint">(<RoleName role={e.submitted_role} lang={lang} />)</span></span>
                  <span className={`tnum ml-auto shrink-0 ${d > 7 ? 'font-medium text-crit' : 'text-ink-soft'}`} title={fmtDate(e.submitted_at, false, lang)}>
                    <Icon name="clock" size={12} className="mr-1 inline" />{d === 0 ? pick(lang, 'today', 'आज') : `${d} ${pick(lang, 'days', 'दिन')}`}
                  </span>
                </span>
                <div className="mt-auto pt-3 no-print">{actions(e)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
