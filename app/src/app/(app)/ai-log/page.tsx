import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { listAi, aiStats } from '@/lib/feed';
import { userNames } from '@/lib/repo';
import { may } from '@/lib/guard';
import { pick } from '@/lib/i18n';
import { Card, CardHead, PageHead, Callout, Grid, Stat, Toolbar, Empty, Mono, fmtDate, fmtInt } from '@/components/ui';
import { Pill, AiDrafted } from '@/components/labels';
import { FilterChips } from '@/components/lists';
import { SIM_MODEL } from '@domain/catalog';

/**
 * Every use of generated text, logged.
 *
 * The AI here drafts; it never decides. What makes that claim checkable is this log: each row
 * names the model, the template version, the record ids the draft was built from, and what the
 * officer who read it then did — accepted, edited or rejected. Rows marked
 * "blocked_unverified_number" are drafts that tried to state a figure that could not be traced
 * to a record, and were stopped before anyone saw them.
 */

export default async function AiLogPage({
  searchParams,
}: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const sp = await searchParams;

  if (!may(session, 'audit.view')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'AI log', 'AI लॉग')} />
        <Callout tone="warn">{pick(lang, 'Auditors, the state team and the demo administrator can read this log.', 'लेखा परीक्षक, राज्य दल और डेमो प्रशासक यह लॉग पढ़ सकते हैं।')}</Callout>
      </div>
    );
  }

  const rows = listAi(session, { kind: sp.kind || undefined, status: sp.status || undefined, limit: 300 });
  const stats = aiStats(session);
  const all = listAi(session, { limit: 3000 });
  const kinds = [...new Set(all.map((a) => a.kind))];
  const users = userNames(rows.map((a) => a.user_id ?? ''));

  const blocked = all.filter((a) => a.status === 'blocked_unverified_number').length;
  const edited = all.filter((a) => a.reviewer_decision === 'edited').length;
  const rejected = all.filter((a) => a.reviewer_decision === 'rejected').length;
  const accepted = all.filter((a) => a.reviewer_decision === 'accepted').length;

  return (
    <div className="space-y-4">
      <PageHead
        title={pick(lang, 'AI log', 'AI लॉग')}
        sub={pick(
          lang,
          'The AI drafts and explains. It does not decide, and this log is how that can be checked rather than taken on trust.',
          'AI मसौदा बनाता और समझाता है। यह निर्णय नहीं लेता, और यह लॉग उसकी जाँच का साधन है।',
        )}
        right={<AiDrafted lang={lang} model={SIM_MODEL} />}
      />

      <Grid cols={4}>
        <Stat label={pick(lang, 'Drafts accepted as written', 'जैसा था वैसा स्वीकृत')} value={fmtInt(accepted)} tone="neutral" />
        <Stat label={pick(lang, 'Edited by the officer', 'अधिकारी ने बदला')} value={fmtInt(edited)} tone="brand"
          sub={pick(lang, 'the draft was a starting point', 'मसौदा केवल शुरुआत था')} />
        <Stat label={pick(lang, 'Rejected outright', 'पूर्णतः अस्वीकृत')} value={fmtInt(rejected)} tone="warn" />
        <Stat
          label={pick(lang, 'Blocked before anyone saw them', 'दिखाने से पहले रोके')} value={fmtInt(blocked)}
          tone={blocked > 0 ? 'crit' : 'neutral'} href="/ai-log?status=blocked_unverified_number"
          sub={pick(lang, 'quoted an untraceable number', 'अप्रमाणित संख्या')}
        />
      </Grid>

      <Callout tone="method" title={pick(lang, 'What the model actually is, in this demo', 'इस डेमो में मॉडल क्या है')}>
        {pick(
          lang,
          `Every row is marked "${SIM_MODEL}". No language model is called: the drafts are produced from templates filled with values read out of the case record. Labelling them as AI-generated anyway is deliberate — the point of the log is the discipline around generated text, not the cleverness of the generator.`,
          `हर पंक्ति "${SIM_MODEL}" अंकित है। कोई भाषा मॉडल नहीं चलता: मसौदे टेम्पलेट से बनते हैं जिनमें प्रकरण के मान भरे जाते हैं।`,
        )}
      </Callout>

      <Card>
        <CardHead title={pick(lang, 'By purpose', 'उद्देश्य के अनुसार')} />
        <ul className="card-pad flex flex-wrap gap-2">
          {stats.map((s) => (
            <li key={`${s.kind}-${s.status}`}>
              <Pill tone={s.status === 'ok' ? 'neutral' : s.status === 'blocked_unverified_number' ? 'warn' : 'critical'}>
                {s.kind.replace(/_/g, ' ')} · {s.status.replace(/_/g, ' ')} · <span className="tnum">{s.c}</span>
              </Pill>
            </li>
          ))}
        </ul>
      </Card>

      <Toolbar>
        <FilterChips
          base="/ai-log" param="kind" current={sp.kind} lang={lang}
          options={[
            { value: '', label: pick(lang, 'All purposes', 'सभी'), count: all.length },
            ...kinds.map((k) => ({ value: k, label: k.replace(/_/g, ' '), count: all.filter((a) => a.kind === k).length })),
          ]}
        />
      </Toolbar>

      <Card>
        <CardHead title={pick(lang, 'Interactions', 'उपयोग')} hint={`${rows.length} ${pick(lang, 'shown', 'दिखाए')}`} />
        {rows.length === 0 ? <Empty /> : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="pending">{a.kind.replace(/_/g, ' ')}</Pill>
                  <Pill tone={a.status === 'ok' ? 'neutral' : a.status === 'blocked_unverified_number' ? 'warn' : 'critical'}>
                    {a.status.replace(/_/g, ' ')}
                  </Pill>
                  {a.reviewer_decision ? (
                    <Pill tone={a.reviewer_decision === 'accepted' ? 'good' : a.reviewer_decision === 'edited' ? 'active' : 'critical'}>
                      {pick(lang, 'officer', 'अधिकारी')}: {a.reviewer_decision}
                    </Pill>
                  ) : null}
                  {a.auditor_verdict !== 'not_applicable' ? (
                    <Pill tone={a.auditor_verdict === 'pass' ? 'good' : 'critical'}>
                      {pick(lang, 'auditor', 'लेखा परीक्षक')}: {a.auditor_verdict}
                    </Pill>
                  ) : null}
                  <span className="text-sm text-ink-soft">
                    {a.user_id ? (users.get(a.user_id) ?? a.user_id) : pick(lang, 'system', 'सिस्टम')} · {a.role}
                  </span>
                  <span className="tnum text-xs text-ink-faint">{fmtDate(a.ts, true)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  <span className="text-ink-faint">{pick(lang, 'asked:', 'पूछा:')}</span> {a.input_summary}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink">{a.output_summary}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  <Mono>{a.model}</Mono> · {a.template_version}
                  {(() => {
                    const refs = (() => { try { return JSON.parse(a.referenced_ids) as string[]; } catch { return []; } })();
                    return refs.length > 0 ? <> · {pick(lang, 'built from', 'आधार')} {refs.slice(0, 5).join(', ')}{refs.length > 5 ? ` +${refs.length - 5}` : ''}</> : null;
                  })()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
