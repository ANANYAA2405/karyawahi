import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { count } from '@/lib/db';
import { countAudit, listImports, listJobs } from '@/lib/feed';
import { aiStatus } from '@/lib/ai/config';
import { can } from '@/lib/authz';
import { verificationQueue } from '@/lib/onboarding';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, fmtInt, fmtDate } from '@/components/ui';
import { Icon } from '@/components/Icon';

/**
 * Administration hub. Each tile is shown only if the signed-in role holds the grant behind it,
 * and each destination checks that grant again on the server.
 */

export default async function AdminHub() {
  const session = await pageSession();
  const lang = await getLanguage();

  const tiles: { href: string; icon: string; title: string; body: string; stat?: string }[] = [];
  if (may(session, 'audit.view')) {
    tiles.push({
      href: '/audit', icon: 'lock', title: pick(lang, 'Audit & governance', 'अंकेक्षण'),
      body: pick(lang, 'The append-only, SHA-256 hash-chained record of every decision and every refused attempt.', 'हर निर्णय और अस्वीकृत प्रयास का श्रृंखलाबद्ध रिकॉर्ड।'),
      stat: `${fmtInt(countAudit(session))} ${pick(lang, 'events in scope', 'घटनाएँ')}`,
    });
  }
  if (may(session, 'data.import')) {
    const last = listImports(session, { limit: 1 })[0];
    tiles.push({
      href: '/import', icon: 'upload', title: pick(lang, 'Data imports', 'डेटा आयात'),
      body: pick(lang, 'Import batches, validation results and every rejected row with its reason.', 'आयात बैच, सत्यापन और अस्वीकृत पंक्तियाँ।'),
      stat: last ? `${pick(lang, 'Last batch', 'अंतिम बैच')} ${fmtDate(last.uploaded_at)}` : undefined,
    });
  }
  if (may(session, 'audit.view')) {
    tiles.push({
      href: '/ai-log', icon: 'sparkles', title: pick(lang, 'AI activity', 'AI गतिविधि'),
      body: pick(lang, 'Every AI draft and conversation: model, tools called, records cited, outcome.', 'हर AI मसौदा और बातचीत: मॉडल, उपकरण, उद्धृत रिकॉर्ड।'),
      stat: `${fmtInt(count('select count(*) c from ai_interactions'))} ${pick(lang, 'interactions', 'बातचीत')}`,
    });
  }
  if (may(session, 'audit.view') || may(session, 'users.manage')) {
    tiles.push({
      href: '/admin/access', icon: 'users', title: pick(lang, 'Roles, permissions & scope', 'भूमिकाएँ व अनुमतियाँ'),
      body: pick(lang, 'Who can do what, at which level. The same matrix the server enforces.', 'कौन क्या कर सकता है — वही तालिका जो सर्वर लागू करता है।'),
      stat: `${fmtInt(count('select count(*) c from users where status = \'active\''))} ${pick(lang, 'active accounts', 'सक्रिय खाते')}`,
    });
  }
  if (can(session, 'approve_accounts') || can(session, 'manage_users')) {
    tiles.push({
      href: '/admin/accounts', icon: 'users', title: pick(lang, 'Accounts & approvals', 'खाते व स्वीकृति'),
      body: pick(lang, 'Registration and change requests routed to you; suspend or reactivate accounts junior to yours.', 'आपको भेजे गए पंजीकरण अनुरोध; खाते निलंबित या सक्रिय करें।'),
      stat: `${verificationQueue(session).filter((r) => r.status === 'approval_pending').length} ${pick(lang, 'awaiting approval', 'स्वीकृति प्रतीक्षित')}`,
    });
  }
  if (can(session, 'manage_hierarchy') || may(session, 'audit.view')) {
    tiles.push({
      href: '/admin/hierarchy', icon: 'layers', title: pick(lang, 'Organisation & reporting lines', 'संगठन'),
      body: pick(lang, 'Who reports to whom, designated authorities and acting arrangements.', 'कौन किसे रिपोर्ट करता है, कार्यवाहक व्यवस्था।'),
    });
  }
  if (can(session, 'manage_geography') || may(session, 'audit.view')) {
    tiles.push({
      href: '/admin/geography', icon: 'map', title: pick(lang, 'Geography', 'भूगोल'),
      body: pick(lang, 'Hierarchies, levels, geometry provenance and city membership.', 'पदानुक्रम, स्तर और नगर सदस्यता।'),
    });
  }
  if (may(session, 'settings.configure')) {
    tiles.push({
      href: '/settings', icon: 'settings', title: pick(lang, 'Detection & closure settings', 'सेटिंग'),
      body: pick(lang, 'Versioned thresholds for detection, outcome checks, reminders and closure.', 'पहचान, परिणाम, स्मरण और बंद करने की सीमाएँ।'),
    });
  }
  if (may(session, 'settings.configure') || may(session, 'demo.reset')) {
    const j = listJobs(session, { limit: 1 })[0];
    tiles.push({
      href: '/admin/jobs', icon: 'activity', title: pick(lang, 'System health & jobs', 'सिस्टम कार्य'),
      body: pick(lang, 'Background jobs: reminder sweeps, outcome recomputes, imports.', 'पृष्ठभूमि कार्य: स्मरण, परिणाम पुनर्गणना, आयात।'),
      stat: j ? `${pick(lang, 'Last run', 'अंतिम')} ${fmtDate(j.started_at, true)}` : undefined,
    });
  }
  if (may(session, 'api.manage_keys')) {
    const liveKeys = count('select count(*) c from api_keys where revoked_at is null');
    tiles.push({
      href: '/admin/api-keys', icon: 'database', title: pick(lang, 'API keys for state dashboards', 'राज्य डैशबोर्ड की API कुंजियाँ'),
      body: pick(lang, 'Read-only keys that let a Vidya Samiksha Kendra pull the case ledger for one area. Create, watch and revoke them.', 'केवल-पठन कुंजियाँ जिनसे विद्या समीक्षा केंद्र एक क्षेत्र का प्रकरण रजिस्टर पढ़ सकता है। बनाएँ, देखें और रद्द करें।'),
      stat: `${fmtInt(liveKeys)} ${pick(lang, 'keys in use', 'कुंजियाँ उपयोग में')}`,
    });
  }
  if (may(session, 'feedback.review')) {
    tiles.push({
      href: '/admin/feedback', icon: 'inbox', title: pick(lang, 'User feedback', 'उपयोगकर्ता सुझाव'),
      body: pick(lang, 'Thumbs up and down on Claude, and the feedback form from every page. Counts, filters and a CSV for the user-testing analysis.', 'Claude पर पसंद-नापसंद और हर पृष्ठ का सुझाव फ़ॉर्म। गिनती, छँटाई और परीक्षण विश्लेषण के लिए CSV।'),
      stat: `${fmtInt(count('select count(*) c from feedback'))} ${pick(lang, 'responses', 'उत्तर')}`,
    });
  }
  if (may(session, 'demo.reset')) {
    tiles.push({
      href: '/admin/outbox', icon: 'inbox', title: pick(lang, 'Message outbox', 'संदेश आउटबॉक्स'),
      body: pick(lang, 'WhatsApp, IVR and SMS messages the app would have sent. Simulated — none delivered.', 'जो संदेश भेजे जाते — सिम्युलेटेड, कोई नहीं भेजा गया।'),
    });
    tiles.push({
      href: '/admin/demo', icon: 'clock', title: pick(lang, 'System & demo controls', 'डेमो नियंत्रण'),
      body: pick(lang, 'Move the demo clock, run the reminder sweep, reset the seed. Demo administrator only.', 'डेमो घड़ी, स्मरण, बीज रीसेट — केवल डेमो प्रशासक।'),
    });
  }

  if (tiles.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Administration', 'प्रशासन')} />
        <Callout tone="warn">
          {pick(
            lang,
            'Administration is open to officers with audit, import or configuration rights. Only the demo administrator can use the demo controls.',
            'प्रशासन केवल अंकेक्षण, आयात या विन्यास अधिकार वाले अधिकारियों के लिए है। Only the demo administrator can use the demo controls.',
          )}
        </Callout>
      </div>
    );
  }

  const ai = aiStatus();

  return (
    <div>
      <PageHead
        title={pick(lang, 'Administration', 'प्रशासन')}
        sub={pick(lang, 'Governance, data and system controls, kept apart from day-to-day casework.', 'शासन, डेटा और सिस्टम नियंत्रण — रोज़मर्रा के काम से अलग।')}
      />
      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        <span className="chip border-good/30 bg-good-light text-good"><Icon name="database" size={13} />{pick(lang, 'Database: local SQLite, seeded', 'डेटाबेस: स्थानीय SQLite')}</span>
        <span className={`chip ${ai.configured ? 'border-good/30 bg-good-light text-good' : 'border-warn/30 bg-warn-light text-warn'}`}>
          <Icon name="sparkles" size={13} />
          {ai.configured ? `${pick(lang, 'AI model configured', 'AI मॉडल जुड़ा')}: ${ai.model}` : pick(lang, 'AI model not configured', 'AI मॉडल नहीं जुड़ा')}
        </span>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="group flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-card transition-all hover:-translate-y-px hover:shadow-lift">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-navy-100 text-navy-700"><Icon name={t.icon} size={19} /></span>
              <p className="mt-3.5 flex items-center gap-1 text-md font-semibold text-ink">
                {t.title}
                <Icon name="arrow-right" size={15} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </p>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-soft">{t.body}</p>
              {t.stat ? <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-faint tnum">{t.stat}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
