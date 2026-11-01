import Link from 'next/link';
import type { Metadata } from 'next';
import { getLanguage, getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { pick } from '@/lib/i18n';
import { AuthFrame } from '@/components/Brand';
import { Pill } from '@/components/labels';
import { Icon } from '@/components/Icon';

export const metadata: Metadata = { title: 'Roadmap · Karyavahi' };
export const dynamic = 'force-dynamic';

/**
 * Where Karyavahi goes from the demo: the pilot, the systems it plugs into, the technical path,
 * what it costs to run, the risks, and how the pilot is judged. Public, like /sources, and kept
 * honest: every row says whether it is built, designed, or waiting on someone outside the team.
 * The same plan, in English, is docs/ROADMAP.md at the repository root.
 */

type Status = 'built' | 'designed' | 'needs';

export default async function RoadmapPage() {
  const lang = await getLanguage();
  const session = await getSession();
  const L = (en: string, hi: string) => pick(lang, en, hi);

  const STATUS: Record<Status, { label: string; tone: 'good' | 'active' | 'warn' }> = {
    built: { label: L('Built', 'बना हुआ'), tone: 'good' },
    designed: { label: L('Designed', 'रूपरेखा तैयार'), tone: 'active' },
    needs: { label: L('Needs a partner or account', 'साझेदार या खाते की ज़रूरत'), tone: 'warn' },
  };

  const PHASES = [
    {
      when: L('Now · Nov 2026', 'अभी · नवंबर 2026'), title: L('Demo', 'डेमो'), icon: 'play',
      points: [
        L('The full case loop works end to end: flag → diagnose → recommend → approve → assign → track → verify → report.', 'पूरा प्रकरण-चक्र चलता है: पहचान → निदान → सुझाव → स्वीकृति → आवंटन → निगरानी → सत्यापन → रिपोर्ट।'),
        L('Three Uttar Pradesh districts with real UDISE+ schools (names withheld); learning results simulated and calibrated to PRS 2024.', 'उत्तर प्रदेश के तीन ज़िले, असली यू-डाइस+ विद्यालय (नाम छिपे); अधिगम परिणाम काल्पनिक, PRS 2024 से मिलाए गए।'),
        L('Claude drafts and explains, code computes every figure, a person decides.', 'Claude मसौदा बनाता और समझाता है, हर आँकड़ा कोड निकालता है, निर्णय व्यक्ति लेता है।'),
      ],
    },
    {
      when: L('Months 1–3', 'माह 1–3'), title: L('Pilot in one district', 'एक ज़िले में पायलट'), icon: 'target',
      points: [
        L('An agreement (MoU) with the state for one district: about 1 district officer, 6–8 block officers, ~100 cluster and block coordinators, ~1,500 headmasters.', 'एक ज़िले के लिए राज्य से समझौता (MoU): लगभग 1 ज़िला अधिकारी, 6–8 खंड अधिकारी, ~100 संकुल व खंड समन्वयक, ~1,500 प्रधानाध्यापक।'),
        L('Real feeds: the official UDISE+ 2024-25 school data and the state\'s own assessment exports, loaded through the import wizard already built.', 'असली डेटा: आधिकारिक यू-डाइस+ 2024-25 और राज्य के अपने आकलन, पहले से बने आयात से।'),
        L('Field channels switched on: WhatsApp (Glific / Meta Cloud API) and a Hindi voice call (Exotel) — the message and voice scripts are already written.', 'फ़ील्ड चैनल चालू: व्हाट्सऐप (Glific / Meta) और हिंदी वॉइस कॉल (Exotel) — संदेश और वॉइस स्क्रिप्ट पहले से लिखी हैं।'),
        L('User testing every two weeks with the kit in the app; changes published on the "What we changed" page.', 'हर दो सप्ताह उपयोगकर्ता परीक्षण; बदलाव "हमने क्या बदला" पृष्ठ पर।'),
      ],
    },
    {
      when: L('Months 4–9', 'माह 4–9'), title: L('Prove it works', 'असर साबित करें'), icon: 'check-circle',
      points: [
        L('Two assessment rounds pass, so pre-registered outcome checks run on real plans: did treated schools gain more than comparison schools?', 'दो आकलन दौर पूरे, तो असली योजनाओं पर पहले से तय परिणाम-जाँच: क्या योजना वाले विद्यालय तुलना वाले विद्यालयों से अधिक सुधरे?'),
        L('An independent evaluation partner reviews the ledger and the outcome method.', 'एक स्वतंत्र मूल्यांकन साझेदार खाता-बही और परिणाम-पद्धति की समीक्षा करे।'),
        L('The evidence library learns from the district\'s own closed cases.', 'साक्ष्य-पुस्तकालय ज़िले के अपने बंद प्रकरणों से सीखे।'),
      ],
    },
    {
      when: L('Months 10–24', 'माह 10–24'), title: L('Scale', 'विस्तार'), icon: 'layers',
      points: [
        L('State-wide in Uttar Pradesh (75 districts), feeding the state\'s VSK dashboard through the API already built.', 'पूरे उत्तर प्रदेश (75 ज़िले) में, पहले से बने API से राज्य के VSK डैशबोर्ड को डेटा।'),
        L('Other states through the same CSV shapes (cQube) and the same case ledger; distribution with existing FLN partners.', 'उन्हीं CSV ढाँचों (cQube) और उसी खाता-बही से अन्य राज्य; मौजूदा FLN साझेदारों के साथ।'),
        L('PAB-level findings packaged each year as dated proposals, so "no action" becomes "proposed for next year".', 'PAB-स्तर के निष्कर्ष हर वर्ष दिनांकित प्रस्ताव बनें, ताकि "कोई कार्रवाई नहीं" की जगह "अगले वर्ष हेतु प्रस्तावित" हो।'),
      ],
    },
  ];

  const SYSTEMS: { system: string; how: string; status: Status }[] = [
    { system: 'UDISE+', how: L('School master importer (built for the India Data Portal mirror); official 2024-25 microdata needs the state\'s login.', 'विद्यालय-सूची आयातक (India Data Portal से बना); आधिकारिक 2024-25 डेटा हेतु राज्य का लॉगिन।'), status: 'built' },
    { system: L('State assessments (NIPUN, PRS-style rounds)', 'राज्य आकलन (NIPUN, PRS जैसे दौर)'), how: L('Round import with row-level checks, then a live detection run.', 'पंक्ति-स्तरीय जाँच के साथ दौर-आयात, फिर तुरंत पहचान।'), status: 'built' },
    { system: L('State VSK dashboards', 'राज्य VSK डैशबोर्ड'), how: L('Read-only API v1 with area-scoped keys, rate limits and an OpenAPI description.', 'क्षेत्र-सीमित कुंजियों, दर-सीमा और OpenAPI विवरण के साथ केवल-पढ़ने वाला API v1।'), status: 'built' },
    { system: 'PAB / PRABANDH', how: L('Lever tag on every case (block / district / PAB); PAB 2025-26 unit costs on intervention cards. A yearly PAB proposal export is designed.', 'हर प्रकरण पर अधिकार-स्तर (खंड / ज़िला / PAB); हस्तक्षेप कार्डों पर PAB 2025-26 इकाई लागत। वार्षिक PAB प्रस्ताव निर्यात की रूपरेखा तैयार।'), status: 'built' },
    { system: 'cQube', how: L('Adopt its CSV shapes for imports so states that run cQube need no new formats.', 'आयात के लिए उसके CSV ढाँचे अपनाना, ताकि cQube वाले राज्यों को नया प्रारूप न चाहिए।'), status: 'designed' },
    { system: 'ShikshaLokam ELEVATE', how: L('Reuse its project service for task delivery where a state already uses it.', 'जहाँ राज्य पहले से उपयोग करता है, कार्य-वितरण हेतु उसकी परियोजना सेवा का पुनः उपयोग।'), status: 'needs' },
    { system: L('WhatsApp (Glific / Meta Cloud API)', 'व्हाट्सऐप (Glific / Meta Cloud API)'), how: L('Tasks out, photo proof back. Messages are written and queued in the outbox; needs Meta business verification and template approval.', 'काम भेजना, फ़ोटो-सबूत लेना। संदेश लिखे और आउटबॉक्स में; Meta सत्यापन और टेम्पलेट स्वीकृति चाहिए।'), status: 'needs' },
    { system: L('Voice call and SMS (Exotel)', 'वॉइस कॉल और SMS (Exotel)'), how: L('Hindi voice scripts with keypad replies are written; needs an Exotel account and TRAI DLT registration.', 'कीपैड उत्तर वाली हिंदी वॉइस स्क्रिप्ट लिखी हैं; Exotel खाता और TRAI DLT पंजीकरण चाहिए।'), status: 'needs' },
  ];

  const TECH = [
    { title: L('Database', 'डेटाबेस'), body: L('SQLite today; Postgres with row-level security for the pilot. The tables already follow the Postgres schema, and every read is scoped the same way the policies would be.', 'आज SQLite; पायलट हेतु पंक्ति-स्तरीय सुरक्षा वाला Postgres। तालिकाएँ पहले से Postgres ढाँचे पर हैं।') },
    { title: L('Claude', 'Claude'), body: L('Claude Opus 5.5 with structured outputs, tool use over scoped reads, a refusal fallback and an auditor pass on every figure. An evaluation set of real pilot cases is added before go-live.', 'संरचित आउटपुट, सीमित पठन वाले टूल, अस्वीकृति-विकल्प और हर आँकड़े की जाँच के साथ Claude Opus 5.5। लाइव से पहले पायलट प्रकरणों का मूल्यांकन-सेट।') },
    { title: L('Search', 'खोज'), body: L('Ranked full-text search over the evidence library today; vector search (pgvector) once the library and the closed-case history grow past a few hundred entries.', 'आज साक्ष्य-पुस्तकालय पर क्रमबद्ध पाठ-खोज; पुस्तकालय बढ़ने पर वेक्टर खोज (pgvector)।') },
    { title: L('Field app', 'फ़ील्ड ऐप'), body: L('An installable web app that works offline with GPS-checked proof; a native Android app only if the pilot shows the web app is not enough.', 'ऑफ़लाइन चलने वाला, GPS-जाँचे सबूत वाला इंस्टॉल-योग्य वेब ऐप; नेटिव Android ऐप तभी जब पायलट में ज़रूरत दिखे।') },
    { title: L('Hosting', 'होस्टिंग'), body: L('A state data centre or an empanelled government cloud, so data stays in India; no student-level records by design (DPDP Act 2023).', 'राज्य डेटा केंद्र या सूचीबद्ध सरकारी क्लाउड, ताकि डेटा भारत में रहे; डिज़ाइन से कोई छात्र-स्तरीय रिकॉर्ड नहीं (DPDP अधिनियम 2023)।') },
  ];

  const RISKS = [
    { risk: L('No access to school-level results', 'विद्यालय-स्तरीय परिणाम तक पहुँच नहीं'), plan: L('Pilot only under a state MoU; until then the app runs on real schools with simulated results, and says so on every page.', 'केवल राज्य MoU के अंतर्गत पायलट; तब तक असली विद्यालयों पर काल्पनिक परिणाम, हर पृष्ठ पर स्पष्ट।') },
    { risk: L('WhatsApp template and DLT approvals are slow', 'व्हाट्सऐप टेम्पलेट और DLT स्वीकृति धीमी'), plan: L('Start the paperwork in month 1; the web app and offline My day work without them.', 'कागज़ी काम माह 1 में शुरू; वेब ऐप और ऑफ़लाइन "मेरा दिन" इनके बिना चलते हैं।') },
    { risk: L('Gaming: dropping weak schools from the next round', 'हेरफेर: अगले दौर से कमज़ोर विद्यालय हटाना'), plan: L('A participation floor in every outcome check, comparison schools locked at approval, and closure only on independent proof.', 'हर परिणाम-जाँच में भागीदारी-सीमा, स्वीकृति पर तुलना-विद्यालय तय, और केवल स्वतंत्र सबूत पर समापन।') },
    { risk: L('Field staff see it as surveillance', 'फ़ील्ड कर्मी इसे निगरानी मानें'), plan: L('No teacher app, no student records, location only at the moment proof is handed in, each person on the channel they already use.', 'कोई शिक्षक-ऐप नहीं, कोई छात्र रिकॉर्ड नहीं, स्थान केवल सबूत देते समय, हर व्यक्ति अपने परिचित चैनल पर।') },
    { risk: L('The AI states something wrong', 'AI कुछ गलत कह दे'), plan: L('Claude never computes figures; the auditor checks every number it writes; it cannot approve, assign or close; every draft says who wrote it.', 'Claude आँकड़े नहीं निकालता; हर संख्या की जाँच होती है; वह स्वीकृत, आवंटित या बंद नहीं कर सकता; हर मसौदे पर लेखक स्पष्ट।') },
  ];

  const METRICS = [
    L('Flagged cases with an approved plan within 14 days', '14 दिनों में स्वीकृत योजना वाले चिह्नित प्रकरण'),
    L('Tasks closed with proof checked by someone other than the doer', 'करने वाले के अलावा किसी और द्वारा जाँचे सबूत के साथ बंद काम'),
    L('Cases with an outcome check at the next assessment round', 'अगले आकलन दौर पर परिणाम-जाँच वाले प्रकरण'),
    L('Learning gain in plan schools over comparison schools (the pre-registered test)', 'तुलना-विद्यालयों की तुलना में योजना-विद्यालयों में अधिगम सुधार (पहले से तय परीक्षण)'),
    L('Hours to prepare the monthly review pack and Action Taken Report', 'मासिक समीक्षा-पैक और कार्रवाई रिपोर्ट तैयार करने में लगे घंटे'),
    L('Officers and field staff active each week, and their feedback ratings', 'हर सप्ताह सक्रिय अधिकारी और फ़ील्ड कर्मी, और उनकी प्रतिक्रिया-रेटिंग'),
  ];

  return (
    <AuthFrame
      right={
        <>
          <form action="/api/language" method="post">
            <input type="hidden" name="to" value={lang === 'hi' ? 'en' : 'hi'} />
            <button type="submit" className="btn-ghost">{lang === 'hi' ? 'English' : 'हिंदी'}</button>
          </form>
          {session ? <Link href={homeFor(session)} className="btn-navy">{L('Back to the app', 'ऐप पर लौटें')}</Link> : <Link href="/demo" className="btn-navy">{L('Explore demo', 'डेमो देखें')}</Link>}
        </>
      }
    >
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-5 sm:py-10">
        <header className="max-w-3xl">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{L('Roadmap', 'आगे की राह')}</h1>
          <p className="mt-2 text-md leading-relaxed text-ink-soft">
            {L('From a working demo to a district pilot, then the state. Each row says plainly whether it is built, designed, or waiting on a partner.',
              'चलते डेमो से ज़िला पायलट, फिर पूरा राज्य। हर पंक्ति साफ़ बताती है कि वह बना है, रूपरेखा में है, या किसी साझेदार की प्रतीक्षा में।')}
          </p>
        </header>

        <section aria-labelledby="path-title">
          <h2 id="path-title" className="mb-3 text-lg font-semibold text-ink">{L('The path', 'राह')}</h2>
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PHASES.map((p, i) => (
              <li key={i} className={`flex flex-col rounded-2xl border bg-white p-4 ${i === 0 ? 'border-brand/40 ring-1 ring-brand/20' : 'border-line'}`}>
                <div className="flex items-center gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${i === 0 ? 'bg-brand text-white' : 'bg-paper-sunk text-ink-soft'}`}><Icon name={p.icon} size={16} /></span>
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{p.when}</p>
                    <h3 className="text-base font-semibold text-ink">{p.title}</h3>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {p.points.map((x, j) => <li key={j} className="flex gap-2 text-sm leading-snug text-ink-soft"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />{x}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="sys-title" className="rounded-2xl border border-line bg-white">
          <header className="border-b border-line px-5 py-3">
            <h2 id="sys-title" className="text-lg font-semibold text-ink">{L('How it plugs into existing systems', 'मौजूदा प्रणालियों से जुड़ाव')}</h2>
            <p className="text-sm text-ink-faint">{L('Downstream of every dashboard and capture app: it takes their data in and owns the loop after the alert.', 'हर डैशबोर्ड और डेटा-ऐप के बाद: उनका डेटा लेता है और चेतावनी के बाद का पूरा चक्र सँभालता है।')}</p>
          </header>
          <ul className="divide-y divide-line">
            {SYSTEMS.map((s) => (
              <li key={s.system} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-56 shrink-0 text-sm font-semibold text-ink">{s.system}</span>
                <span className="flex-1 text-sm text-ink-soft">{s.how}</span>
                <span className="shrink-0"><Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill></span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="tech-title">
          <h2 id="tech-title" className="mb-3 text-lg font-semibold text-ink">{L('Technical path', 'तकनीकी राह')}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {TECH.map((t) => (
              <div key={t.title} className="rounded-2xl border border-line bg-white p-4">
                <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t.body}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-semibold text-ink">{L('Running cost of Claude', 'Claude की चलाने की लागत')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                {L('A draft reads about 5,000 tokens and writes about 2,000. At Claude Opus 5.5 list prices ($4 in / $20 out per million tokens) that is about $0.06 — roughly ₹5 — per draft; an officer asking for 40 drafts a month costs about ₹200. Drafts are cached, so reopening a page costs nothing.',
                  'एक मसौदा लगभग 5,000 टोकन पढ़ता और 2,000 लिखता है। Claude Opus 5.5 की सूची-दर ($4 / $20 प्रति दस लाख टोकन) पर यह लगभग $0.06 — करीब ₹5 — प्रति मसौदा; महीने में 40 मसौदे माँगने वाले अधिकारी पर लगभग ₹200। मसौदे सहेजे जाते हैं, दोबारा खोलने पर कोई लागत नहीं।')}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="risk-title" className="rounded-2xl border border-line bg-white">
          <header className="border-b border-line px-5 py-3"><h2 id="risk-title" className="text-lg font-semibold text-ink">{L('Risks, and what we do about them', 'जोखिम, और उनका उपाय')}</h2></header>
          <ul className="divide-y divide-line">
            {RISKS.map((r) => (
              <li key={r.risk} className="grid gap-1 px-5 py-3 sm:grid-cols-[16rem_1fr] sm:gap-4">
                <span className="text-sm font-semibold text-ink">{r.risk}</span>
                <span className="text-sm text-ink-soft">{r.plan}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="metric-title" className="rounded-2xl border border-brand/25 bg-brand-light/40 p-5">
          <h2 id="metric-title" className="text-lg font-semibold text-ink">{L('How the pilot is judged', 'पायलट का मूल्यांकन कैसे होगा')}</h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {METRICS.map((m) => <li key={m} className="flex gap-2 text-sm text-ink"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand" />{m}</li>)}
          </ul>
        </section>

        <p className="text-xs text-ink-faint">
          {L('See also', 'यह भी देखें')}: <Link href="/sources" className="link">{L('Sources and credits', 'स्रोत और श्रेय')}</Link>
        </p>
      </div>
    </AuthFrame>
  );
}
