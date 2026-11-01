import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { nowIso, today } from '@/lib/clock';
import { listJobs, listOutbox } from '@/lib/feed';
import { headline } from '@/lib/dash';
import { countCases } from '@/lib/cases';
import { rounds } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Grid, Stat, Callout, Mono, fmtDate, fmtInt } from '@/components/ui';
import { ActionForm, Disclose } from '@/components/ActionForm';
import { reminderSweepAction, setClockAction, demoResetAction, complaintSweepAction } from '@/lib/actions';
import { AS_OF_DATE } from '@domain/catalog';

/**
 * Demo controls.
 *
 * The clock matters more than it sounds. Everything date-dependent in this app — overdue
 * counts, the two-day reminder, the seven-day escalation, which assessment round is "next" —
 * is measured from the demo clock, not the wall clock. Moving it forward is how the demo
 * reaches the November round and the outcome checks that follow it.
 */

export default async function AdminHome() {
  const session = await pageSession();
  const lang = await getLanguage();

  if (!may(session, 'demo.reset')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Demo admin', 'डेमो प्रशासन')} />
        <Callout tone="warn">
          {pick(lang, 'Only the demo administrator can use these controls.', 'केवल डेमो प्रशासक ये नियंत्रण उपयोग कर सकते हैं।')}
        </Callout>
      </div>
    );
  }

  const h = headline(session);
  const jobs = listJobs(session, { limit: 10 });
  const outbox = listOutbox(session, { limit: 5 });
  const nextRound = rounds().find((r) => r.status === 'scheduled');

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'System & demo controls', 'सिस्टम व डेमो नियंत्रण')}
        sub={pick(
          lang,
          'Move the clock, run the nightly sweep, or put everything back the way it was. Each of these writes itself into the audit log.',
          'घड़ी बदलें, रात्रि कार्य चलाएँ, या सब कुछ पूर्व स्थिति में लाएँ। हर कार्य अंकेक्षण लॉग में दर्ज होता है।',
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Demo date', 'डेमो तिथि')} value={<span className="text-md">{fmtDate(today())}</span>}
          sub={`${pick(lang, 'seed date', 'बीज तिथि')} ${AS_OF_DATE}`} tone="brand" />
        <Stat label={pick(lang, 'Cases', 'प्रकरण')} value={fmtInt(countCases(session))} />
        <Stat label={pick(lang, 'Overdue tasks', 'विलंबित काम')} value={h.overdue_tasks} tone={h.overdue_tasks > 0 ? 'crit' : 'neutral'} />
        <Stat label={pick(lang, 'Proof pending', 'सबूत प्रतीक्षित')} value={h.evidence_pending} tone="warn" />
      </Grid>

      <Card>
        <CardHead
          title={pick(lang, 'The demo clock', 'डेमो घड़ी')}
          hint={pick(lang, `Currently ${nowIso()}. Nothing in the seed happens after the seed date.`, `अभी ${nowIso()}।`)}
        />
        <div className="card-pad space-y-3">
          <Callout tone="method" title={pick(lang, 'Why there is a clock at all', 'घड़ी क्यों है')}>
            {pick(
              lang,
              `The seed stops at ${AS_OF_DATE}, so case statuses are a true snapshot of that moment. Reading "today" from the system clock would make the demo drift: tasks would silently become overdue and the escalation counts would climb on their own. Everything date-dependent reads this value instead.`,
              `बीज ${AS_OF_DATE} पर रुकता है, अतः स्थितियाँ उस क्षण का सही चित्र हैं। सिस्टम घड़ी से "आज" पढ़ने पर डेमो बहकने लगेगा।`,
            )}
          </Callout>
          {nextRound ? (
            <Callout tone="note" title={pick(lang, 'To reach the next assessment round', 'अगले आकलन दौर तक पहुँचने के लिए')}>
              {pick(
                lang,
                `${nextRound.code} (${nextRound.label}) opens on ${nextRound.window_start}. Move the clock to 20 November 2026, then upload samples/assessment_R4_midline_BLK-01_SIMULATED.csv from the data import page; the outcome checks for cases waiting on that round will then have data to run against.`,
                `${nextRound.code} (${nextRound.label}) ${nextRound.window_start} से शुरू होता है। घड़ी 20 नवंबर 2026 पर ले जाएँ, फिर नमूना फ़ाइल अपलोड करें।`,
              )}
            </Callout>
          ) : null}
          <ActionForm
            action={setClockAction}
            label={pick(lang, 'Set the demo date', 'डेमो तिथि तय करें')}
          >
            <label className="mb-2 block max-w-xs">
              <span className="label">{pick(lang, 'Demo date', 'डेमो तिथि')}</span>
              <input type="date" name="date" defaultValue={today()} className="input mt-1" required />
            </label>
          </ActionForm>
          <div className="flex gap-2">
            <ActionForm action={setClockAction} hidden={{ date: AS_OF_DATE }}
              label={pick(lang, 'Back to the seed date', 'बीज तिथि पर लौटें')} tone="quiet" />
            <ActionForm action={setClockAction} hidden={{ date: '2026-11-20' }}
              label={pick(lang, 'Jump to 20 Nov 2026', '20 नवंबर 2026 पर जाएँ')} tone="quiet" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Reminder and escalation sweep', 'स्मरण और उच्चाधिकारी कार्य')}
          hint={pick(lang, 'One reminder two days before a deadline, one escalation seven days after. Never twice for the same task.', 'नियत तिथि से दो दिन पहले स्मरण, सात दिन बाद उच्चाधिकारी को। एक काम के लिए एक बार।')}
        />
        <div className="card-pad space-y-3">
          <Callout tone="method">
            {pick(
              lang,
              'In production this runs nightly from pg_cron. It is idempotent by construction: a task that already has a reminder timestamp is skipped, so running it twice on the same day sends nothing the second time. Try it.',
              'उत्पादन में यह रोज़ रात चलता है। यह idempotent है: जिस काम का स्मरण भेजा जा चुका है वह छोड़ दिया जाता है।',
            )}
          </Callout>
          <ActionForm action={reminderSweepAction} hidden={{ as_of: today() }}
            label={pick(lang, 'Run the sweep now', 'अभी चलाएँ')} tone="quiet" />
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm text-ink-soft">Complaints: escalate every complaint past its acknowledgement or resolution deadline to the next designated authority. Each escalation is written to the complaint timeline and the audit chain; running it twice on the same date escalates nothing more.</p>
            <ActionForm action={complaintSweepAction} label="Run the complaint SLA sweep" tone="quiet" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Reset the demo', 'डेमो रीसेट करें')}
          hint={pick(lang, 'Restores the canonical seed exactly as generated.', 'मूल बीज जैसा था वैसा लौटाता है।')}
        />
        <div className="card-pad space-y-3">
          <Callout tone="warn" title={pick(lang, 'This discards every change made in the demo', 'यह डेमो में किए सभी बदलाव हटा देता है')}>
            {pick(
              lang,
              'Approvals, verifications, proof you submitted, recomputed outcomes and clock changes all go back to the generated seed. The reset itself is then written into the audit log, so the record shows that it happened.',
              'स्वीकृतियाँ, सत्यापन, जमा सबूत, पुनर्गणित परिणाम और घड़ी — सब मूल बीज पर लौट जाएँगे। रीसेट स्वयं अंकेक्षण लॉग में दर्ज होगा।',
            )}
          </Callout>
          <Disclose label={pick(lang, 'Reset the demo…', 'डेमो रीसेट करें…')} tone="danger">
            <ActionForm
              action={demoResetAction}
              label={pick(lang, 'Yes, restore the seed', 'हाँ, बीज लौटाएँ')}
              tone="danger"
              confirm={pick(lang, 'There is no undo.', 'इसे पूर्ववत नहीं किया जा सकता।')}
            />
          </Disclose>
        </div>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Recent background jobs', 'हाल के पृष्ठभूमि कार्य')}
          right={<Link href="/admin/jobs" className="link text-sm">{pick(lang, 'All jobs', 'सभी कार्य')}</Link>}
        />
        <ul className="divide-y divide-line">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm sm:px-5">
              <Mono>{j.job_type}</Mono>
              <span className="tnum text-xs text-ink-faint">{fmtDate(j.started_at, true)}</span>
              <span className="text-xs text-ink-soft">
                {Object.entries(j.summary).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead
          title={pick(lang, 'Message outbox', 'संदेश आउटबॉक्स')}
          hint={pick(lang, 'WhatsApp, IVR and SMS messages the app would have sent. None were delivered.', 'ऐप जो WhatsApp, IVR और SMS भेजता, वे यहाँ हैं। कोई भेजा नहीं गया।')}
          right={<Link href="/admin/outbox" className="link text-sm">{pick(lang, 'Open the outbox', 'आउटबॉक्स खोलें')}</Link>}
        />
        <ul className="divide-y divide-line">
          {outbox.map((o) => (
            <li key={o.id} className="px-4 py-2 text-sm sm:px-5">
              <span className="text-ink-faint">{o.channel}</span> · {o.body.slice(0, 110)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
