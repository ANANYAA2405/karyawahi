import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { caseExists } from '@/lib/cases';
import { planCase, assignRefusal, taskDrafts } from '@/lib/plans';
import { intervention } from '@/lib/repo';
import { one } from '@/lib/db';
import { today, addDays } from '@/lib/clock';
import { pick } from '@/lib/i18n';
import { assignTasksAction } from '@/lib/actions';
import { Card, CardHead, PageHead, Callout } from '@/components/ui';
import { StatusPill, RoleName, EvidenceTypeName, CrossSourcePill } from '@/components/labels';
import { ActionForm } from '@/components/ActionForm';

/**
 * The task generator. An approved plan becomes one task per template (per school where the
 * template says so), each with a suggested owner from who covers that school and a due date
 * from the template's duration. The officer can change owners and dates, then assigns them all
 * at once; the server checks every row again before anything is written.
 */
export default async function AssignTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await pageSession();
  const lang = await getLanguage();
  const { id } = await params;

  const c = planCase(session, id);
  if (!c) {
    if (caseExists(id)) {
      return (
        <div className="mx-auto max-w-2xl">
          <PageHead title={pick(lang, 'Outside your scope', 'आपके दायरे से बाहर')} />
          <Callout tone="warn" title={id}>
            {pick(lang, 'This case sits outside the area your role covers.', 'यह प्रकरण आपके क्षेत्र से बाहर है।')}
          </Callout>
        </div>
      );
    }
    notFound();
  }

  const back = <Link href={`/cases/${c.id}#work`} className="link text-sm">← {pick(lang, 'Back to', 'वापस')} {c.id}</Link>;
  const refusal = assignRefusal(session, c);
  const ivId = c.current_plan_id
    ? one<{ intervention_id: string }>('select intervention_id from case_plans where id = ?', c.current_plan_id)?.intervention_id
    : null;
  const plan = ivId ? intervention(ivId) : null;
  const head = (
    <PageHead
      breadcrumb={back}
      title={pick(lang, 'Assign the work', 'काम सौंपें')}
      sub={<>{c.id} · {c.title}</>}
      meta={<><StatusPill status={c.status} lang={lang} />{plan ? <span>{plan.id} · {plan.name}</span> : null}</>}
      right={<span className="hidden lg:inline">{back}</span>}
    />
  );

  if (refusal) {
    return (
      <div className="mx-auto max-w-3xl">
        {head}
        <Callout tone="warn" title={pick(lang, 'You cannot assign this work', 'आप यह काम नहीं सौंप सकते')}>{refusal.message}</Callout>
      </div>
    );
  }

  const drafts = taskDrafts(c, c.current_plan_id!);
  const unowned = drafts.filter((d) => d.options.length === 0);
  const people = new Set(drafts.map((d) => d.ownerUserId).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {head}
      <Callout tone="method">
        {pick(
          lang,
          'Each owner is suggested from who covers the school: its headmaster, the cluster coordinator, or the block resource coordinator with the fewest open tasks. You can change an owner or a due date. You cannot drop a task: the list is the approved plan, and the independent check at the end is what lets the case close on proof.',
          'हर काम का उत्तरदायी विद्यालय को देखने वाले व्यक्ति से सुझाया गया है: प्रधानाध्यापक, संकुल समन्वयक, या सबसे कम खुले काम वाले खंड संसाधन समन्वयक। आप उत्तरदायी या तिथि बदल सकते हैं, पर कोई काम हटा नहीं सकते।',
        )}
      </Callout>
      {unowned.length ? (
        <Callout tone="warn" title={pick(lang, 'Some tasks have nobody to hold them', 'कुछ कामों के लिए कोई उत्तरदायी नहीं')}>
          {unowned.map((d) => `${d.title_en}${d.schoolName ? ` (${d.schoolName})` : ''}`).join('; ')}.{' '}
          {pick(lang, 'Fill the post in Accounts first, then come back.', 'पहले खातों में पद भरें, फिर लौटें।')}
        </Callout>
      ) : null}

      <Card>
        <CardHead
          title={pick(lang, `${drafts.length} tasks for ${people} people`, `${people} लोगों के लिए ${drafts.length} काम`)}
          hint={pick(lang, 'Due dates start from today and follow the duration each task was designed for.', 'तिथियाँ आज से, हर काम की तय अवधि के अनुसार।')}
        />
        <ActionForm
          action={assignTasksAction}
          hidden={{ case_id: c.id, case_version: String(c.version) }}
          label={pick(lang, `Assign ${drafts.length} tasks`, `${drafts.length} काम सौंपें`)}
          confirm={pick(lang, 'Each owner is notified, and the case moves to "Work assigned".', 'हर उत्तरदायी को सूचना जाएगी और प्रकरण "काम सौंपा गया" में जाएगा।')}
          className="pb-4 [&>div]:px-4 [&>p]:px-4 sm:[&>div]:px-5 sm:[&>p]:px-5"
        >
          <div className="mb-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{pick(lang, 'Task', 'काम')}</th>
                  <th scope="col">{pick(lang, 'School', 'विद्यालय')}</th>
                  <th scope="col">{pick(lang, 'Owner', 'उत्तरदायी')}</th>
                  <th scope="col">{pick(lang, 'Due', 'तिथि')}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.rowKey}>
                    <td className="min-w-[16rem] text-sm">
                      <input type="hidden" name="row" value={d.rowKey} />
                      <span className="text-ink">{pick(lang, d.title_en, d.title_hi)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                        <EvidenceTypeName type={d.template.proof_type} lang={lang} />{d.template.proof_count > 1 ? ` ×${d.template.proof_count}` : ''}
                        {d.template.cross_source ? <CrossSourcePill lang={lang} /> : null}
                      </span>
                    </td>
                    <td className="text-sm">{d.schoolName ?? <span className="text-ink-faint">{pick(lang, 'all plan schools', 'सभी योजना विद्यालय')}</span>}</td>
                    <td className="min-w-[14rem]">
                      <label className="block">
                        <span className="sr-only">{pick(lang, 'Owner for', 'उत्तरदायी:')} {d.title_en}{d.schoolName ? `, ${d.schoolName}` : ''}</span>
                        <select name={`owner:${d.rowKey}`} defaultValue={d.ownerUserId ?? ''} className="input text-sm" required>
                          {d.options.length === 0 ? <option value="">{pick(lang, 'Nobody holds this role', 'यह पद रिक्त')}</option> : null}
                          {d.options.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.note}</option>)}
                        </select>
                      </label>
                      <span className="mt-0.5 block text-xs text-ink-faint"><RoleName role={d.template.owner_role} lang={lang} /></span>
                    </td>
                    <td>
                      <label className="block">
                        <span className="sr-only">{pick(lang, 'Due date for', 'तिथि:')} {d.title_en}</span>
                        <input type="date" name={`due:${d.rowKey}`} defaultValue={d.dueDate} min={today()} max={addDays(today(), 180)} required className="input tnum text-sm" />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
