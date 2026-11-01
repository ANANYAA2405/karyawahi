import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { all, one } from '@/lib/db';
import { listApiKeys, recentCalls, RATE_LIMIT } from '@/lib/api/keys';
import { createApiKeyAction, revokeApiKeyAction } from '@/lib/actions-api';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, Card, CardHead, Empty, fmtDate, fmtInt } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { ApiKeyCreate } from '@/components/ApiKeyCreate';

/**
 * API keys for state dashboard systems (VSKs). The state programme team and the demo
 * administrator make a key for one area, see when each key was last used, and revoke keys.
 * Every create and revoke is written to the audit chain; refused attempts too.
 */

export default async function ApiKeysPage() {
  const session = await pageSession();
  const lang = await getLanguage();

  if (!may(session, 'api.manage_keys')) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHead title={pick(lang, 'API keys', 'API कुंजियाँ')} />
        <Callout tone="warn">
          {pick(
            lang,
            'Only the state programme team and the demo administrator can issue or revoke API keys.',
            'API कुंजियाँ केवल राज्य कार्यक्रम दल और डेमो प्रशासक बना या रद्द कर सकते हैं।',
          )}
        </Callout>
        <p className="text-sm text-ink-soft">
          <Link href="/developers" className="link">{pick(lang, 'How the API works', 'API कैसे काम करता है')}</Link>
        </p>
      </div>
    );
  }

  const keys = listApiKeys(session);
  const calls = recentCalls(session, 20);
  const state = one<{ id: string; name: string }>('select id, name from states order by id limit 1') ?? { id: 'STA-01', name: 'STA-01' };
  const districts = all<{ id: string; name: string }>('select id, name from districts order by id');
  const blocks = all<{ id: string; name: string; district_id: string }>('select id, name, district_id from blocks order by id');
  const live = keys.filter((k) => !k.revoked_at).length;
  const scopeLabel = (t: string) => t === 'state' ? pick(lang, 'State', 'राज्य') : t === 'district' ? pick(lang, 'District', 'ज़िला') : pick(lang, 'Block', 'विकासखंड');

  return (
    <div className="space-y-5">
      <PageHead
        breadcrumb={<Link href="/admin" className="link">{pick(lang, 'Administration', 'प्रशासन')}</Link>}
        title={pick(lang, 'API keys for state dashboards', 'राज्य डैशबोर्ड के लिए API कुंजियाँ')}
        sub={pick(
          lang,
          'A key lets a dashboard system, such as a Vidya Samiksha Kendra, read the case ledger for one area. It can only read, never change anything, and it sees nothing outside its area.',
          'कुंजी से कोई डैशबोर्ड सिस्टम, जैसे विद्या समीक्षा केंद्र, एक क्षेत्र का प्रकरण रजिस्टर पढ़ सकता है। वह केवल पढ़ सकता है, कुछ बदल नहीं सकता, और अपने क्षेत्र के बाहर कुछ नहीं देखता।',
        )}
        right={<Link href="/developers" className="btn-quiet">{pick(lang, 'How the API works', 'API कैसे काम करता है')}</Link>}
      />

      <Callout tone="method" title={pick(lang, 'Demo keys only', 'केवल डेमो कुंजियाँ')}>
        {pick(
          lang,
          `Keys begin with kv_demo_ because everything behind them is fictional demo data. Each key may make ${RATE_LIMIT} requests a minute. A demo reset deletes every key.`,
          `कुंजियाँ kv_demo_ से शुरू होती हैं क्योंकि इनके पीछे का सारा डेटा काल्पनिक डेमो डेटा है। हर कुंजी एक मिनट में ${RATE_LIMIT} अनुरोध कर सकती है। डेमो रीसेट से सभी कुंजियाँ हट जाती हैं।`,
        )}
      </Callout>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card>
          <CardHead title={pick(lang, 'New key', 'नई कुंजी')} hint={pick(lang, 'The key is shown once, right after you create it.', 'कुंजी केवल एक बार, बनाते ही दिखाई जाती है।')} />
          <div className="p-4">
            <ApiKeyCreate action={createApiKeyAction} lang={lang} state={state} districts={districts} blocks={blocks} />
          </div>
        </Card>

        <Card>
          <CardHead
            title={pick(lang, 'Keys', 'कुंजियाँ')}
            hint={`${fmtInt(live)} ${pick(lang, 'in use', 'उपयोग में')} · ${fmtInt(keys.length - live)} ${pick(lang, 'revoked', 'रद्द')}`}
          />
          {keys.length === 0 ? (
            <Empty>{pick(lang, 'No keys yet.', 'अभी कोई कुंजी नहीं।')}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {k.name}
                      {k.revoked_at ? <span className="chip ml-2 border-line bg-paper-sunk text-ink-faint">{pick(lang, 'Revoked', 'रद्द')}</span> : <span className="chip ml-2 border-good/30 bg-good-light text-good">{pick(lang, 'Active', 'सक्रिय')}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {scopeLabel(k.scope_type)}: {k.scope_name} <span className="font-mono text-xs text-ink-faint">({k.scope_id})</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      <span className="font-mono">kv_demo_{k.id}_…</span>
                      {' · '}{pick(lang, 'Made by', 'बनाने वाले')} {k.created_by_name}, {fmtDate(k.created_at, true, lang)}
                      {' · '}{k.last_used_at ? `${pick(lang, 'Last used', 'अंतिम उपयोग')} ${fmtDate(k.last_used_at, true, lang)}` : pick(lang, 'Never used', 'कभी उपयोग नहीं')}
                      {' · '}{fmtInt(k.calls_24h)} {pick(lang, 'calls in 24 h', 'अनुरोध (24 घंटे)')}
                      {k.revoked_at ? ` · ${pick(lang, 'Revoked', 'रद्द')} ${fmtDate(k.revoked_at, true, lang)}` : ''}
                    </p>
                  </div>
                  {!k.revoked_at ? (
                    <ActionForm
                      action={revokeApiKeyAction} hidden={{ key_id: k.id }} tone="danger" lang={lang}
                      label={pick(lang, 'Revoke', 'रद्द करें')}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHead
          title={pick(lang, 'Recent calls', 'हाल के अनुरोध')}
          hint={pick(lang, 'Which key asked for what, and the answer it got. Request and response bodies are never logged.', 'किस कुंजी ने क्या माँगा और क्या उत्तर मिला। अनुरोध और उत्तर की सामग्री कभी दर्ज नहीं होती।')}
        />
        {calls.length === 0 ? (
          <Empty>{pick(lang, 'No calls yet.', 'अभी कोई अनुरोध नहीं।')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>{pick(lang, 'Time', 'समय')}</th>
                  <th>{pick(lang, 'Key', 'कुंजी')}</th>
                  <th>{pick(lang, 'Path', 'पथ')}</th>
                  <th>{pick(lang, 'Status', 'स्थिति')}</th>
                  <th>{pick(lang, 'Took', 'समय लगा')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={`${c.ts}-${i}`}>
                    <td className="whitespace-nowrap">{fmtDate(c.ts, true, lang)}</td>
                    <td className="font-mono text-xs">{c.key_id ?? pick(lang, 'no valid key', 'कोई मान्य कुंजी नहीं')}</td>
                    <td className="font-mono text-xs">{c.method} {c.path}</td>
                    <td className={`tnum ${c.status >= 400 ? 'text-crit' : 'text-good'}`}>{c.status}</td>
                    <td className="tnum">{c.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
