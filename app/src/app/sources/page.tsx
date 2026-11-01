import Link from 'next/link';
import type { Metadata } from 'next';
import { getLanguage, getSession } from '@/lib/session';
import { homeFor } from '@/lib/nav';
import { pick } from '@/lib/i18n';
import { reconciliation, figures, pabCosts, realDataStatus } from '@/lib/sources';
import { AuthFrame } from '@/components/Brand';
import { Card, CardHead, Callout, fmtInr } from '@/components/ui';
import { Pill } from '@/components/labels';
import { Icon } from '@/components/Icon';
import { unitLabel } from '@/components/cost';

export const metadata: Metadata = { title: 'Sources and credits · Karyavahi' };
export const dynamic = 'force-dynamic';

/**
 * Every outside source the demo uses, what was taken from each, under what terms, and what is
 * still simulated. Public, so the credit is readable without signing in; linked from the demo
 * banner on every signed-in page and from the footer of the signed-out pages.
 */
export default async function SourcesPage() {
  const lang = await getLanguage();
  const session = await getSession();
  const f = figures();
  const recon = reconciliation();
  const costs = pabCosts();
  const st = realDataStatus();
  const L = (en: string, hi: string) => pick(lang, en, hi);
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`);

  const SOURCES = [
    {
      key: 'udise', name: L('UDISE+ school directory', 'यू-डाइस+ विद्यालय निर्देशिका'), by: L('Ministry of Education, via the India Data Portal (ISB)', 'शिक्षा मंत्रालय, इंडिया डेटा पोर्टल (ISB) के माध्यम से'),
      year: L('about 2020-21', 'लगभग 2020-21'), licence: 'ODC-BY 1.0', url: 'https://ckandev.indiadataportal.com/dataset/udise',
      used: L(`For ${st.realSchools.toLocaleString('en-IN')} government schools in Rampur, Lucknow and Varanasi: position (moved 300–700 m), management, category, rural or urban, enrolment by class, teachers and classrooms. School names, UDISE codes and villages are not used anywhere.`,
        `रामपुर, लखनऊ और वाराणसी के ${st.realSchools.toLocaleString('en-IN')} सरकारी विद्यालयों के लिए: स्थिति (300–700 मी. खिसकाई गई), प्रबंधन, श्रेणी, ग्रामीण या शहरी, कक्षावार नामांकन, शिक्षक और कक्षा-कक्ष। विद्यालयों के नाम, UDISE कोड और गाँव कहीं उपयोग नहीं किए गए।`),
    },
    {
      key: 'prs', name: L('PARAKH Rashtriya Sarvekshan 2024, district reports', 'परख राष्ट्रीय सर्वेक्षण 2024, ज़िला रिपोर्ट'), by: 'NCERT (PARAKH)',
      year: L('held December 2024; reports August 2025', 'दिसंबर 2024 में आयोजित; रिपोर्ट अगस्त 2025'), licence: L('Reuse allowed with accurate reproduction and credit; logos not used', 'सही पुनरुत्पादन और श्रेय के साथ पुनः उपयोग की अनुमति; लोगो उपयोग नहीं किए गए'),
      url: 'https://parakh.ncert.gov.in/',
      used: L('Class 3 (foundational stage) average performance in language and mathematics for each district, used to calibrate the simulated Class 3 results; the competency table is shown for reference.',
        'हर ज़िले के लिए कक्षा 3 (आधारभूत चरण) में भाषा और गणित का औसत प्रदर्शन, जिससे काल्पनिक कक्षा 3 परिणामों का अंशांकन किया गया; दक्षता तालिका संदर्भ हेतु दिखाई गई है।'),
    },
    {
      key: 'aser', name: L('ASER 2024: district estimates, Uttar Pradesh (rural)', 'असर 2024: ज़िला अनुमान, उत्तर प्रदेश (ग्रामीण)'), by: L('ASER Centre / Pratham', 'असर सेंटर / प्रथम'),
      year: '2024', licence: L('Credit ASER Centre', 'असर सेंटर को श्रेय'), url: 'https://asercentre.org/wp-content/uploads/2022/12/Uttar-Pradesh_District-Estimates.pdf',
      used: L('Shown as district context only: government-school enrolment, children out of school, and Std III–V reading and subtraction. Not used to change any figure.',
        'केवल ज़िला संदर्भ के रूप में: सरकारी विद्यालयों में नामांकन, विद्यालय से बाहर बच्चे, और कक्षा 3–5 में पठन व घटाव। किसी आँकड़े को बदलने में उपयोग नहीं।'),
    },
    {
      key: 'nfhs', name: L('National Family Health Survey, NFHS-5 district data', 'राष्ट्रीय परिवार स्वास्थ्य सर्वेक्षण, NFHS-5 ज़िला आँकड़े'), by: L('IIPS and the Ministry of Health and Family Welfare, via the India Data Portal', 'IIPS और स्वास्थ्य एवं परिवार कल्याण मंत्रालय, इंडिया डेटा पोर्टल के माध्यम से'),
      year: L('2019-21 (NFHS-4, 2015-16, alongside)', '2019-21 (साथ में NFHS-4, 2015-16)'), licence: L('Licence not stated by the portal; credited here', 'पोर्टल ने लाइसेंस नहीं बताया; यहाँ श्रेय दिया गया'),
      url: 'https://ckandev.indiadataportal.com/dataset/national-family-health-survey-nfhs',
      used: L('Four context indicators per district: women with 10+ years of schooling, women literate, children under 5 stunted, population with electricity.',
        'हर ज़िले के चार संदर्भ संकेतक: 10+ वर्ष स्कूली शिक्षा वाली महिलाएँ, साक्षर महिलाएँ, ठिगने 5 वर्ष से छोटे बच्चे, बिजली वाली आबादी।'),
    },
    {
      key: 'pab', name: L('Samagra Shiksha, Uttar Pradesh: PAB minutes 2025-26', 'समग्र शिक्षा, उत्तर प्रदेश: PAB कार्यवृत्त 2025-26'), by: L('Department of School Education & Literacy, Ministry of Education (Internet Archive copy)', 'स्कूल शिक्षा एवं साक्षरता विभाग, शिक्षा मंत्रालय (इंटरनेट आर्काइव प्रति)'),
      year: '2025-26', licence: L('Government publication; cited with page numbers', 'सरकारी प्रकाशन; पृष्ठ संख्या सहित उद्धृत'), url: f?.pab.url ?? '',
      used: L(`Unit costs for ${costs.length} intervention cards and for plan cost estimates (see below).`, `${costs.length} हस्तक्षेप कार्डों और योजना लागत अनुमानों के लिए इकाई लागत (नीचे देखें)।`),
    },
    {
      key: 'lgd', name: L('Local Government Directory codes', 'स्थानीय शासन निर्देशिका (LGD) कोड'), by: L('Ministry of Panchayati Raj, via the India Data Portal', 'पंचायती राज मंत्रालय, इंडिया डेटा पोर्टल के माध्यम से'),
      year: '2024', licence: 'ODC-BY 1.0', url: 'https://ckandev.indiadataportal.com/dataset/lgd-codes',
      used: L('District and block codes used to join the sources by code, not spelling (Rampur 176, Lucknow 162, Varanasi 187).', 'स्रोतों को वर्तनी नहीं, कोड से जोड़ने के लिए ज़िला व ब्लॉक कोड (रामपुर 176, लखनऊ 162, वाराणसी 187)।'),
    },
    {
      key: 'osm', name: L('OpenStreetMap boundaries', 'ओपनस्ट्रीटमैप सीमाएँ'), by: L('© OpenStreetMap contributors', '© ओपनस्ट्रीटमैप योगदानकर्ता'), year: '2026', licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright',
      used: L('The outline of Uttar Pradesh and its 75 districts on the hotspot map.', 'हॉटस्पॉट मानचित्र पर उत्तर प्रदेश और उसके 75 ज़िलों की रूपरेखा।'),
    },
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
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-5 sm:py-10">
        <header className="max-w-3xl">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{L('Sources and credits', 'स्रोत और श्रेय')}</h1>
          <p className="mt-2 text-base leading-relaxed text-ink-soft">
            {L('Karyavahi is a demo. Some of what it shows now comes from public data; the learning results do not. This page says which is which, where each figure came from, and how it was used.',
              'कार्यवाही एक डेमो है। इसमें दिखाई गई कुछ जानकारी अब सार्वजनिक आँकड़ों से आती है; अधिगम परिणाम नहीं। यह पृष्ठ बताता है कि क्या वास्तविक है, हर आँकड़ा कहाँ से आया और कैसे उपयोग हुआ।')}
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-3" aria-label={L('What is real', 'क्या वास्तविक है')}>
          <div className="rounded-2xl border border-good/30 bg-good-light p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-good"><Icon name="check-circle" size={14} />{L('Real', 'वास्तविक')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              <li>{L('Schools, their enrolment, teachers and locations (UDISE+ via India Data Portal, about 2020-21)', 'विद्यालय, उनका नामांकन, शिक्षक और स्थान (यू-डाइस+, इंडिया डेटा पोर्टल, लगभग 2020-21)')}</li>
              <li>{L('Intervention unit costs where a line exists (UP PAB 2025-26)', 'जहाँ पंक्ति है वहाँ हस्तक्षेप की इकाई लागत (उ.प्र. PAB 2025-26)')}</li>
              <li>{L('District context: ASER 2024, NFHS-5', 'ज़िला संदर्भ: असर 2024, NFHS-5')}</li>
              <li>{L('State and district boundaries (OpenStreetMap)', 'राज्य व ज़िला सीमाएँ (ओपनस्ट्रीटमैप)')}</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-pend/30 bg-pend-light p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-pend"><Icon name="activity" size={14} />{L('Simulated, calibrated', 'काल्पनिक, अंशांकित')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              <li>{L('Every school-level learning result. Class 3 results are shifted so each district’s average matches PRS 2024 (table below).', 'विद्यालय स्तर का हर अधिगम परिणाम। कक्षा 3 के परिणाम खिसकाए गए हैं ताकि हर ज़िले का औसत परख 2024 से मेल खाए (नीचे तालिका)।')}</li>
              <li>{L('Classes 1 and 2 have no published district figure and are not calibrated.', 'कक्षा 1 और 2 का कोई प्रकाशित ज़िला आँकड़ा नहीं है, इसलिए उनका अंशांकन नहीं हुआ।')}</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-warn/30 bg-warn-light p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-warn"><Icon name="info" size={14} />{L('Fictional', 'काल्पनिक')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              <li>{L('People, accounts, cases, plans, tasks, proof, visits, attendance, staff movements and complaints', 'लोग, खाते, प्रकरण, योजनाएँ, कार्य, सबूत, दौरे, उपस्थिति, स्टाफ़ आवागमन और शिकायतें')}</li>
              <li>{L('Block and cluster names and their lines on the map', 'ब्लॉक व संकुल के नाम और मानचित्र पर उनकी रेखाएँ')}</li>
              <li>{L('School names: each real school is shown as “School 0412 · Rampur Sadar”', 'विद्यालयों के नाम: हर वास्तविक विद्यालय “विद्यालय 0412 · रामपुर सदर” के रूप में दिखता है')}</li>
            </ul>
          </div>
        </section>

        <Callout tone="warn" title={L('Why real schools have no names here', 'यहाँ वास्तविक विद्यालयों के नाम क्यों नहीं हैं')}>
          {L('The learning results in this demo are simulated. Showing a real school’s name or UDISE code beside them could make a real school look as if it were failing. So names and codes are never stored in the app, pins are moved a few hundred metres, and each school is labelled by its demo number and demo block.',
            'इस डेमो के अधिगम परिणाम काल्पनिक हैं। उनके साथ किसी वास्तविक विद्यालय का नाम या UDISE कोड दिखाने से वह विद्यालय पिछड़ता हुआ लग सकता है। इसलिए नाम और कोड ऐप में कभी रखे नहीं जाते, पिन कुछ सौ मीटर खिसकाए जाते हैं, और हर विद्यालय अपनी डेमो संख्या और डेमो ब्लॉक से पहचाना जाता है।')}
        </Callout>

        <Card>
          <CardHead title={L('Sources', 'स्रोत')} hint={L('Every outside source, its year, its terms, and what was taken from it.', 'हर बाहरी स्रोत, उसका वर्ष, उसकी शर्तें, और उससे क्या लिया गया।')} />
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>{L('Source', 'स्रोत')}</th><th>{L('Year', 'वर्ष')}</th><th>{L('Licence or terms', 'लाइसेंस या शर्तें')}</th><th>{L('What the demo uses', 'डेमो क्या उपयोग करता है')}</th></tr></thead>
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s.key} id={`src-${s.key}`}>
                    <td className="align-top"><a href={s.url} className="link font-medium" target="_blank" rel="noreferrer noopener">{s.name}</a><span className="block text-xs text-ink-faint">{s.by}</span></td>
                    <td className="align-top text-sm">{s.year}</td>
                    <td className="align-top text-sm">{s.licence}</td>
                    <td className="align-top text-sm leading-snug text-ink-soft">{s.used}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHead
            title={L('Calibration: published Class 3 averages and the simulated ones', 'अंशांकन: प्रकाशित कक्षा 3 औसत और काल्पनिक औसत')}
            hint={f ? L(`PRS 2024 average performance (% correct), Class 3, against the demo’s Class 3 % at benchmark in the round nearest it (R0, Feb 2025), measured from the database now.`,
              `परख 2024 का औसत प्रदर्शन (% सही), कक्षा 3, बनाम डेमो का कक्षा 3 मानक-स्तर % उसके निकटतम दौर (R0, फ़र॰ 2025) में, अभी डेटाबेस से मापा गया।`) : undefined}
          />
          {recon.length ? (
            <div className="overflow-x-auto">
              <table className="table min-w-[680px]" id="reconciliation">
                <thead><tr>
                  <th>{L('District', 'ज़िला')}</th><th>{L('Subject', 'विषय')}</th>
                  <th className="text-right">{L('PRS 2024', 'परख 2024')}</th><th className="text-right">{L('Simulated before', 'पहले (काल्पनिक)')}</th>
                  <th className="text-right">{L('Offset (pp)', 'समायोजन (pp)')}</th><th className="text-right">{L('Simulated now', 'अब (काल्पनिक)')}</th><th className="text-right">{L('Gap (pp)', 'अंतर (pp)')}</th>
                </tr></thead>
                <tbody>
                  {recon.map((r) => (
                    <tr key={`${r.districtId}-${r.subject}`}>
                      <td>{r.district}</td>
                      <td>{r.subject === 'language' ? L('Language', 'भाषा') : L('Mathematics', 'गणित')}</td>
                      <td className="tnum text-right">{pct(r.published)} <span className="text-2xs text-ink-faint">{L('p.', 'पृ.')} {r.page}</span></td>
                      <td className="tnum text-right text-ink-soft">{pct(r.simulatedBefore)}</td>
                      <td className="tnum text-right text-ink-soft">{signed(r.offset)}</td>
                      <td className="tnum text-right font-medium">{pct(r.simulated)}</td>
                      <td className="tnum text-right">{r.diff !== null && Math.abs(r.diff) <= 1 ? <Pill tone="good">{signed(r.diff)}</Pill> : <Pill tone="warn">{signed(r.diff)}</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="card-pad text-sm text-ink-faint">{L('The real-data files are not present, so this copy runs on the fictional seed only.', 'वास्तविक-डेटा फ़ाइलें मौजूद नहीं हैं, इसलिए यह प्रति केवल काल्पनिक डेटा पर चल रही है।')}</p>}
          <div className="card-pad space-y-2 border-t border-line text-sm leading-relaxed text-ink-soft">
            <p>{L('How: one offset per district and subject, the same for every round (R0–R3), added to every Class 3 result and shared out within each cluster so no school goes below 0% or above 100%. Cluster and district changes between rounds, which drive detection, move by less than 1 point.',
              'कैसे: हर ज़िले और विषय के लिए एक समायोजन, हर दौर (R0–R3) के लिए समान, हर कक्षा 3 परिणाम में जोड़ा गया और हर संकुल के भीतर बाँटा गया ताकि कोई विद्यालय 0% से नीचे या 100% से ऊपर न जाए। दौरों के बीच संकुल और ज़िले के बदलाव, जिनसे पहचान होती है, 1 अंक से कम बदले।')}</p>
            <p>{L(`Caveats: PRS reports the average share of questions answered correctly; the demo measures the share of children at the grade benchmark. They are not the same measure, and matching one to the other is a simplification. Raising the level also changes the z-test, so ${st.findingsGateMoved} of ${st.findingsChecked} Class 3 findings would pass or fail the noise test differently if measured today, and ${st.outcomesCategoryMoved} of ${st.outcomesChecked} Class 3 outcome checks would read differently. The ledger keeps what was decided; the finding and outcome pages say where this applies.`,
              `सावधानियाँ: परख सही उत्तरों का औसत हिस्सा बताता है; डेमो मानक स्तर पर बच्चों का हिस्सा मापता है। ये एक ही माप नहीं हैं, और एक को दूसरे से मिलाना सरलीकरण है। स्तर बढ़ाने से z-परीक्षण भी बदलता है, इसलिए कक्षा 3 के ${st.findingsChecked} में से ${st.findingsGateMoved} निष्कर्ष आज मापने पर शोर-परीक्षण में अलग परिणाम देते, और ${st.outcomesChecked} में से ${st.outcomesCategoryMoved} परिणाम-जाँचें अलग पढ़ी जातीं। पंजी वही रखती है जो तय हुआ था; निष्कर्ष और परिणाम पृष्ठ बताते हैं कि यह कहाँ लागू है।`)}</p>
          </div>
        </Card>

        {f ? (
          <Card>
            <CardHead title={L('PRS 2024, Class 3 by competency', 'परख 2024, कक्षा 3 दक्षतावार')} hint={L('District, with Uttar Pradesh in brackets. PDF page 18 of each district report. For reference; not used to calibrate.', 'ज़िला, कोष्ठक में उत्तर प्रदेश। हर ज़िला रिपोर्ट का PDF पृष्ठ 18। संदर्भ हेतु; अंशांकन में उपयोग नहीं।')} />
            <div className="overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead><tr><th>{L('Competency', 'दक्षता')}</th>{Object.values(f.districts).map((d) => <th key={d.name} className="text-right">{d.name}</th>)}</tr></thead>
                <tbody>
                  {(['language', 'mathematics'] as const).flatMap((subj) => Object.values(f.districts)[0].prs.competencies[subj].map((c, i) => (
                    <tr key={`${subj}-${c.code}`}>
                      <td className="text-sm"><span className="font-mono text-2xs text-ink-faint">{c.code}</span> {pick(lang, c.en, c.hi)}</td>
                      {Object.values(f.districts).map((d) => <td key={d.name} className="tnum text-right text-sm">{d.prs.competencies[subj][i].district}% <span className="text-2xs text-ink-faint">({c.state})</span></td>)}
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHead title={L('Costs from the UP PAB minutes 2025-26', 'उ.प्र. PAB कार्यवृत्त 2025-26 से लागत')}
            hint={L('Where an intervention card maps to a PAB line, its cost is that unit cost, with the page. “Nearest line” means the rate is borrowed from a line for other classes or a longer activity, and the card says so. Every other card keeps an illustrative cost.',
              'जहाँ हस्तक्षेप कार्ड किसी PAB पंक्ति से मेल खाता है, उसकी लागत वही इकाई लागत है, पृष्ठ सहित। “निकटतम पंक्ति” का अर्थ है दर किसी अन्य कक्षा या लंबी गतिविधि की पंक्ति से ली गई है, और कार्ड यह बताता है। अन्य सभी कार्डों की लागत उदाहरणार्थ है।')} />
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>{L('Card', 'कार्ड')}</th><th className="text-right">{L('Unit cost', 'इकाई लागत')}</th><th>{L('PAB line', 'PAB पंक्ति')}</th><th>{L('Page', 'पृष्ठ')}</th></tr></thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id}>
                    <td className="align-top"><Link href={`/interventions/${c.id}`} className="link text-sm font-medium">{c.name}</Link><span className="mt-0.5 block">{c.basis === 'pab' ? <Pill tone="good">{L('PAB line', 'PAB पंक्ति')}</Pill> : <Pill tone="active">{L('Nearest line', 'निकटतम पंक्ति')}</Pill>}</span></td>
                    <td className="tnum align-top text-right text-sm">{fmtInr(c.amount)} <span className="block text-2xs text-ink-faint">{unitLabel(c.unit, lang)}{c.composite ? ` · ${L('composite', 'कंपोज़िट')} ${fmtInr(c.composite)}` : ''}</span></td>
                    <td className="align-top text-sm leading-snug text-ink-soft">{pick(lang, c.lineEn, c.lineHi)}<span className="mt-0.5 block text-xs text-ink-faint">{pick(lang, c.noteEn, c.noteHi)}</span></td>
                    <td className="align-top text-sm"><a className="link" href={`${f?.pab.url}#page=${c.page}`} target="_blank" rel="noreferrer noopener">{L('PDF p.', 'PDF पृ.')} {c.page}</a><span className="block text-2xs text-ink-faint">{L('printed', 'मुद्रित')} {c.printed}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-pad border-t border-line text-xs leading-relaxed text-ink-faint">
            {L('A plan’s cost estimate multiplies the unit cost by its schools’ UDISE+ enrolment in the case’s class (per child), their teachers in position (per teacher) or the schools themselves (per school). Plans drafted before the costs were added keep their original illustrative estimate. Note: the brief listed remedial teaching as Classes 1–8; the minutes sanction it for Classes 6–8 only (PDF p. 44), which is why those cards borrow it as the nearest line.',
              'योजना का लागत अनुमान इकाई लागत को उसके विद्यालयों के प्रकरण की कक्षा के यू-डाइस+ नामांकन (प्रति बच्चा), कार्यरत शिक्षकों (प्रति शिक्षक) या स्वयं विद्यालयों (प्रति विद्यालय) से गुणा करता है। लागत जोड़े जाने से पहले बनी योजनाएँ अपना मूल उदाहरणार्थ अनुमान रखती हैं। ध्यान दें: उपचारात्मक शिक्षण कार्यवृत्त में केवल कक्षा 6–8 के लिए स्वीकृत है (PDF पृ. 44), इसलिए वे कार्ड उसे निकटतम पंक्ति के रूप में लेते हैं।')}
          </p>
        </Card>

        {f ? (
          <Card>
            <CardHead title={L('District context', 'ज़िला संदर्भ')} hint={L('Context, not cause. Shown beside each district on the hotspot and district pages; not used to change any figure.', 'संदर्भ, कारण नहीं। हॉटस्पॉट और ज़िला पृष्ठों पर हर ज़िले के साथ दिखाया गया; किसी आँकड़े को बदलने में उपयोग नहीं।')} />
            <div className="overflow-x-auto">
              <table className="table min-w-[680px]">
                <thead><tr><th>{L('Indicator', 'संकेतक')}</th>{Object.values(f.districts).map((d) => <th key={d.name} className="text-right">{d.name}</th>)}<th className="text-right">{L('Uttar Pradesh', 'उत्तर प्रदेश')}</th></tr></thead>
                <tbody>
                  {([
                    ['std3_5_read_std2', L('ASER: Std III–V who can read a Std II text', 'असर: कक्षा 3–5 के बच्चे जो कक्षा 2 का पाठ पढ़ सकते हैं')],
                    ['std3_5_subtraction', L('ASER: Std III–V who can do at least subtraction', 'असर: कक्षा 3–5 के बच्चे जो कम से कम घटाव कर सकते हैं')],
                    ['govt_school_enrolment_6_14', L('ASER: children 6–14 in government schools', 'असर: सरकारी विद्यालयों में 6–14 वर्ष के बच्चे')],
                    ['not_in_school_6_14', L('ASER: children 6–14 not in school', 'असर: विद्यालय से बाहर 6–14 वर्ष के बच्चे')],
                  ] as const).map(([k, label]) => (
                    <tr key={k}><td className="text-sm">{label}</td>{Object.values(f.districts).map((d) => <td key={d.name} className="tnum text-right text-sm">{d.aser[k].toFixed(1)}%</td>)}<td className="tnum text-right text-sm text-ink-soft">{f.state.aser[k]?.toFixed(1)}%</td></tr>
                  ))}
                  {Object.keys(Object.values(f.districts)[0].nfhs).map((k) => (
                    <tr key={k}><td className="text-sm">NFHS-5: {pick(lang, Object.values(f.districts)[0].nfhs[k].en, Object.values(f.districts)[0].nfhs[k].hi)}</td>{Object.values(f.districts).map((d) => <td key={d.name} className="tnum text-right text-sm">{d.nfhs[k].nfhs5 === null ? '—' : `${d.nfhs[k].nfhs5.toFixed(1)}%`}</td>)}<td className="text-right text-ink-faint">—</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="card-pad border-t border-line text-xs leading-relaxed text-ink-faint">{L('ASER 2024 is a household survey of rural children (government and private schools), page 2 of the Uttar Pradesh district estimates. NFHS-5 was collected in 2019-21.', 'असर 2024 ग्रामीण बच्चों (सरकारी व निजी विद्यालय) का घरेलू सर्वेक्षण है, उत्तर प्रदेश ज़िला अनुमानों का पृष्ठ 2। NFHS-5 के आँकड़े 2019-21 में एकत्र हुए।')}</p>
          </Card>
        ) : null}

        <Card>
          <CardHead title={L('How the real schools were chosen', 'वास्तविक विद्यालय कैसे चुने गए')} />
          <div className="card-pad space-y-2 text-sm leading-relaxed text-ink-soft">
            <p>{L('The demo keeps its own school ids, blocks, clusters, people and cases, so the whole case ledger still holds together. Each demo school was matched to a real government school in the same district that teaches Classes 1–5: the largest such schools by Class 1–3 enrolment, grouped by position into the demo’s blocks (the first block takes the district town) and clusters, and matched on school type and Class 1–3 enrolment. The demo’s block and cluster names are fictional and match no LGD block, so blocks were rebuilt from positions instead of joined by name.',
              'डेमो अपनी विद्यालय आईडी, ब्लॉक, संकुल, लोग और प्रकरण बनाए रखता है, ताकि पूरी प्रकरण पंजी जुड़ी रहे। हर डेमो विद्यालय को उसी ज़िले के कक्षा 1–5 वाले एक वास्तविक सरकारी विद्यालय से मिलाया गया: कक्षा 1–3 नामांकन में सबसे बड़े विद्यालय, स्थिति के आधार पर डेमो के ब्लॉकों (पहला ब्लॉक ज़िला मुख्यालय लेता है) और संकुलों में समूहित, और विद्यालय प्रकार व कक्षा 1–3 नामांकन पर मिलाए गए। डेमो के ब्लॉक व संकुल नाम काल्पनिक हैं और किसी LGD ब्लॉक से मेल नहीं खाते, इसलिए ब्लॉक नाम से नहीं, स्थिति से दोबारा बनाए गए।')}</p>
            {f ? <p>{Object.values(f.districts).map((d) => L(`${d.name}: ${d.udise.udise_rows.toLocaleString('en-IN')} UDISE+ schools, ${d.udise.government_class_1_5.toLocaleString('en-IN')} eligible government Class 1–5 schools with a usable position, ${d.udise.used} used.`, `${d.name}: ${d.udise.udise_rows.toLocaleString('en-IN')} यू-डाइस+ विद्यालय, उपयोग योग्य स्थिति वाले ${d.udise.government_class_1_5.toLocaleString('en-IN')} पात्र सरकारी कक्षा 1–5 विद्यालय, ${d.udise.used} उपयोग किए।`)).join(' ')}</p> : null}
            <p>{L('Assessment rows keep their own enrolled and assessed counts for 2025–26 (simulated); the school profile shows UDISE+ enrolment from about 2020-21, so the two can differ. Sanctioned teacher posts are not in UDISE+; the demo estimates them from enrolment with the RTE Act’s schedule.',
              'आकलन पंक्तियाँ 2025–26 के लिए अपनी नामांकित और आकलित संख्याएँ (काल्पनिक) रखती हैं; विद्यालय प्रोफ़ाइल लगभग 2020-21 का यू-डाइस+ नामांकन दिखाती है, इसलिए दोनों भिन्न हो सकते हैं। स्वीकृत शिक्षक पद यू-डाइस+ में नहीं हैं; डेमो उन्हें RTE अधिनियम की अनुसूची के अनुसार नामांकन से अनुमानित करता है।')}</p>
          </div>
        </Card>
      </div>
    </AuthFrame>
  );
}
