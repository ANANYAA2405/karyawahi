import Link from 'next/link';
import { headers } from 'next/headers';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { RATE_LIMIT } from '@/lib/api/keys';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, Card, CardHead } from '@/components/ui';

/**
 * The API, explained in plain words for the people who wire a state dashboard to it. Open to
 * every signed-in user: it describes the API and holds no data. Keys are issued at
 * /admin/api-keys by the state programme team.
 */

export default async function DevelopersPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  const base = `${proto}://${host}/api/v1`;
  const canManage = may(session, 'api.manage_keys');

  const endpoints: { path: string; en: string; hi: string }[] = [
    { path: 'GET /cases', en: 'Cases in your area, oldest change first. Filters: status, severity, block, updated_since, open.', hi: 'आपके क्षेत्र के प्रकरण, सबसे पुराने बदलाव पहले। फ़िल्टर: status, severity, block, updated_since, open.' },
    { path: 'GET /cases/{id}', en: 'One case: what was found, its stage, the owner’s role, the plan’s intervention, task counts and the latest outcome check.', hi: 'एक प्रकरण: क्या पाया गया, चरण, ज़िम्मेदार की भूमिका, योजना का हस्तक्षेप, कार्यों की गिनती और अंतिम परिणाम जाँच।' },
    { path: 'GET /tasks', en: 'Field tasks with due dates, status and the owner’s role. Filters: case, status, block, overdue.', hi: 'नियत तिथि, स्थिति और ज़िम्मेदार की भूमिका सहित क्षेत्र कार्य। फ़िल्टर: case, status, block, overdue.' },
    { path: 'GET /outcomes', en: 'Outcome checks: the difference-in-differences, its interval, the category and the rounds compared.', hi: 'परिणाम जाँच: अंतर-में-अंतर, उसका अंतराल, श्रेणी और तुलना किए गए आकलन चक्र।' },
    { path: 'GET /hotspots', en: 'Learning hotspots one level below your area (or below ?within=…), worst first.', hi: 'आपके क्षेत्र से एक स्तर नीचे (या ?within=… के नीचे) सीखने के हॉटस्पॉट, सबसे गंभीर पहले।' },
    { path: 'GET /summary', en: 'Headline figures for your area: open and critical cases, overdue tasks, outcomes.', hi: 'आपके क्षेत्र के मुख्य आँकड़े: खुले और गंभीर प्रकरण, विलंबित कार्य, परिणाम।' },
    { path: 'GET /openapi.json', en: 'The full machine-readable description. No key needed.', hi: 'पूरा मशीन-पठनीय विवरण। कुंजी की ज़रूरत नहीं।' },
  ];

  const curl = `curl -H "Authorization: Bearer kv_demo_…" \\\n  "${base}/cases?severity=critical&open=true&limit=20"`;
  const next = `curl -H "Authorization: Bearer kv_demo_…" \\\n  "${base}/cases?severity=critical&open=true&limit=20&cursor=<page.next_cursor>"`;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHead
        title={pick(lang, 'API for state dashboards', 'राज्य डैशबोर्ड के लिए API')}
        sub={pick(
          lang,
          'A read-only way for a state dashboard system, such as a Vidya Samiksha Kendra, to pull the case ledger for one area as JSON.',
          'राज्य डैशबोर्ड सिस्टम, जैसे विद्या समीक्षा केंद्र, के लिए एक क्षेत्र का प्रकरण रजिस्टर JSON में पढ़ने का केवल-पठन तरीका।',
        )}
        right={canManage ? <Link href="/admin/api-keys" className="btn-primary">{pick(lang, 'Manage keys', 'कुंजियाँ प्रबंधित करें')}</Link> : undefined}
      />

      <Callout tone="warn" title={pick(lang, 'Demo data', 'डेमो डेटा')}>
        {pick(
          lang,
          'Everything this API returns is fictional seed data, not government statistics. Every response says so in two fields: "demo_data": true and "disclaimer".',
          'यह API जो कुछ भी लौटाता है वह काल्पनिक डेटा है, सरकारी आँकड़े नहीं। हर उत्तर में यह दो फ़ील्ड में लिखा होता है: "demo_data": true और "disclaimer"।',
        )}
      </Callout>

      <Card>
        <CardHead title={pick(lang, 'How it works', 'यह कैसे काम करता है')} />
        <ol className="list-decimal space-y-2 px-8 py-4 text-base leading-relaxed text-ink-soft">
          <li>{pick(lang, 'The state programme team creates a key for one area — the whole state, one district or one block — on the API keys page. The key is shown once; copy it then.', 'राज्य कार्यक्रम दल API कुंजी पृष्ठ पर एक क्षेत्र — पूरा राज्य, एक ज़िला या एक विकासखंड — के लिए कुंजी बनाता है। कुंजी केवल एक बार दिखती है; तभी कॉपी करें।')}</li>
          <li>{pick(lang, 'The dashboard’s server sends the key with every request, in the Authorization header. Signing in to this app does not work here: the API ignores cookies.', 'डैशबोर्ड का सर्वर हर अनुरोध के साथ कुंजी Authorization हेडर में भेजता है। इस ऐप में साइन इन करना यहाँ काम नहीं करता: API कुकी को नहीं मानता।')}</li>
          <li>{pick(lang, 'Each answer covers only the key’s area. A case in another area answers “not found”, exactly as a case that does not exist.', 'हर उत्तर केवल कुंजी के क्षेत्र का होता है। दूसरे क्षेत्र का प्रकरण “नहीं मिला” बताता है, ठीक वैसे ही जैसे जो प्रकरण है ही नहीं।')}</li>
          <li>{pick(lang, `Each key may make ${RATE_LIMIT} requests a minute. Past that the API answers 429 and says, in the Retry-After header, how many seconds to wait.`, `हर कुंजी एक मिनट में ${RATE_LIMIT} अनुरोध कर सकती है। उससे ज़्यादा पर API 429 देता है और Retry-After हेडर में बताता है कि कितने सेकंड रुकें।`)}</li>
          <li>{pick(lang, 'Every call is logged (which key, which path, the answer, the time — never the content), and the key’s “last used” time moves. A revoked key stops working at once.', 'हर अनुरोध दर्ज होता है (कौन-सी कुंजी, कौन-सा पथ, उत्तर, समय — सामग्री कभी नहीं), और कुंजी का “अंतिम उपयोग” समय बदलता है। रद्द की गई कुंजी तुरंत काम करना बंद कर देती है।')}</li>
        </ol>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Try it', 'आज़माएँ')} hint={pick(lang, 'Replace kv_demo_… with your key.', 'kv_demo_… की जगह अपनी कुंजी लिखें।')} />
        <div className="space-y-3 p-4">
          <pre className="overflow-x-auto rounded-md border border-line bg-paper-sunk p-3 font-mono text-sm text-ink">{curl}</pre>
          <p className="text-sm text-ink-soft">
            {pick(lang, 'Lists come a page at a time. When page.next_cursor is not null, ask again with it to get the next page:', 'सूचियाँ एक-एक पृष्ठ में आती हैं। जब page.next_cursor खाली न हो, अगले पृष्ठ के लिए उसके साथ फिर पूछें:')}
          </p>
          <pre className="overflow-x-auto rounded-md border border-line bg-paper-sunk p-3 font-mono text-sm text-ink">{next}</pre>
          <p className="text-sm text-ink-soft">
            {pick(lang, 'To keep a copy up to date, remember the newest updated_at you have seen and pass it back as updated_since next time.', 'प्रति को अद्यतन रखने के लिए, देखा गया सबसे नया updated_at याद रखें और अगली बार उसे updated_since में भेजें।')}
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Endpoints', 'एंडपॉइंट')} hint={<span className="font-mono">{base}</span>} />
        <ul className="divide-y divide-line">
          {endpoints.map((e) => (
            <li key={e.path} className="px-4 py-3">
              <p className="font-mono text-sm font-semibold text-ink">{e.path}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{pick(lang, e.en, e.hi)}</p>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-sm">
          <a href="/api/v1/openapi.json" className="link">{pick(lang, 'Open the OpenAPI document', 'OpenAPI दस्तावेज़ खोलें')}</a>
        </p>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'What the API leaves out, on purpose', 'API जानबूझकर क्या नहीं देता')} />
        <ul className="list-disc space-y-1.5 px-8 py-4 text-base leading-relaxed text-ink-soft">
          <li>{pick(lang, 'People: no names, phone numbers, email addresses or account ids. Who owns a case or task is given as a role — BEO, CRC, headmaster.', 'व्यक्ति: कोई नाम, फ़ोन नंबर, ईमेल या खाता पहचान नहीं। प्रकरण या कार्य किसका है, यह भूमिका से बताया जाता है — BEO, CRC, प्रधानाध्यापक।')}</li>
          <li>{pick(lang, 'Anything people wrote: case discussions, plan reasoning, reasons for decisions, notes on proof and visits. A manual case gets a generated title instead of the one an officer typed.', 'लोगों का लिखा कुछ भी: प्रकरण की चर्चा, योजना का तर्क, निर्णयों के कारण, सबूत और भ्रमण पर टिप्पणियाँ। हाथ से बने प्रकरण को अधिकारी के लिखे शीर्षक की जगह स्वतः बना शीर्षक मिलता है।')}</li>
          <li>{pick(lang, 'Complaints and grievances, in full.', 'शिकायतें, पूरी तरह।')}</li>
        </ul>
      </Card>

      <Card>
        <CardHead title={pick(lang, 'Answers you may get', 'मिलने वाले उत्तर')} />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[80px_minmax(0,1fr)]">
          <dt className="font-mono font-semibold text-ink">200</dt><dd className="text-ink-soft">{pick(lang, 'Here is the data.', 'यह रहा डेटा।')}</dd>
          <dt className="font-mono font-semibold text-ink">400</dt><dd className="text-ink-soft">{pick(lang, 'A filter is not valid; the message says which.', 'कोई फ़िल्टर मान्य नहीं; संदेश बताता है कौन-सा।')}</dd>
          <dt className="font-mono font-semibold text-ink">401</dt><dd className="text-ink-soft">{pick(lang, 'No key, or a wrong or revoked one. The answer does not say which.', 'कुंजी नहीं, या गलत या रद्द कुंजी। उत्तर यह नहीं बताता कि कौन-सी बात है।')}</dd>
          <dt className="font-mono font-semibold text-ink">404</dt><dd className="text-ink-soft">{pick(lang, 'Not in your area, or does not exist.', 'आपके क्षेत्र में नहीं, या मौजूद ही नहीं।')}</dd>
          <dt className="font-mono font-semibold text-ink">429</dt><dd className="text-ink-soft">{pick(lang, 'Too many requests this minute; wait the seconds in Retry-After.', 'इस मिनट बहुत अनुरोध; Retry-After में लिखे सेकंड रुकें।')}</dd>
        </dl>
      </Card>
    </div>
  );
}
