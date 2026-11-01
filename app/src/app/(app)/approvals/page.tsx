import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { approvalQueue } from '@/lib/cases';
import { lookupsFor } from '@/lib/lookups';
import { intervention, competency, placeNames } from '@/lib/repo';
import { may } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Empty, Mono, fmtInr, fmtDate } from '@/components/ui';
import { SeverityPill, AiDrafted, Illustrative, Pill } from '@/components/labels';
import { ActionForm, ReasonBox, Disclose } from '@/components/ActionForm';
import { decidePlanAction } from '@/lib/actions';
import { all } from '@/lib/db';
import { Icon } from '@/components/Icon';

/** Plans waiting on this officer, with enough on the card to decide without opening each case. */

export default async function ApprovalsPage() {
  const session = await pageSession();
  const lang = await getLanguage();

  if (!may(session, 'plan.approve_block') && !may(session, 'plan.approve_district_or_pab')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Approvals', 'स्वीकृतियाँ')} />
        <Callout tone="warn">
          {pick(
            lang,
            'Your role does not decide plans. Block-lever plans are decided by the block officer or the DEO; district and PAB plans by the DEO or the state programme team.',
            'आपकी भूमिका योजनाएँ स्वीकृत नहीं करती। खंड योजनाएँ खंड अधिकारी या DEO, और ज़िला/PAB योजनाएँ DEO या राज्य दल तय करते हैं।',
          )}
        </Callout>
      </div>
    );
  }

  const queue = approvalQueue(session, { limit: 60 });
  const look = lookupsFor(lang, {
    users: queue.flatMap((q) => [q.case.owner_user_id, q.approval?.submitted_by ?? '']),
  });
  const places = placeNames();
  // The drop each plan answers, shown as a picture beside it. Only for cases already in the queue.
  const fids = queue.map((q) => q.case.finding_id).filter((x): x is string => !!x);
  const drops = new Map(fids.length ? all<{ id: string; prev: number; curr: number; rel: number }>(
    `select id, prev_value_pct prev, curr_value_pct curr, relative_change_pp rel from findings where id in (${fids.map(() => '?').join(',')})`, ...fids,
  ).map((r) => [r.id, r]) : []);

  return (
    <div>
      <PageHead
        title={pick(lang, 'Plans waiting on you', 'आपकी प्रतीक्षा में योजनाएँ')}
        sub={pick(
          lang,
          'Approving locks the comparison schools and the success threshold, so what counts as success cannot be chosen later to fit the result.',
          'स्वीकृति से तुलना विद्यालय और सफलता लक्ष्य तय हो जाते हैं, ताकि परिणाम के अनुसार बाद में न बदले जा सकें।',
        )}
      />

      {queue.length === 0 ? (
        <Card><Empty>{pick(lang, 'Nothing is waiting on your decision.', 'आपके निर्णय की प्रतीक्षा में कुछ नहीं।')}</Empty></Card>
      ) : (
        <ul className="space-y-4">
          {queue.map(({ case: c, plan, approval }) => {
            const iv = plan ? intervention(plan.intervention_id) : null;
            const comp = competency(c.competency_id);
            return (
              <li key={c.id}>
                <Card>
                  <CardHead
                    title={<Link href={`/cases/${c.id}`} className="link">{c.title}</Link>}
                    hint={
                      <>
                        <Mono>{c.id}</Mono> · {pick(lang, 'Class', 'कक्षा')} {c.grade} ·{' '}
                        {pick(lang, comp?.name_en ?? '', comp?.name_hi ?? '')} ·{' '}
                        {places.clusters.get(c.cluster_id) ?? c.cluster_id} ·{' '}
                        {places.blocks.get(c.block_id) ?? c.block_id}
                      </>
                    }
                    right={
                      <div className="flex items-center gap-2">
                        <SeverityPill severity={c.severity} lang={lang} />
                        <Pill tone="active">{c.lever === 'block' ? pick(lang, 'block lever', 'खंड स्तर') : c.lever === 'district' ? pick(lang, 'district lever', 'ज़िला स्तर') : 'PAB'}</Pill>
                      </div>
                    }
                  />
                  {!plan ? (
                    <Empty>{pick(lang, 'No plan attached.', 'कोई योजना संलग्न नहीं।')}</Empty>
                  ) : (
                    <div className="card-pad grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                      {(() => {
                        const d = c.finding_id ? drops.get(c.finding_id) : undefined;
                        if (!d) return <div className="hidden md:block" />;
                        return (
                          <div className="rounded-xl bg-paper-sunk/70 p-3.5" aria-label={pick(lang, 'The drop this plan answers', 'यह योजना किस गिरावट के लिए है')}>
                            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{pick(lang, 'The drop', 'गिरावट')}</p>
                            <p className="mt-1.5 flex items-baseline gap-1.5">
                              <span className="tnum text-base font-semibold text-ink-soft">{d.prev.toFixed(1)}%</span>
                              <Icon name="arrow-right" size={14} className="text-crit" />
                              <span className="tnum text-xl font-semibold text-crit">{d.curr.toFixed(1)}%</span>
                            </p>
                            <div className="mt-2 space-y-1" aria-hidden>
                              <span className="block h-1.5 rounded-full bg-ink-faint/40" style={{ width: `${Math.min(100, d.prev)}%` }} />
                              <span className="block h-1.5 rounded-full bg-crit/80" style={{ width: `${Math.min(100, d.curr)}%` }} />
                            </div>
                            <p className="tnum mt-2 text-xs text-ink-soft">{d.rel > 0 ? '+' : '−'}{Math.abs(d.rel).toFixed(1)} pp {pick(lang, 'beyond the district', 'ज़िले से अधिक')}</p>
                          </div>
                        );
                      })()}
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-ink">{iv?.name ?? plan.intervention_id}</span>
                        {plan.drafted_by === 'ai_draft' ? <AiDrafted lang={lang} model={plan.ai_model} /> : null}
                        <span className="text-sm text-ink-soft">
                          {plan.school_ids.length} {pick(lang, 'schools', 'विद्यालय')} ·{' '}
                          {iv?.duration_weeks ?? '—'} {pick(lang, 'weeks', 'सप्ताह')} ·{' '}
                          <span className="tnum">{fmtInr(plan.estimated_cost_inr)}</span>
                        </span>
                        <Illustrative lang={lang} />
                      </div>
                      <p className="text-sm leading-relaxed text-ink">{plan.rationale}</p>
                      {plan.pre_registration ? (
                        <p className="text-sm text-ink-soft">
                          {pick(lang, 'Will be judged on', 'निर्णय का आधार')}:{' '}
                          <span className="tnum">+{plan.pre_registration.success_threshold_pp} pp</span>{' '}
                          {pick(lang, 'against', 'के मुकाबले')} {plan.pre_registration.comparison_school_ids.length}{' '}
                          {pick(lang, 'comparison schools', 'तुलना विद्यालय')}
                        </p>
                      ) : (
                        <p className="text-sm text-ink-soft">
                          {pick(lang, 'Comparison schools and the success threshold are locked when you approve.', 'स्वीकृति पर तुलना विद्यालय और लक्ष्य तय होंगे।')}
                        </p>
                      )}
                      {approval ? (
                        <p className="text-xs text-ink-faint">
                          {pick(lang, 'Submitted by', 'प्रस्तुत')} {look.users.get(approval.submitted_by) ?? approval.submitted_by}{' '}
                          {fmtDate(approval.submitted_at)} · {pick(lang, 'requires', 'आवश्यक')} {approval.required_role.toUpperCase()}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
                        <ActionForm
                          action={decidePlanAction}
                          hidden={{ case_id: c.id, plan_id: plan.id, decision: 'approved' }}
                          label={pick(lang, 'Approve', 'स्वीकृत करें')}
                          tone="good"
                        />
                        <Disclose label={pick(lang, 'Send back', 'लौटाएँ')}>
                          <ActionForm
                            action={decidePlanAction}
                            hidden={{ case_id: c.id, plan_id: plan.id, decision: 'revision_requested' }}
                            label={pick(lang, 'Send back for changes', 'बदलाव के लिए लौटाएँ')}
                          >
                            <ReasonBox required label={pick(lang, 'What needs changing', 'क्या बदलना है')} />
                          </ActionForm>
                        </Disclose>
                        <Disclose label={pick(lang, 'Reject', 'अस्वीकार')} tone="danger">
                          <ActionForm
                            action={decidePlanAction}
                            hidden={{ case_id: c.id, plan_id: plan.id, decision: 'rejected' }}
                            label={pick(lang, 'Reject this plan', 'योजना अस्वीकार करें')}
                            tone="danger"
                          >
                            <ReasonBox required label={pick(lang, 'Why', 'कारण')} />
                          </ActionForm>
                        </Disclose>
                        <Link href={`/cases/${c.id}`} className="btn-quiet self-start">
                          {pick(lang, 'Open the full case', 'पूरा प्रकरण खोलें')}
                        </Link>
                      </div>
                    </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
