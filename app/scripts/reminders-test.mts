/**
 * Reminders and escalation: T−2 reminder, the overdue nudge on breach (owner and block officer),
 * the +7 escalation to the district officer, idempotency, each person's channel and language,
 * the demo clock, who may run the sweep, and the scheduler that runs it by itself.
 *
 * Runs on a scratch copy of the pristine seed (the live demo database is backed up and
 * restored), against the real server-side modules — no browser, no server. Do not run while a
 * dev server holds the database.
 *
 *   npm run test:reminders
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.reminderstestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

try {
  const { loadSession } = await import('../src/lib/session');
  const repo = await import('../src/lib/repo');
  const feed = await import('../src/lib/feed');
  const w = await import('../src/lib/write');
  const rem = await import('../src/lib/reminders');
  const sched = await import('../src/lib/scheduler');
  const { today } = await import('../src/lib/clock');
  const { Refused } = await import('../src/lib/guard');
  const { one, all, run } = await import('../src/lib/db');

  const refused = (label: string, fn: () => unknown, codeWanted?: string) => {
    try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
    catch (e) {
      const r = e instanceof Refused ? e : null;
      if (!r) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
      if (codeWanted && r.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${r.code}", wanted "${codeWanted}"`); return; }
      pass++; console.log(`  ok   ${label}  [${r.code}]`);
    }
  };
  const n = (sql: string, ...p: string[]) => Number(one<{ c: number }>(sql, ...p)?.c ?? 0);
  const byEmail = new Map(repo.demoAccounts().map((a) => [a.email, a]));
  const sess = (email: string) => loadSession(byEmail.get(email)!.id)!;
  const admin = sess('admin@demo.karyavahi.test');
  const beo = sess('beo.blk-01@demo.karyavahi.test');
  const crc = sess('crc.clu-001@demo.karyavahi.test');
  const state = sess('state.lead@demo.karyavahi.test');
  const auditor = sess('auditor.state@demo.karyavahi.test');
  const clock = (d: string) => w.setDemoClock(admin, `${d}T06:30:00.000Z`);
  const sweep = () => w.reminderSweep(null, undefined, { trigger: 'clock_moved' });
  const zero = (r: { remindersSent: number; breachNudges: number; escalationsCreated: number; outboxQueued: number }) =>
    r.remindersSent === 0 && r.breachNudges === 0 && r.escalationsCreated === 0 && r.outboxQueued === 0;

  console.log('\n— the migration and the seed —');
  ok('tasks has a breach_nudged_at column', n(`select count(*) c from pragma_table_info('tasks') where name = 'breach_nudged_at'`) === 1);
  ok('the seed\'s own overdue nudges are carried over, with their time',
    n(`select count(*) c from tasks where breach_nudged_at is not null`) > 0
    && n(`select count(*) c from tasks t where t.breach_nudged_at is not null and not exists (
          select 1 from notifications x where x.entity_id = t.id and x.kind = 'task_overdue' and x.ts = t.breach_nudged_at
          union all select 1 from outbox_messages o where o.entity_id = t.id and o.template = 'overdue_nudge' and o.ts = t.breach_nudged_at)`) === 0);
  const atSeed = w.reminderSweep(null, undefined, { trigger: 'startup' });
  ok(`on the seed date (${today()}) the sweep finds nothing the seed has not already sent`, zero(atSeed), JSON.stringify(atSeed));

  console.log('\n— who may run it —');
  refused('a block officer cannot run the sweep', () => w.reminderSweep(beo), 'role');
  refused('a CRC cannot run it', () => w.reminderSweep(crc), 'role');
  refused('the state team cannot run it', () => w.reminderSweep(state), 'role');
  refused('nor can the demo admin with a date that is not a date', () => w.reminderSweep(admin, '20-11-2026'), 'bad_input');
  ok('the demo admin can run it by hand', typeof w.reminderSweep(admin).remindersSent === 'number');
  ok('the system (no session) can run it', typeof w.reminderSweep(null).remindersSent === 'number');
  ok('a manual run is recorded as manual, an automatic one with its trigger',
    n(`select count(*) c from system_jobs where job_type = 'reminder_sweep' and json_extract(summary, '$.trigger') = 'manual'`) >= 1
    && n(`select count(*) c from system_jobs where job_type = 'reminder_sweep' and json_extract(summary, '$.trigger') = 'startup'`) >= 1);

  console.log('\n— setting up: the backlog flushed, five tasks with known owners —');
  // Jump far ahead so every seeded task is past all three steps, then work on a clean slate.
  clock('2027-03-01');
  const flush = sweep();
  ok('jumping the clock catches up on everything that fell due in between', flush.escalationsCreated > 0 && flush.breachNudges > 0, JSON.stringify(flush));
  ok('...and a second sweep on that date sends nothing', zero(sweep()));

  type Pick = { id: string; owner: string; lang: string; channel: string; case_id: string; block_id: string; district_id: string };
  const pickTask = (channel: string, lang: string | null, not: string[]) => one<Pick>(
    `select t.id, t.owner_user_id owner, u.preferred_language lang, u.preferred_channel channel, t.case_id, c.block_id, c.district_id
       from tasks t join users u on u.id = t.owner_user_id join cases c on c.id = t.case_id
      where u.preferred_channel = ? and (? is null or u.preferred_language = ?)
        and exists (select 1 from user_roles r where r.role = 'beo' and r.scope_id = c.block_id and r.user_id <> t.owner_user_id)
        and exists (select 1 from user_roles r where r.role = 'deo' and r.scope_id = c.district_id)
        and t.owner_user_id not in (${not.map(() => '?').join(',') || "''"})
      order by t.id limit 1`, channel, lang, lang, ...not,
  )!;
  const A = pickTask('whatsapp', 'hi', []);
  const B = pickTask('ivr', 'hi', [A.owner]);
  const C = pickTask('sms', null, [A.owner, B.owner]);
  const D = pickTask('app', 'en', [A.owner, B.owner, C.owner]);
  const E = pickTask('whatsapp', 'en', [A.owner, B.owner, C.owner, D.owner]);
  const reset = (id: string, due: string) => run(
    `update tasks set status = 'in_progress', submitted_at = null, verified_at = null, due_date = ?,
            reminder_sent_at = null, breach_nudged_at = null, escalated_at = null where id = ?`, due, id);
  for (const t of [A, B, C, D]) reset(t.id, '2027-03-10');
  reset(E.id, '2027-03-20'); // the one whose deadline the clock will jump over
  ok('five tasks: WhatsApp/Hindi, IVR/Hindi, SMS, app/English and WhatsApp/English owners',
    [A, B, C, D, E].every(Boolean) && A.channel === 'whatsapp' && B.channel === 'ivr' && C.channel === 'sms' && D.channel === 'app' && E.lang === 'en');
  const task = (id: string) => one<{ reminder_sent_at: string | null; breach_nudged_at: string | null; escalated_at: string | null; due_date: string; submitted_at: string | null }>(
    'select reminder_sent_at, breach_nudged_at, escalated_at, due_date, submitted_at from tasks where id = ?', id)!;
  const outbox = (id: string, template: string) => all<{ user_id: string; channel: string; language: string; body: string; delivery_status: string }>(
    'select user_id, channel, language, body, delivery_status from outbox_messages where entity_id = ? and template = ? order by id', id, template);
  const notes = (id: string, kind: string) => all<{ user_id: string; title: string }>(
    'select user_id, title from notifications where entity_id = ? and kind = ? order by id', id, kind);
  const deva = /[ऀ-ॿ]/;

  console.log('\n— T−2: the reminder —');
  clock('2027-03-07');
  sweep();
  ok('three days before, nobody is reminded yet', [A, B, C, D].every((t) => !task(t.id).reminder_sent_at));
  clock('2027-03-08');
  const r1 = sweep();
  ok('two days before, every owner is reminded once', [A, B, C, D].every((t) => !!task(t.id).reminder_sent_at) && r1.remindersSent >= 4, JSON.stringify(r1));
  ok('each owner gets the in-app notification', [A, B, C, D].every((t) => notes(t.id, 'deadline_upcoming').some((x) => x.user_id === t.owner && x.title === 'Due in 2 days')));
  const wa = outbox(A.id, 'reminder_t_minus_2');
  ok('the WhatsApp user gets a WhatsApp message, in Hindi', wa.length === 1 && wa[0].channel === 'whatsapp' && wa[0].language === 'hi' && deva.test(wa[0].body) && wa[0].body.includes('अनुस्मारक'), JSON.stringify(wa));
  const ivr = outbox(B.id, 'reminder_t_minus_2');
  ok('the IVR user gets a voice script, in Hindi, with keys to press', ivr.length === 1 && ivr[0].channel === 'ivr' && ivr[0].body.includes('1 दबाएँ') && ivr[0].body.startsWith('नमस्ते'), ivr[0]?.body);
  const sms = outbox(C.id, 'reminder_t_minus_2');
  ok('the SMS user gets a short SMS in their own language', sms.length === 1 && sms[0].channel === 'sms' && sms[0].language === C.lang && sms[0].body.length <= 120
    && (C.lang === 'hi') === deva.test(sms[0].body), JSON.stringify(sms));
  ok('the app user gets no outbox message: the app is their channel', outbox(D.id, 'reminder_t_minus_2').length === 0);
  ok('every new outbox message is marked not delivered',
    n(`select count(*) c from outbox_messages where ts >= '2027-03-01' and delivery_status <> 'simulated_not_sent'`) === 0
    && n(`select count(*) c from outbox_messages where ts >= '2027-03-01'`) > 0);
  ok('the reminder is in the audit log, by the system',
    n(`select count(*) c from audit_events where entity_id = ? and action = 'task.reminder_sent' and actor_role = 'system' and source = 'system' and ts >= '2027-03-01'`, A.id) === 1);
  ok('a second sweep the same day sends nothing', zero(sweep()));
  ok('...not even another outbox message', outbox(A.id, 'reminder_t_minus_2').length === 1);

  // D's owner sends proof the day before it is due: no nudge, no escalation for D.
  clock('2027-03-09');
  sweep();
  run(`update tasks set status = 'submitted', submitted_at = '2027-03-09T05:00:00.000Z' where id = ?`, D.id);

  console.log('\n— breach: the overdue nudge —');
  clock('2027-03-10');
  sweep();
  ok('on the due date itself nobody is nudged', [A, B, C].every((t) => !task(t.id).breach_nudged_at));
  clock('2027-03-11');
  const r2 = sweep();
  ok('the day after, every owner without proof is nudged once', [A, B, C].every((t) => !!task(t.id).breach_nudged_at) && r2.breachNudges >= 3, JSON.stringify(r2));
  ok('the owner who sent proof is not', !task(D.id).breach_nudged_at && notes(D.id, 'task_overdue').length === 0);
  ok('the owner gets the in-app "Task overdue" notification', notes(A.id, 'task_overdue').some((x) => x.user_id === A.owner && x.title === 'Task overdue'));
  const beosOfA = all<{ user_id: string }>(`select user_id from user_roles where role = 'beo' and scope_id = ?`, A.block_id).map((r) => r.user_id);
  ok('the block officer of the case\'s block is told', beosOfA.length > 0 && beosOfA.every((b) => notes(A.id, 'task_overdue').some((x) => x.user_id === b && x.title === 'Overdue in your block')));
  ok('nobody at the district hears of it yet', notes(A.id, 'escalation').length === 0 && !task(A.id).escalated_at);
  const waN = outbox(A.id, 'overdue_nudge');
  ok('the WhatsApp owner gets the nudge on WhatsApp, in Hindi', waN.length === 1 && waN[0].channel === 'whatsapp' && waN[0].language === 'hi' && waN[0].body.includes('निकल गई'), JSON.stringify(waN));
  const ivrN = outbox(B.id, 'overdue_nudge');
  ok('the IVR owner gets a voice script', ivrN.length === 1 && ivrN[0].channel === 'ivr' && ivrN[0].body.includes('2 दबाएँ'), ivrN[0]?.body);
  ok('the nudge is in the audit log, by the system, naming who was reached',
    (() => {
      const a = one<{ after: string; actor_role: string }>(`select after, actor_role from audit_events where entity_id = ? and action = 'task.breach_nudged'`, A.id);
      const sent = a ? (JSON.parse(a.after).sent_to as { user: string; channel: string }[]) : [];
      return a?.actor_role === 'system' && sent.some((x) => x.user === A.owner && x.channel === 'whatsapp') && beosOfA.every((b) => sent.some((x) => x.user === b));
    })());
  ok('a second sweep the same day sends nothing', zero(sweep()));

  console.log('\n— +7: escalation to the district —');
  clock('2027-03-16');
  sweep();
  ok('six days late, still not escalated', [A, B, C].every((t) => !task(t.id).escalated_at));
  clock('2027-03-17');
  const r3 = sweep();
  ok('seven days late, every one is escalated', [A, B, C].every((t) => !!task(t.id).escalated_at) && r3.escalationsCreated >= 3, JSON.stringify(r3));
  const deosOfA = all<{ user_id: string }>(`select user_id from user_roles where role = 'deo' and scope_id = ?`, A.district_id).map((r) => r.user_id);
  ok('the district officer gets the escalation', deosOfA.length > 0 && deosOfA.every((d) => notes(A.id, 'escalation').some((x) => x.user_id === d)));
  ok('the owner who sent proof is never escalated', !task(D.id).escalated_at);
  ok('the escalation is in the audit log, by the system',
    n(`select count(*) c from audit_events where entity_id = ? and action = 'task.escalated' and actor_role = 'system' and ts >= '2027-03-01'`, A.id) === 1);
  ok('a second sweep the same day sends nothing', zero(sweep()));
  ok('each step went out exactly once per task',
    [A, B, C].every((t) => n(`select count(*) c from audit_events where entity_id = ? and action in ('task.reminder_sent','task.breach_nudged','task.escalated') and ts >= '2027-03-01'`, t.id) === 3));

  console.log('\n— the demo clock decides, and a jump catches up in order —');
  ok('E (due 20 Mar) has had nothing yet', !task(E.id).reminder_sent_at && !task(E.id).breach_nudged_at);
  clock('2027-03-30');
  const r4 = sweep();
  const e = task(E.id);
  ok('jumping past its deadline and the escalation line sends the nudge and the escalation together', !!e.breach_nudged_at && !!e.escalated_at, JSON.stringify(r4));
  ok('...but no late "due in 2 days" reminder for a task already overdue', !e.reminder_sent_at);
  const eN = outbox(E.id, 'overdue_nudge');
  ok('the English WhatsApp owner gets the nudge in English', eN.length === 1 && eN[0].language === 'en' && !deva.test(eN[0].body) && eN[0].body.startsWith('Karyavahi'), JSON.stringify(eN));
  const nudgeSeq = Number(one<{ s: number }>(`select seq s from audit_events where entity_id = ? and action = 'task.breach_nudged'`, E.id)?.s ?? 0);
  const escSeq = Number(one<{ s: number }>(`select seq s from audit_events where entity_id = ? and action = 'task.escalated'`, E.id)?.s ?? 0);
  ok('the nudge is recorded before the escalation', nudgeSeq > 0 && escSeq > nudgeSeq);
  ok('a date override is a demo date too: re-running for an earlier day sends nothing new', zero(w.reminderSweep(admin, '2027-03-08')));

  console.log('\n— the timeline on the task page —');
  const tl = rem.reminderTimeline(task(A.id), today());
  ok('A: reminder, nudge and escalation all show as sent', tl.map((s) => s.state).join() === 'sent,sent,sent', JSON.stringify(tl));
  const tlD = rem.reminderTimeline(task(D.id), today());
  ok('D: reminded, then nothing needed after the proof came in', tlD.map((s) => s.state).join() === 'sent,not_needed,not_needed', JSON.stringify(tlD));
  const tlE = rem.reminderTimeline(task(E.id), today());
  ok('E: the reminder was skipped by the jump, the others went out', tlE.map((s) => s.state).join() === 'not_sent,sent,sent', JSON.stringify(tlE));
  const future = rem.reminderTimeline({ due_date: '2027-04-10', submitted_at: null, reminder_sent_at: null, breach_nudged_at: null, escalated_at: null }, '2027-03-30');
  ok('a future task shows the three dates it will go out', future.map((s) => `${s.state}:${s.at}`).join() === 'planned:2027-04-08,planned:2027-04-11,planned:2027-04-17', JSON.stringify(future));
  const due = rem.reminderTimeline({ due_date: '2027-03-29', submitted_at: null, reminder_sent_at: null, breach_nudged_at: null, escalated_at: null }, '2027-03-30');
  ok('a breach not yet swept shows as going out on the next sweep', due[1].state === 'pending_run');

  console.log('\n— the words —');
  const ctx = { title: 'कक्षा 3 में रोज़ पठन अभ्यास', due: '2026-11-02' };
  ok('dates are spoken, not ISO', rem.spokenDate('2026-11-02', 'hi') === '2 नवंबर 2026' && rem.spokenDate('2026-11-02', 'en') === '2 Nov 2026');
  for (const tpl of Object.values(rem.TEMPLATE)) {
    const hiIvr = rem.messageFor(tpl, 'ivr', 'hi', { ...ctx, owner: 'सुनीता देवी', block: 'रामपुर' });
    const enWa = rem.messageFor(tpl, 'whatsapp', 'en', { title: 'Daily reading practice', due: '2026-11-02', owner: 'Sunita Devi', block: 'Rampur' });
    ok(`${tpl}: the Hindi IVR script greets, says the date and offers a key`, hiIvr.startsWith('नमस्ते') && hiIvr.includes('2 नवंबर 2026') && hiIvr.includes('1 दबाएँ') && !/[A-Za-z]/.test(hiIvr), hiIvr);
    ok(`${tpl}: the English WhatsApp text is English`, enWa.startsWith('Karyavahi') && !deva.test(enWa) && enWa.includes('2 Nov 2026'));
  }
  ok('an SMS stays short even for a long title', rem.messageFor('overdue_nudge', 'sms', 'en', { title: 'x'.repeat(200), due: '2026-11-02' }).length <= 120);

  console.log('\n— the scheduler —');
  const jobsBefore = n(`select count(*) c from system_jobs where job_type = 'reminder_sweep'`);
  ok('it starts once, and runs the sweep straight away', sched.startScheduler({ intervalMs: 3_600_000 }) === true
    && n(`select count(*) c from system_jobs where job_type = 'reminder_sweep'`) === jobsBefore + 1);
  ok('a second start in the same process does not start a second timer', sched.startScheduler() === false);
  const st = sched.schedulerStatus();
  ok('the admin page can say when it last ran by itself and when it runs next',
    st.running && !!st.nextRunAt && Date.parse(st.nextRunAt) > Date.now() && st.lastAuto?.trigger === 'startup' && st.lastAuto.asOf === today(), JSON.stringify(st).slice(0, 240));
  clock('2027-04-09');
  const moved = sched.runScheduledSweep('clock_moved');
  ok('moving the demo clock runs it for the new date', moved?.asOf === '2027-04-09' && sched.schedulerStatus().lastAuto?.trigger === 'clock_moved');
  ok('an automatic run is idempotent too', zero(sched.runScheduledSweep('hourly')!));
  ok('every automatic run is recorded as a job with its trigger and wall-clock time',
    all<{ summary: string }>(`select summary from system_jobs where job_type = 'reminder_sweep' order by rowid desc limit 3`)
      .every((r) => { const s = JSON.parse(r.summary); return ['startup', 'hourly', 'clock_moved'].includes(s.trigger) && !Number.isNaN(Date.parse(s.ran_at)); }));
  sched.stopScheduler();
  ok('it stops', !sched.schedulerStatus().running);
  process.env.KV_SCHEDULER = 'off';
  ok('KV_SCHEDULER=off keeps it off', sched.startScheduler() === false && !sched.schedulerStatus().running);
  delete process.env.KV_SCHEDULER;
  ok('a manual run never counts as "ran by itself"', (w.reminderSweep(admin), sched.schedulerStatus().lastAuto?.trigger) === 'hourly');

  console.log('\n— the audit chain —');
  const chain = feed.verifyAuditChain(auditor);
  ok('the hash chain still verifies after all of it', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));
} catch (e) {
  fail++; console.log(`  FAIL the test crashed — ${(e as Error).stack}`);
} finally {
  { const { db: dbf } = await import('../src/lib/db'); try { dbf().close(); } catch { /* already closed */ } }
  swap(BACKUP, LIVE);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
