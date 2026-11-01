import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { evidenceToCheck } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { may } from '@/lib/guard';
import { grant } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout } from '@/components/ui';
import { EvidenceList } from '@/components/lists';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { verifyEvidenceAction } from '@/lib/actions';

/**
 * Proof waiting to be checked.
 *
 * The queue is already filtered to exclude anything the signed-in user submitted — not as a
 * courtesy, but because verify_evidence() refuses it. A CRC's grant is 'spot', meaning they
 * may spot-check other people's proof, which is what makes the independent check independent.
 */

export default async function EvidencePage() {
  const session = await pageSession();
  const lang = await getLanguage();

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
  const look = lookupsFor(lang, {
    users: queue.map((e) => e.submitted_by),
    schools: queue.map((e) => e.school_id ?? ''),
  });
  const isSpotOnly = grant(session, 'evidence.verify') === 'spot';

  return (
    <div>
      <PageHead
        title={pick(lang, 'Proof to check', 'जाँचने योग्य सबूत')}
        sub={pick(
          lang,
          'Nobody checks their own work. Anything you submitted is not in this list, and the server refuses it even if asked directly.',
          'कोई अपना सबूत नहीं जाँचता। आपके जमा किए सबूत इस सूची में नहीं हैं।',
        )}
      />

      {isSpotOnly ? (
        <div className="mb-4">
          <Callout tone="note" title={pick(lang, 'You verify by spot-check', 'आप त्वरित जाँच से सत्यापित करते हैं')}>
            {pick(
              lang,
              'As a cluster coordinator your verification carries weight precisely because you were not the one who did the work. Record what you actually saw at the school.',
              'संकुल समन्वयक के रूप में आपकी जाँच इसलिए मायने रखती है कि काम आपने नहीं किया। विद्यालय में जो देखा वही दर्ज करें।',
            )}
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardHead
          title={pick(lang, 'Waiting', 'प्रतीक्षा में')}
          hint={`${queue.length} ${pick(lang, 'pieces of proof, oldest first', 'सबूत, पुराने पहले')}`}
        />
        <EvidenceList
          evidence={queue} look={look} lang={lang}
          emptyText={pick(lang, 'Nothing is waiting on you.', 'आपकी प्रतीक्षा में कुछ नहीं।')}
        >
          {(e) => (
            <div className="flex flex-col items-end gap-2">
              <ActionForm
                action={verifyEvidenceAction}
                hidden={{
                  evidence_id: e.id, case_id: e.case_id, accept: 'yes',
                  method: isSpotOnly ? 'spot_check_visit' : 'desk_review',
                }}
                label={pick(lang, 'Accept', 'स्वीकारें')}
                tone="good"
              />
              <Disclose label={pick(lang, 'Send back', 'लौटाएँ')} tone="danger">
                <ActionForm
                  action={verifyEvidenceAction}
                  hidden={{ evidence_id: e.id, case_id: e.case_id, accept: 'no' }}
                  label={pick(lang, 'Send back', 'लौटाएँ')}
                  tone="danger"
                >
                  <ReasonBox
                    required
                    label={pick(lang, 'What is wrong with it', 'इसमें क्या कमी है')}
                    placeholder={pick(lang, 'The person who submitted it will see this.', 'जमा करने वाले को यह दिखेगा।')}
                  />
                </ActionForm>
              </Disclose>
            </div>
          )}
        </EvidenceList>
      </Card>
    </div>
  );
}
