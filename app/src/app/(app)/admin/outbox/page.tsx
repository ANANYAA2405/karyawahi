import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listOutbox } from '@/lib/feed';
import { userNames } from '@/lib/repo';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Toolbar, Empty, Mono, fmtDate } from '@/components/ui';
import { Pill, NotSent } from '@/components/labels';
import { FilterChips } from '@/components/lists';

/**
 * The simulated outbox.
 *
 * A field user without a smartphone is reached by WhatsApp, an IVR call or an SMS. This demo is
 * not connected to any of those, so the messages it would have sent are written here instead,
 * every one marked as not delivered. Showing them is the point: the message text is part of the
 * design, and pretending they went out would be a lie.
 */

export default async function OutboxPage({
  searchParams,
}: { searchParams: Promise<{ channel?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  const all = listOutbox(session, { limit: 500 });
  const messages = sp.channel ? all.filter((m) => m.channel === sp.channel) : all;
  const users = userNames(messages.map((m) => m.user_id));
  const channels = [...new Set(all.map((m) => m.channel))];

  return (
    <div>
      <PageHead
        title={pick(lang, 'Message outbox', 'संदेश आउटबॉक्स')}
        sub={pick(
          lang,
          'Messages the app would have sent over WhatsApp, IVR or SMS. Nothing was delivered — there is no connection to any of those services.',
          'जो संदेश ऐप WhatsApp, IVR या SMS से भेजता। कुछ भी भेजा नहीं गया — कोई सेवा जुड़ी नहीं है।',
        )}
        right={<NotSent lang={lang} />}
      />
      <div className="mb-4">
        <Callout tone="warn" title={pick(lang, 'Simulated, not sent', 'नकली, भेजा नहीं गया')}>
          {pick(
            lang,
            'Every row is stored with delivery_status "simulated_not_sent". A real deployment would hand these to a gateway; this one keeps them so the wording and the language choice can be reviewed.',
            'हर पंक्ति "simulated_not_sent" के साथ संग्रहीत है। वास्तविक तैनाती में ये गेटवे को जाते; यहाँ शब्द और भाषा की समीक्षा के लिए रखे गए हैं।',
          )}
        </Callout>
      </div>
      <Toolbar>
        <FilterChips
          base="/admin/outbox" param="channel" current={sp.channel} lang={lang}
          options={[
            { value: '', label: pick(lang, 'All channels', 'सभी माध्यम'), count: all.length },
            ...channels.map((c) => ({ value: c, label: c, count: all.filter((m) => m.channel === c).length })),
          ]}
        />
      </Toolbar>
      <Card>
        <CardHead title={pick(lang, 'Messages', 'संदेश')} hint={`${messages.length} ${pick(lang, 'shown, newest first', 'दिखाए')}`} />
        {messages.length === 0 ? <Empty /> : (
          <ul className="divide-y divide-line">
            {messages.map((m) => (
              <li key={m.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="active">{m.channel}</Pill>
                  <Pill>{m.language === 'hi' ? 'हिंदी' : 'English'}</Pill>
                  <Mono>{m.template}</Mono>
                  <span className="text-sm text-ink-soft">{users.get(m.user_id) ?? m.user_id}</span>
                  <span className="tnum text-xs text-ink-faint">{fmtDate(m.ts, true)}</span>
                  <Pill tone="warn">{m.delivery_status.replace(/_/g, ' ')}</Pill>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
