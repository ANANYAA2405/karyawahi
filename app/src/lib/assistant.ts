import 'server-only';
import { all, one } from './db';
import { casesPred, tasksPred, evidencePred, findingsPred, and } from './scope';
import type { Session } from './session';
import { independentOf } from './duty';
import { today } from './clock';
import { pick } from './i18n';
import type { Language } from '@domain/types';

/**
 * The assistant.
 *
 * It answers from the database and nothing else. Every answer is assembled from rows the
 * signed-in user is already allowed to read — the same scope predicates as every other query —
 * and carries the ids it was built from, so any sentence can be checked against the record.
 *
 * No language model is called. That is a deliberate limitation, not a stub: the honest version
 * of "ask the data a question" is a small set of questions the system can answer exactly,
 * rather than fluent prose that might be wrong. A generated-text version would go through the
 * same grounding — answer only from cited rows, refuse to state a number that is not in one —
 * and would be logged in ai_interactions like every other draft.
 */

export interface Answer {
  question: string;
  summary: string;
  rows: { label: string; value: string; href?: string }[];
  citations: string[];
  caveat?: string;
}

const OPEN = ['detected', 'under_investigation', 'awaiting_approval', 'revision_requested', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'outcome_pending', 'reopened'];

export interface QuestionDef {
  id: string;
  label: { en: string; hi: string };
  run: (s: Session, lang: Language) => Answer;
}

