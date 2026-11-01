import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { myDay, type DayGroupKey, type DayTask } from '@/lib/myday';
import { lookupsFor } from '@/lib/lookups';
import { STATUS_HI, STATUS as CSTATUS } from '@/lib/complaints';
import { can } from '@/lib/authz';
import { pick, EVIDENCE_TYPE_LABEL } from '@/lib/i18n';
import { acknowledgeTaskAction, startTaskAction } from '@/lib/actions';
import { fmtDate } from '@/components/ui';
import { ActionForm, ReasonBox } from '@/components/ActionForm';
import { PhotoInput } from '@/components/PhotoInput';
import { ProofForm } from '@/components/ProofForm';
import { ProofQueue } from '@/components/ProofQueue';
import { Icon } from '@/components/Icon';
import { SpeakButton } from '@/components/voice';
import { daySpeech, taskSpeech, type SpokenTask } from '@/lib/voice-text';
import type { Language } from '@domain/types';

/**
 * My day — the home screen for cluster and block coordinators and headmasters.
 *
 * Built for a phone first: one column, large buttons, Hindi by default for most of these users.
 * Each task can be marked seen, started and given its proof (with a photo) right here, so a new
 * task goes from the notification to proof handed in without opening another page. The rules are
 * the same as everywhere else: only the owner acts on a task, and someone else checks the proof.
 *
 * Proof works without signal: ProofForm reads the phone's location once and sends the proof, or
 * keeps it on the phone (IndexedDB) when there is no connection, and ProofQueue lists what is
 * still waiting. The service worker (public/sw.js) keeps a copy of this page and its task pages.
 *
 * Voice first: "Listen" reads the day and each task aloud (in Hindi for a Hindi user), and the
 * proof note can be spoken instead of typed (src/components/voice.tsx). Both need a browser
 * that supports them; elsewhere the buttons simply do not appear.
 */

const GROUP: Record<DayGroupKey, { en: string; hi: string; tone: string }> = {
  sent_back: { en: 'Sent back to you', hi: 'आपको लौटाया गया', tone: 'text-crit' },
  overdue: { en: 'Late', hi: 'विलंबित', tone: 'text-crit' },
  today: { en: 'Due today', hi: 'आज देय', tone: 'text-warn' },
  week: { en: 'This week', hi: 'इस सप्ताह', tone: 'text-ink' },
  later: { en: 'Later', hi: 'बाद में', tone: 'text-ink' },
  waiting: { en: 'Handed in, being checked', hi: 'जमा, जाँच जारी', tone: 'text-ink-soft' },
};

function dueText(lang: Language, t: DayTask): string {
  if (t.dueIn < 0) return pick(lang, `${-t.dueIn} day${t.dueIn === -1 ? '' : 's'} late`, `${-t.dueIn} दिन विलंब`);
  if (t.dueIn === 0) return pick(lang, 'Due today', 'आज देय');
  if (t.dueIn === 1) return pick(lang, 'Due tomorrow', 'कल देय');
  return `${pick(lang, 'Due', 'नियत')} ${fmtDate(t.due_date, false, lang)}`;
}

