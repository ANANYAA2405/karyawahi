import Link from 'next/link';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listAudit, countAudit, auditActionCounts, verifyAuditChain, listAi, aiStats } from '@/lib/feed';
import { headline, outcomeMix, detectionHealth } from '@/lib/dash';
import { userNames } from '@/lib/repo';
import { may } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import {
  Card, CardHead, PageHead, Grid, Stat, Callout, Toolbar, Empty, Mono, fmtDate, fmtInt, shortHash,
} from '@/components/ui';
import { Pill, AiDrafted } from '@/components/labels';
import { FilterChips } from '@/components/lists';
import { OutcomeMix, DetectionHealth } from '@/components/dash';

/**
 * The audit trail, and the auditor's landing page.
 *
 * Two things make this more than a log viewer. First, the chain is verified on load: every row
 * is re-hashed and checked against its predecessor, so a deleted or edited row shows up as a
 * break rather than passing unnoticed. Second, refused attempts are in here — the interesting
 * question is often not what happened but what somebody tried to do and was stopped from doing.
 */

export default async function AuditPage({
  searchParams,
}: { searchParams: Promise<{ result?: string; entityType?: string; entityId?: string; action?: string; page?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'audit.view')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Audit trail', 'अंकेक्षण')} />
        <Callout tone="warn">
          {pick(
            lang,
            'This role cannot read the audit log. Auditors and the state team see all of it; a block or district officer sees the entries for their own cases.',
            'यह भूमिका अंकेक्षण लॉग नहीं पढ़ सकती। लेखा परीक्षक और राज्य दल सब देखते हैं।',
          )}
        </Callout>
      </div>
    );
  }

  const page = Math.max(1, Number(sp.page ?? 1));
  const perPage = 100;
  const rows = listAudit(session, {
    result: sp.result || undefined,
    entityType: sp.entityType || undefined,
    entityId: sp.entityId || undefined,
    action: sp.action || undefined,
    limit: perPage,
    offset: (page - 1) * perPage,
  });
  const total = countAudit(session, { entityType: sp.entityType, result: sp.result });
  const failures = countAudit(session, { result: 'failure' });
  const chain = verifyAuditChain(session);
  const actions = auditActionCounts(session, 14);
  const users = userNames(rows.map((r) => r.actor_user_id ?? ''));
  const isAuditor = session.roles.some((r) => r.role === 'auditor');
  const ai = isAuditor ? listAi(session, { limit: 8 }) : [];
  const aiFailures = isAuditor ? listAi(session, { status: 'blocked_unverified_number', limit: 5 }) : [];

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'Audit trail', 'अंकेक्षण')}
        sub={pick(
          lang,
          'Append-only and hash-chained. Every write, and every attempt that was refused, with who tried it and why it failed.',
          'केवल जोड़ने योग्य, हैश-श्रृंखलाबद्ध। हर लेखन और हर अस्वीकृत प्रयास, कारण सहित।',
        )}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Entries you can read', 'पठनीय प्रविष्टियाँ')} value={fmtInt(total)} />
        <Stat
          label={pick(lang, 'Refused attempts', 'अस्वीकृत प्रयास')} value={fmtInt(failures)}
          tone={failures > 0 ? 'warn' : 'neutral'} href="/audit?result=failure"
          sub={pick(lang, 'rules doing their job', 'नियम काम कर रहे हैं')}
        />
        <Stat
          label={pick(lang, 'Hash chain', 'हैश श्रृंखला')}
          value={chain.linked ? pick(lang, 'Intact', 'अखंड') : pick(lang, 'Broken', 'खंडित')}
          tone={chain.linked ? 'good' : 'crit'}
          sub={`${fmtInt(chain.checked)} ${pick(lang, 'rows re-hashed', 'पंक्तियाँ पुनः जाँची')}`}
        />
        <Stat
          label={pick(lang, 'Contents re-hashed', 'सामग्री पुनः जाँची')}
          value={chain.contentOk ? pick(lang, 'Match', 'मेल') : pick(lang, 'Differ', 'भिन्न')}
          tone={chain.contentOk ? 'good' : 'crit'}
          sub={`${fmtInt(chain.rehashed)} ${pick(lang, 'recomputed', 'पुनर्गणित')}${chain.unverifiable > 0 ? ` · ${fmtInt(chain.unverifiable)} ${pick(lang, 'other scheme', 'अन्य योजना')}` : ''}`}
        />
      </Grid>

      {chain.checked > 0 ? (
        <Callout tone={chain.linked && chain.genesisOk && chain.contentOk ? 'good' : 'crit'} title={
          chain.linked && chain.genesisOk && chain.contentOk
            ? pick(lang, 'The chain verifies', 'श्रृंखला सत्यापित')
            : pick(lang, 'The chain does not verify', 'श्रृंखला सत्यापित नहीं')
        }>
          {chain.linked && chain.genesisOk && chain.contentOk
            ? pick(
                lang,
                `All ${fmtInt(chain.checked)} entries link up, and ${fmtInt(chain.rehashed)} of them had their hash recomputed from their own fields and matched. An inserted or deleted row would break the links; an edited row would fail the recomputation. Neither did.`,
                `सभी ${fmtInt(chain.checked)} प्रविष्टियाँ जुड़ी हैं, और ${fmtInt(chain.rehashed)} का हैश उनके ही क्षेत्रों से पुनर्गणित कर मिलाया गया। कुछ भी बदला नहीं गया।`,
              )
            : !chain.linked
              ? pick(
                  lang,
                  `The links break at ${chain.firstBreakAt}: a row has been inserted or deleted after the fact.`,
                  `कड़ियाँ ${chain.firstBreakAt} पर टूटती हैं: कोई पंक्ति बाद में जोड़ी या हटाई गई।`,
                )
              : pick(
                  lang,
                  `Entry ${chain.firstContentBreakAt} does not re-hash to the value stored with it: its contents were edited after it was written.`,
                  `प्रविष्टि ${chain.firstContentBreakAt} का हैश मेल नहीं खाता: इसकी सामग्री बाद में बदली गई।`,
                )}
        </Callout>
      ) : null}

      {isAuditor ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <OutcomeMix rows={outcomeMix(session)} lang={lang} />
            <DetectionHealth rows={detectionHealth(session)} lang={lang} />
          </div>
          <Card>
            <CardHead
              title={pick(lang, 'What the AI was used for', 'AI का उपयोग किस लिए')}
              hint={pick(
                lang,
                'Every generated draft is logged with the model, the records it referenced and what the reviewing officer did with it.',
                'हर AI मसौदा मॉडल, संदर्भित रिकॉर्ड और अधिकारी के निर्णय सहित दर्ज है।',
              )}
              right={<Link href="/ai-log" className="link text-sm">{pick(lang, 'Full AI log', 'पूरा AI लॉग')}</Link>}
            />
            <ul className="card-pad flex flex-wrap gap-2">
              {aiStats(session).slice(0, 12).map((s) => (
                <li key={`${s.kind}-${s.status}`}>
                  <Pill tone={s.status === 'ok' ? 'neutral' : s.status === 'blocked_unverified_number' ? 'warn' : 'critical'}>
                    {s.kind.replace(/_/g, ' ')} · {s.status === 'ok' ? pick(lang, 'ok', 'ठीक') : s.status.replace(/_/g, ' ')} ·{' '}
                    <span className="tnum">{s.c}</span>
                  </Pill>
                </li>
              ))}
            </ul>
            {aiFailures.length > 0 ? (
              <div className="border-t border-line px-4 py-3 sm:px-5">
                <p className="mb-2 text-sm font-medium text-ink">
                  {pick(lang, 'Drafts blocked for quoting a number nobody could verify', 'अप्रमाणित संख्या के कारण रोके गए मसौदे')}
                </p>
                <ul className="space-y-1.5">
                  {aiFailures.map((a) => (
                    <li key={a.id} className="text-sm text-ink-soft">
                      <Mono>{a.kind}</Mono> · {a.output_summary}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      <Card>
        <CardHead title={pick(lang, 'Most frequent actions', 'सर्वाधिक कार्य')} />
        <ul className="card-pad flex flex-wrap gap-2">
          {actions.map((a) => (
            <li key={a.action}>
              <Link href={`/audit?action=${encodeURIComponent(a.action)}`} className="chip border-line-strong bg-white text-ink-soft hover:bg-paper-sunk">
                <Mono>{a.action}</Mono> <span className="tnum">{fmtInt(a.c)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Toolbar>
        <FilterChips
          base="/audit" param="result" current={sp.result} lang={lang}
          options={[
            { value: '', label: pick(lang, 'Everything', 'सभी') },
            { value: 'success', label: pick(lang, 'Succeeded', 'सफल') },
            { value: 'failure', label: pick(lang, 'Refused', 'अस्वीकृत'), count: failures },
          ]}
        />
        {sp.entityId ? (
          <Link href="/audit" className="chip border-brand bg-brand text-white">
            {sp.entityType} {sp.entityId} ×
          </Link>
        ) : null}
        {sp.action ? (
          <Link href="/audit" className="chip border-brand bg-brand text-white">{sp.action} ×</Link>
        ) : null}
      </Toolbar>

      <Card>
        <CardHead
          title={pick(lang, 'Entries', 'प्रविष्टियाँ')}
          hint={`${pick(lang, 'newest first', 'नवीनतम पहले')} · ${fmtInt(total)} ${pick(lang, 'total', 'कुल')}`}
        />
        {rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'When', 'कब')}</th>
                  <th scope="col">{pick(lang, 'Who', 'कौन')}</th>
                  <th scope="col">{pick(lang, 'Action', 'कार्य')}</th>
                  <th scope="col">{pick(lang, 'On', 'किस पर')}</th>
                  <th scope="col">{pick(lang, 'Result', 'परिणाम')}</th>
                  <th scope="col">{pick(lang, 'Chain', 'श्रृंखला')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="tnum whitespace-nowrap text-sm">{fmtDate(a.ts, true)}</td>
                    <td className="text-sm">
                      {a.actor_user_id ? (users.get(a.actor_user_id) ?? a.actor_label) : a.actor_label}
                      <span className="block text-2xs text-ink-faint">{a.actor_role} · {a.source}</span>
                    </td>
                    <td className="text-sm">
                      <Mono>{a.action}</Mono>
                      {a.reason ? <span className="block text-xs text-ink-soft">{a.reason}</span> : null}
                    </td>
                    <td className="text-sm">
                      {a.entity_type === 'case' ? (
                        <Link href={`/cases/${a.entity_id}`} className="link"><Mono>{a.entity_id}</Mono></Link>
                      ) : (
                        <>
                          <span className="text-ink-faint">{a.entity_type}</span>{' '}
                          <Mono>{a.entity_id}</Mono>
                        </>
                      )}
                    </td>
                    <td>
                      {a.result === 'success'
                        ? <Pill tone="good">{pick(lang, 'done', 'हुआ')}</Pill>
                        : <Pill tone="critical">{pick(lang, 'refused', 'अस्वीकृत')}</Pill>}
                    </td>
                    <td className="text-xs">
                      <Mono>{shortHash(a.hash)}</Mono>
                      <span className="block text-ink-faint">← {shortHash(a.prev_hash)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > perPage ? (
          <nav className="flex items-center justify-between border-t border-line px-4 py-3 text-sm sm:px-5">
            {page > 1 ? (
              <Link href={`/audit?${new URLSearchParams({ ...sp, page: String(page - 1) } as Record<string, string>)}`} className="link">
                ← {pick(lang, 'Newer', 'नए')}
              </Link>
            ) : <span />}
            <span className="tnum text-ink-faint">{page} / {Math.ceil(total / perPage)}</span>
            {page * perPage < total ? (
              <Link href={`/audit?${new URLSearchParams({ ...sp, page: String(page + 1) } as Record<string, string>)}`} className="link">
                {pick(lang, 'Older', 'पुराने')} →
              </Link>
            ) : <span />}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