export const QUESTIONS: QuestionDef[] = [
  {
    id: 'waiting_on_me',
    label: { en: 'What is waiting on me?', hi: 'मेरी प्रतीक्षा में क्या है?' },
    run: (s, lang) => {
      const cp = and(
        casesPred(s, 'c'),
        { sql: `c.status = 'awaiting_approval'`, params: [] },
        { sql: `not exists (select 1 from approvals a where a.case_id = c.id and a.decision = 'pending' and a.submitted_by = ?)`, params: [s.user_id] },
      );
      const approvals = all<{ id: string; title: string; lever: string }>(
        `select c.id, c.title, c.lever from cases c where ${cp.sql} limit 25`, ...cp.params,
      );
      const ep = and(
        evidencePred(s, 'e'),
        { sql: `e.status = 'pending'`, params: [] },
        independentOf(s.user_id, 'e'),
      );
      const proof = Number(one<{ c: number }>(`select count(*) c from evidence e where ${ep.sql}`, ...ep.params)?.c ?? 0);
      const mine = Number(one<{ c: number }>(
        `select count(*) c from tasks where owner_user_id = ? and status in ('assigned','acknowledged','in_progress','sent_back')`,
        s.user_id,
      )?.c ?? 0);
      const tp = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
      const overdue = Number(one<{ c: number }>(`select count(*) c from tasks t where ${tp.sql}`, ...tp.params)?.c ?? 0);

      return {
        question: pick(lang, 'What is waiting on me?', 'मेरी प्रतीक्षा में क्या है?'),
        summary: pick(
          lang,
          `${approvals.length} plan(s) waiting on a decision, ${proof} piece(s) of proof to check, ${mine} task(s) of your own outstanding, and ${overdue} overdue task(s) in your scope.`,
          `${approvals.length} योजनाएँ निर्णय प्रतीक्षित, ${proof} सबूत जाँचने योग्य, आपके ${mine} काम शेष, और दायरे में ${overdue} विलंबित काम।`,
        ),
        rows: [
          { label: pick(lang, 'Plans awaiting a decision', 'निर्णय प्रतीक्षित योजनाएँ'), value: String(approvals.length), href: '/approvals' },
          { label: pick(lang, 'Proof to check', 'जाँचने योग्य सबूत'), value: String(proof), href: '/evidence' },
          { label: pick(lang, 'My outstanding tasks', 'मेरे शेष काम'), value: String(mine), href: '/tasks' },
          { label: pick(lang, 'Overdue in my scope', 'दायरे में विलंबित'), value: String(overdue), href: '/tasks?filter=overdue' },
          ...approvals.slice(0, 6).map((a) => ({ label: a.title, value: a.lever, href: `/cases/${a.id}` })),
        ],
        citations: approvals.map((a) => a.id),
      };
    },
  },
  {
    id: 'worst_now',
    label: { en: 'Where is the problem worst right now?', hi: 'अभी समस्या कहाँ सबसे गंभीर है?' },
    run: (s, lang) => {
      const p = and(
        casesPred(s, 'c'),
        { sql: `c.status in (${OPEN.map(() => '?').join(',')})`, params: [...OPEN] },
      );
      const rows = all<{ id: string; title: string; severity: string; cluster: string; block: string; status: string }>(
        `select c.id, c.title, c.severity, cl.name cluster, bl.name block, c.status
           from cases c join clusters cl on cl.id = c.cluster_id join blocks bl on bl.id = c.block_id
          where ${p.sql}
          order by case c.severity when 'critical' then 1 when 'high' then 2 else 3 end, c.updated_at
          limit 10`,
        ...p.params,
      );
      return {
        question: pick(lang, 'Where is the problem worst right now?', 'अभी समस्या कहाँ सबसे गंभीर है?'),
        summary: rows.length === 0
          ? pick(lang, 'Nothing is open in your scope.', 'आपके दायरे में कुछ खुला नहीं है।')
          : pick(
              lang,
              `${rows.filter((r) => r.severity === 'critical').length} of the ${rows.length} most pressing open cases are rated critical. Severity is the size of the drop relative to the district, not a judgement about anybody.`,
              `${rows.length} में से ${rows.filter((r) => r.severity === 'critical').length} अति गंभीर हैं। गंभीरता ज़िले के सापेक्ष गिरावट का आकार है।`,
            ),
        rows: rows.map((r) => ({
          label: `${r.title} — ${r.cluster}, ${r.block}`,
          value: r.severity,
          href: `/cases/${r.id}`,
        })),
        citations: rows.map((r) => r.id),
      };
    },
  },
  {
    id: 'what_worked',
    label: { en: 'Has anything actually worked?', hi: 'क्या वास्तव में कुछ काम आया?' },
    run: (s, lang) => {
      const p = casesPred(s, 'oc');
      const rows = all<{ category: string; c: number }>(
        `select oe.category, count(*) c from outcome_evaluations oe
           join cases oc on oc.id = oe.case_id where ${p.sql}
          group by oe.category order by c desc`,
        ...p.params,
      );
      const total = rows.reduce((t, r) => t + r.c, 0);
      const good = rows.filter((r) => r.category.startsWith('improved')).reduce((t, r) => t + r.c, 0);
      const confirmed = rows.find((r) => r.category === 'improved_confirmed')?.c ?? 0;
      const reopened = Number(one<{ c: number }>(
        `select count(*) c from cases c where ${casesPred(s, 'c').sql} and c.reopen_count > 0`,
        ...casesPred(s, 'c').params,
      )?.c ?? 0);
      return {
        question: pick(lang, 'Has anything actually worked?', 'क्या वास्तव में कुछ काम आया?'),
        summary: total === 0
          ? pick(lang, 'No outcome evaluation has been produced in your scope yet.', 'आपके दायरे में अभी कोई परिणाम जाँच नहीं हुई।')
          : pick(
              lang,
              `Of ${total} outcome checks, ${good} showed an improvement, and only ${confirmed} of those had an interval that excluded zero. ${reopened} case(s) were reopened because the work was delivered and verified but the next round showed no gain.`,
              `${total} परिणाम जाँचों में ${good} में सुधार मिला, और उनमें केवल ${confirmed} का अंतराल शून्य से अलग था। ${reopened} प्रकरण फिर खोले गए।`,
            ),
        rows: rows.map((r) => ({ label: r.category.replace(/_/g, ' '), value: String(r.c) })),
        citations: [],
        caveat: pick(
          lang,
          'These are difference-in-differences estimates on fictional data. Treated schools were selected because they had dropped, so part of any rebound is regression to the mean. "Indicative" means the interval included zero — read it as "we cannot rule out no effect".',
          'ये काल्पनिक डेटा पर अंतर-का-अंतर अनुमान हैं। चयन गिरावट के बाद हुआ, अतः कुछ सुधार माध्य की ओर वापसी हो सकता है।',
        ),
      };
    },
  },
  {
    id: 'detector_refused',
    label: { en: 'What did the detector refuse to act on?', hi: 'पहचान-तंत्र ने किन पर कार्यवाही नहीं की?' },
    run: (s, lang) => {
      const p = findingsPred(s, 'f');
      const rows = all<{ status: string; c: number }>(
        `select f.status, count(*) c from findings f where ${p.sql} group by f.status order by c desc`, ...p.params,
      );
      const noise = rows.find((r) => r.status === 'rejected_noise')?.c ?? 0;
      const dq = rows.find((r) => r.status === 'rejected_data_quality')?.c ?? 0;
      const opened = rows.find((r) => r.status === 'case_opened')?.c ?? 0;
      return {
        question: pick(lang, 'What did the detector refuse to act on?', 'पहचान-तंत्र ने किन पर कार्यवाही नहीं की?'),
        summary: pick(
          lang,
          `${opened} candidate(s) became cases. ${noise} were material but did not pass the z-test, so acting on them would have meant chasing ordinary variation. ${dq} failed a data-quality gate and were not judged at all — which is not the same as finding no problem there.`,
          `${opened} प्रकरण बने। ${noise} महत्वपूर्ण थे पर z-परीक्षण पास नहीं हुए। ${dq} गुणवत्ता जाँच में असफल रहे और उन पर निर्णय नहीं हुआ।`,
        ),
        rows: rows.map((r) => ({
          label: r.status.replace(/_/g, ' '),
          value: String(r.c),
          href: `/findings?status=${r.status}`,
        })),
        citations: [],
      };
    },
  },
  {
    id: 'stuck',
    label: { en: 'What is stuck, and why?', hi: 'कहाँ काम रुका है, और क्यों?' },
    run: (s, lang) => {
      const tp = and(tasksPred(s, 't'), { sql: 't.submitted_at is null and t.due_date < ?', params: [today()] });
      const overdue = all<{ id: string; title_en: string; title_hi: string; days: number; owner: string }>(
        `select t.id, t.title_en, t.title_hi,
                cast(julianday(?) - julianday(t.due_date) as integer) days,
                coalesce(u.full_name, t.owner_user_id) owner
           from tasks t left join users u on u.id = t.owner_user_id
          where ${tp.sql} order by days desc limit 10`,
        today(), ...tp.params,
      );
      const blocked = all<{ id: string; title: string; blockers: string }>(
        `select c.id, c.title, oe.closure_blockers blockers
           from cases c join outcome_evaluations oe on oe.case_id = c.id
          where ${casesPred(s, 'c').sql} and oe.closure_eligible = 0 and c.status = 'outcome_pending'
          limit 8`,
        ...casesPred(s, 'c').params,
      );
      return {
        question: pick(lang, 'What is stuck, and why?', 'कहाँ काम रुका है, और क्यों?'),
        summary: pick(
          lang,
          `${overdue.length} task(s) are past their deadline with no proof submitted, and ${blocked.length} case(s) cannot close because their outcome check did not clear every closure rule.`,
          `${overdue.length} काम नियत तिथि से आगे हैं और सबूत जमा नहीं, और ${blocked.length} प्रकरण बंद नहीं हो सकते।`,
        ),
        rows: [
          ...overdue.map((t) => ({
            label: `${pick(lang, t.title_en, t.title_hi)} — ${t.owner}`,
            value: pick(lang, `${t.days}d late`, `${t.days} दिन देर`),
            href: `/tasks/${t.id}`,
          })),
          ...blocked.map((c) => {
            let why = '';
            try { why = (JSON.parse(c.blockers) as string[]).join('; '); } catch { why = ''; }
            return { label: c.title, value: why || pick(lang, 'blocked', 'रुका'), href: `/cases/${c.id}#outcome` };
          }),
        ],
        citations: [...overdue.map((t) => t.id), ...blocked.map((c) => c.id)],
      };
    },
  },
  {
    id: 'reopened',
    label: { en: 'Which cases came back?', hi: 'कौन से प्रकरण फिर खुले?' },
    run: (s, lang) => {
      const p = and(casesPred(s, 'c'), { sql: 'c.reopen_count > 0', params: [] });
      const rows = all<{ id: string; title: string; reopen_count: number; status: string }>(
        `select c.id, c.title, c.reopen_count, c.status from cases c where ${p.sql}
          order by c.reopen_count desc, c.updated_at desc limit 20`,
        ...p.params,
      );
      return {
        question: pick(lang, 'Which cases came back?', 'कौन से प्रकरण फिर खुले?'),
        summary: rows.length === 0
          ? pick(lang, 'No case in your scope has been reopened.', 'आपके दायरे में कोई प्रकरण फिर नहीं खुला।')
          : pick(
              lang,
              `${rows.length} case(s) were reopened. In each one the work was delivered and the proof was verified, but the next assessment round did not show the gain the plan was built to produce. Reopening is the honest outcome — closing on activity alone would have hidden it.`,
              `${rows.length} प्रकरण फिर खोले गए। हर एक में काम हुआ और सबूत सत्यापित हुआ, पर अगले आकलन में सुधार नहीं दिखा।`,
            ),
        rows: rows.map((r) => ({
          label: r.title,
          value: pick(lang, `reopened ×${r.reopen_count}`, `×${r.reopen_count}`),
          href: `/cases/${r.id}`,
        })),
        citations: rows.map((r) => r.id),
      };
    },
  },
];

export function answer(s: Session, id: string, lang: Language): Answer | null {
  const q = QUESTIONS.find((x) => x.id === id);
  return q ? q.run(s, lang) : null;
}