export default async function MyDayPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const day = myDay(session);
  const tasks = day.groups.flatMap((g) => g.tasks);
  const look = lookupsFor(lang, {
    users: [], schools: [...tasks.map((t) => t.school_id ?? ''), ...day.complaints.map((c) => c.school_id ?? '')],
  });
  const first = session.full_name.split(' ')[0];
  const summary = day.open === 0
    ? pick(lang, 'Nothing is waiting on you.', 'अभी आपके पास कोई काम लंबित नहीं है।')
    : day.urgent === day.open
      ? pick(lang, day.open === 1 ? 'Your 1 open task needs you today.' : `All ${day.open} of your open tasks need you today.`, `आपके ${day.open} खुले ${day.open === 1 ? 'काम' : 'कामों'} पर आज ध्यान चाहिए।`)
    : day.urgent > 0
      ? pick(lang, `${day.urgent} of your ${day.open} open tasks need you today.`, `आपके ${day.open} खुले कामों में से ${day.urgent} पर आज ध्यान चाहिए।`)
      : pick(lang, `${day.open} open task${day.open === 1 ? '' : 's'}, none due today.`, `${day.open} खुले काम, आज कोई देय नहीं।`);
  // What "Listen" reads: built here so the words match the page, said by the browser.
  const spoken = new Map<string, SpokenTask>(day.groups.flatMap((g) => g.tasks.map((t): [string, SpokenTask] => {
    const ev = EVIDENCE_TYPE_LABEL[t.proof_type as keyof typeof EVIDENCE_TYPE_LABEL];
    return [t.id, {
      title: pick(lang, t.title_en, t.title_hi),
      school: t.school_id ? look.schools.get(t.school_id) ?? t.school_id : null,
      dueIn: t.dueIn, dueDate: fmtDate(t.due_date, false, lang),
      pieces: t.pieces, proofCount: t.proof_count,
      proofLabel: pick(lang, ev?.en ?? t.proof_type, ev?.hi ?? t.proof_type),
      rejection: t.rejection, waiting: g.key === 'waiting', crossSource: !!t.cross_source,
    }];
  })));
  const dayText = daySpeech(lang, { name: first, date: fmtDate(day.date, false, lang), summary, tasks: [...spoken.values()] });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="text-sm text-ink-soft">{fmtDate(day.date, false, lang)}</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{pick(lang, `Namaste, ${first}`, `नमस्ते, ${first}`)}</h1>
        <p className="mt-1 text-md text-ink-soft">{summary}</p>
        <SpeakButton text={dayText} lang={lang} size="lg" className="mt-3"
          label={pick(lang, 'Listen to my day', 'मेरा दिन सुनें')} />
      </header>

      {/* Proof saved on this phone without signal, until it is sent. Browser-only; empty renders nothing. */}
      <ProofQueue userId={session.user_id} lang={lang} />

      {day.groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={`mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-[0.06em] ${GROUP[g.key].tone}`}>
            {pick(lang, GROUP[g.key].en, GROUP[g.key].hi)}<span className="tnum font-normal text-ink-faint">{g.tasks.length}</span>
          </h2>
          <ul className="space-y-3">
            {g.tasks.map((t) => (
              <li key={t.id} className="rounded-xl border border-line bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/tasks/${t.id}`} className="min-w-0 text-md font-medium leading-snug text-ink hover:text-brand">
                    {pick(lang, t.title_en, t.title_hi)}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    {t.isNew ? <span className="chip border-brand/30 bg-brand-light text-brand">{pick(lang, 'New', 'नया')}</span> : null}
                    <SpeakButton text={taskSpeech(lang, spoken.get(t.id)!)} lang={lang} subject={pick(lang, t.title_en, t.title_hi)} />
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                  <span className="inline-flex items-center gap-1"><Icon name="pin" size={13} />{t.school_id ? look.schools.get(t.school_id) ?? t.school_id : pick(lang, 'All plan schools', 'सभी योजना विद्यालय')}</span>
                  <span className={t.dueIn < 0 ? 'font-medium text-crit' : t.dueIn === 0 ? 'font-medium text-warn' : ''}>{dueText(lang, t)}</span>
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {pick(lang, 'Proof', 'सबूत')}: <span className="tnum">{t.pieces}/{t.proof_count}</span>{' '}
                  {pick(lang, EVIDENCE_TYPE_LABEL[t.proof_type as keyof typeof EVIDENCE_TYPE_LABEL]?.en ?? t.proof_type, EVIDENCE_TYPE_LABEL[t.proof_type as keyof typeof EVIDENCE_TYPE_LABEL]?.hi ?? t.proof_type)}
                  {t.cross_source ? <span className="ml-1 text-brand">· {pick(lang, 'independent check', 'स्वतंत्र जाँच')}</span> : null}
                </p>
                {t.rejection ? (
                  <p className="mt-2 rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-sm text-crit">
                    <span className="font-semibold">{pick(lang, 'Why it came back:', 'लौटाने का कारण:')}</span> {t.rejection}
                  </p>
                ) : null}

                {g.key === 'waiting' ? (
                  <p className="mt-2 text-sm text-ink-faint">{pick(lang, 'All proof is in. Someone other than you is checking it.', 'सारे सबूत जमा हैं। कोई और उनकी जाँच कर रहा है।')}</p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {t.status === 'assigned' ? (
                      <ActionForm action={acknowledgeTaskAction} hidden={{ task_id: t.id }} lang={lang} tone="quiet" buttonClassName="min-h-11 px-4"
                        label={pick(lang, 'Seen it', 'देख लिया')} />
                    ) : null}
                    {['assigned', 'acknowledged', 'sent_back'].includes(t.status) ? (
                      <ActionForm action={startTaskAction} hidden={{ task_id: t.id }} lang={lang} tone="quiet" buttonClassName="min-h-11 px-4"
                        label={pick(lang, 'Started', 'शुरू किया')} />
                    ) : null}
                    <details className="group basis-full">
                      <summary className="btn-primary min-h-11 cursor-pointer list-none px-4 group-open:mb-3">
                        <Icon name="upload" size={16} />{pick(lang, 'Hand in proof', 'सबूत जमा करें')}
                      </summary>
                      <div className="rounded-lg border border-line bg-paper-sunk p-3">
                        <ProofForm
                          taskId={t.id} schoolId={t.school_id ?? ''} taskTitle={pick(lang, t.title_en, t.title_hi)}
                          userId={session.user_id} lang={lang} label={pick(lang, 'Hand in', 'जमा करें')}
                        >
                          <PhotoInput
                            label={pick(lang, 'Photo of the proof', 'सबूत का फ़ोटो')}
                            hint={pick(lang, 'Opens the camera on a phone. Shrunk before sending.', 'फ़ोन पर कैमरा खुलेगा। भेजने से पहले छोटा किया जाता है।')}
                            changeLabel={pick(lang, 'tap the button to retake', 'दोबारा लेने के लिए बटन दबाएँ')}
                            buttonLabel={pick(lang, 'Take a photo', 'फ़ोटो लें')}
                          />
                          <ReasonBox name="note" required rows={3} lang={lang}
                            label={pick(lang, 'What it shows', 'यह क्या दिखाता है')}
                            placeholder={pick(lang, 'What was done, where and when.', 'क्या किया, कहाँ और कब।')} />
                        </ProofForm>
                      </div>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {day.complaints.length > 0 ? (
        <section aria-labelledby="g-complaints">
          <h2 id="g-complaints" className="mb-2 text-sm font-semibold uppercase tracking-[0.06em] text-ink">{pick(lang, 'Complaints waiting on you', 'आप पर लंबित शिकायतें')}</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {day.complaints.map((c) => (
              <li key={c.id}>
                <Link href={`/complaints?open=${c.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-paper-sunk">
                  <span className="min-w-0">
                    <span className="block truncate text-md text-ink">{c.title}</span>
                    <span className="block text-sm text-ink-faint">{pick(lang, CSTATUS[c.status]?.label ?? c.status, STATUS_HI[c.status] ?? c.status)}{c.school_id ? ` · ${look.schools.get(c.school_id) ?? c.school_id}` : ''}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {day.visits?.length ? (
        <section aria-labelledby="g-visits">
          <h2 id="g-visits" className="mb-2 text-sm font-semibold uppercase tracking-[0.06em] text-ink">{pick(lang, 'Schools longest without a visit', 'सबसे लंबे समय से बिना भ्रमण वाले विद्यालय')}</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {day.visits.map((v) => (
              <li key={v.id}>
                <Link href={`/schools/${v.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-paper-sunk">
                  <span className="truncate text-md text-ink">{v.name}</span>
                  <span className={`shrink-0 text-sm ${v.days === null || v.days > 60 ? 'text-crit' : 'text-ink-soft'}`}>
                    {v.days === null ? pick(lang, 'Never visited', 'कभी भ्रमण नहीं') : pick(lang, `${v.days} days ago`, `${v.days} दिन पहले`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {can(session, 'create_complaint') ? (
        <Link href="/complaints/new" className="btn-quiet min-h-11 w-full justify-center">
          <Icon name="plus" size={16} />{pick(lang, 'Raise a problem', 'समस्या दर्ज करें')}
        </Link>
      ) : null}
    </div>
  );
}
