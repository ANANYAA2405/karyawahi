import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listNotifications, countUnread, listOutbox } from '@/lib/feed';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Empty, Callout, fmtDate } from '@/components/ui';
import { Pill, NotSent } from '@/components/labels';
import { markReadAction } from '@/lib/actions';

/** In-app notifications, plus what would have gone out over other channels to this user. */

const KIND_TONE: Record<string, 'good' | 'warn' | 'critical' | 'pending' | 'active' | 'neutral'> = {
  approval_request: 'pending',
  assignment: 'active',
  acknowledgement: 'neutral',
  deadline_upcoming: 'warn',
  task_overdue: 'critical',
  escalation: 'critical',
  evidence_submitted: 'pending',
  evidence_rejected: 'warn',
  outcome_available: 'active',
  case_closed: 'good',
  case_reopened: 'critical',
  import_succeeded: 'good',
  import_failed: 'critical',
  report_generated: 'neutral',
};

export default async function NotificationsPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const items = listNotifications(session, { limit: 120 });
  const unread = countUnread(session);
  const mine = listOutbox(session, { limit: 30 });

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'Notifications', 'सूचनाएँ')}
        sub={pick(
          lang,
          'In-app notifications since 1 July 2026. Reminders go out two days before a deadline and escalations seven days after one.',
          '1 जुलाई 2026 से ऐप सूचनाएँ। नियत तिथि से दो दिन पहले स्मरण, सात दिन बाद उच्चाधिकारी को।',
        )}
        right={
          unread > 0 ? (
            <form action={markReadAction}>
              <input type="hidden" name="notification_id" value="all" />
              <input type="hidden" name="then" value="/notifications" />
              <button type="submit" className="btn-quiet">
                {pick(lang, `Mark all ${unread} as read`, `सभी ${unread} पढ़े हुए चिह्नित करें`)}
              </button>
            </form>
          ) : null
        }
      />

      <Card>
        <CardHead
          title={pick(lang, 'In the app', 'ऐप में')}
          hint={`${items.length} ${pick(lang, 'shown', 'दिखाई')}${unread > 0 ? ` · ${unread} ${pick(lang, 'unread', 'अपठित')}` : ''}`}
        />
        {items.length === 0 ? (
          <Empty>{pick(lang, 'No notifications.', 'कोई सूचना नहीं।')}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={`px-4 py-3 sm:px-5 ${n.read_at ? '' : 'bg-brand-light/40'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={KIND_TONE[n.kind] ?? 'neutral'}>{n.kind.replace(/_/g, ' ')}</Pill>
                      {!n.read_at ? <Pill tone="active">{pick(lang, 'new', 'नया')}</Pill> : null}
                      <span className="tnum text-xs text-ink-faint">{fmtDate(n.ts, true)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink">{n.title}</p>
                    <p className="text-sm text-ink-soft">{n.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 no-print">
                    <Link href={n.link} className="btn-quiet">{pick(lang, 'Open', 'खोलें')}</Link>
                    {!n.read_at ? (
                      <form action={markReadAction}>
                        <input type="hidden" name="notification_id" value={n.id} />
                        <input type="hidden" name="then" value="/notifications" />
                        <button type="submit" className="btn-quiet">{pick(lang, 'Mark read', 'पढ़ा')}</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {mine.length > 0 ? (
        <Card>
          <CardHead
            title={pick(lang, 'What would have reached you another way', 'अन्य माध्यम से क्या पहुँचता')}
            hint={pick(lang, 'Not everybody reads an app. These are the WhatsApp, IVR and SMS messages for you.', 'हर कोई ऐप नहीं पढ़ता। ये आपके लिए WhatsApp, IVR और SMS संदेश हैं।')}
            right={<NotSent lang={lang} />}
          />
          <ul className="divide-y divide-line">
            {mine.map((m) => (
              <li key={m.id} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="active">{m.channel}</Pill>
                  <Pill>{m.language === 'hi' ? 'हिंदी' : 'English'}</Pill>
                  <span className="tnum text-xs text-ink-faint">{fmtDate(m.ts, true)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Callout tone="method">
          {pick(
            lang,
            'This account has no messages queued for WhatsApp, IVR or SMS. Field roles do; the demo administrator can see all of them in the outbox.',
            'इस खाते के लिए कोई WhatsApp, IVR या SMS संदेश नहीं। क्षेत्रीय भूमिकाओं के पास हैं।',
          )}
        </Callout>
      )}
    </div>
  );
}
