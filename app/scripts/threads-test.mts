/**
 * Case discussion threads: posting and editing, @mentions, followers, notifications,
 * decisions — and the security rule that someone outside a case's scope can neither be
 * offered in the mention picker nor mentioned by a hand-crafted request.
 *
 * Runs on a scratch copy of the pristine seed (the live demo database is backed up and
 * restored), against the real server-side modules — no browser, no server. Do not run while a
 * dev server holds the database.
 *
 *   npm run test:threads
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.threadstestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

const { loadSession } = await import('../src/lib/session');
const repo = await import('../src/lib/repo');
const feed = await import('../src/lib/feed');
const th = await import('../src/lib/threads');
const wt = await import('../src/lib/write-threads');
const { Refused } = await import('../src/lib/guard');
const { one, run, db } = await import('../src/lib/db');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
function refused(label: string, fn: () => unknown, codeWanted?: string) {
  try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
  catch (e) {
    const r = e instanceof Refused ? e : null;
    if (!r) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
    if (codeWanted && r.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${r.code}", wanted "${codeWanted}"`); return; }
    pass++; console.log(`  ok   ${label}  [${r.code}] ${r.message.slice(0, 100)}`);
  }
}
const n = (sql: string, ...p: string[]) => one<{ c: number }>(sql, ...p)?.c ?? 0;
const notes = (userId: string, kind: string) => n('select count(*) c from notifications where user_id = ? and kind = ? and entity_id = ?', userId, kind, CASE);

const CASE = 'CASE-0184'; // Rampur cluster, BLK-01; owned by the demo BEO
const byEmail = new Map(repo.demoAccounts().map((a) => [a.email, a]));
const sess = (email: string) => loadSession(byEmail.get(email)!.id)!;
const beo = sess('beo.blk-01@demo.karyavahi.test');
const crc = sess('crc.clu-001@demo.karyavahi.test');
const brc = sess('brc1.blk-01@demo.karyavahi.test');
const deo = sess('deo.rmp@demo.karyavahi.test');
const auditor = sess('auditor.state@demo.karyavahi.test');
const otherBeo = loadSession(repo.usersByRole('beo', 'BLK-09', 1)[0].id)!;
const headmaster = loadSession(repo.usersByRole('headmaster', 'SCH-00002', 1)[0].id)!;   // a driver school of CASE-0184
const farHeadmaster = loadSession(repo.usersByRole('headmaster', 'SCH-02000', 1)[0].id)!; // a school far away

console.log('\n— the schema —');
ok('the thread tables carry their own version marker',
  one<{ value: string }>(`select value from ext_meta where key = 'threads_version'`)?.value === 'threads-v1');

console.log('\n— who can be mentioned —');
const cands = th.mentionCandidates(beo, CASE);
const has = (id: string) => cands.some((c) => c.id === id);
ok('the picker offers the CRC, BRC, DEO and the driver-school headmaster', has(crc.user_id) && has(brc.user_id) && has(deo.user_id) && has(headmaster.user_id),
  `${cands.length} candidates`);
ok('the picker does not offer the viewer themself', !has(beo.user_id));
ok('the picker does not offer a BEO of another block', !has(otherBeo.user_id));
ok('the picker does not offer a headmaster of an unrelated school', !has(farHeadmaster.user_id));
ok('every person offered really can open the case', cands.every((c) => th.userCanSeeCase(c.id, CASE)));
ok('someone outside the case gets no candidates and no thread', th.mentionCandidates(otherBeo, CASE).length === 0 && th.caseThread(otherBeo, CASE).length === 0);

console.log('\n— posting and mentions —');
wt.setFollowing(deo, CASE, true);
const first = wt.postComment(beo, { caseId: CASE, body: 'Spot-check SCH-00002 before Friday, please. @Ritu', mentions: [crc.user_id] });
ok('a comment is posted', n('select count(*) c from case_comments where id = ?', first.commentId) === 1);
ok('the mentioned CRC is notified once', notes(crc.user_id, 'mention') === 1);
ok('the mention links straight to the comment',
  one<{ link: string }>(`select link from notifications where user_id = ? and kind = 'mention'`, crc.user_id)?.link === `/cases/${CASE}#comment-${first.commentId}`);
ok('a follower (the DEO) is notified of the comment', notes(deo.user_id, 'case_comment') === 1);
ok('the author is not notified of their own comment', notes(beo.user_id, 'case_comment') === 0 && notes(beo.user_id, 'mention') === 0);
ok('the author and the mentioned person now follow the case',
  n('select count(*) c from case_watchers where case_id = ? and following = 1 and user_id in (?, ?)', CASE, beo.user_id, crc.user_id) === 2);
ok('posting is audited on the case', n(`select count(*) c from audit_events where action = 'comment.posted' and entity_type = 'case' and entity_id = ? and actor_user_id = ?`, CASE, beo.user_id) === 1);

const reply = wt.postComment(crc, { caseId: CASE, body: 'Will do on Thursday.' });
ok('the case owner hears about a reply without having to follow', notes(beo.user_id, 'case_comment') === 1);
ok('the CRC is not told about their own reply', notes(crc.user_id, 'case_comment') === 0);
ok('a driver-school headmaster can take part', !!wt.postComment(headmaster, { caseId: CASE, body: 'Registers are ready for the visit.' }).commentId);

console.log('\n— security: mentions outside the case —');
const beforeComments = n('select count(*) c from case_comments');
refused('mentioning a BEO from another block is refused (a crafted request, not the picker)',
  () => wt.postComment(beo, { caseId: CASE, body: 'FYI @someone', mentions: [otherBeo.user_id] }), 'mention_scope');
refused('mentioning a far-away headmaster is refused',
  () => wt.postComment(beo, { caseId: CASE, body: 'FYI', mentions: [crc.user_id, farHeadmaster.user_id] }), 'mention_scope');
refused('mentioning a user that does not exist is refused',
  () => wt.postComment(beo, { caseId: CASE, body: 'FYI', mentions: ['USR-99999'] }), 'mention_scope');
ok('nothing was posted for any refused comment', n('select count(*) c from case_comments') === beforeComments);
ok('the out-of-scope people were not notified', n('select count(*) c from notifications where user_id in (?, ?) and entity_id = ?', otherBeo.user_id, farHeadmaster.user_id, CASE) === 0);
ok('the CRC was not notified by the refused comment that also named them', notes(crc.user_id, 'mention') === 1);
ok('the refused attempts are in the audit chain as failures',
  n(`select count(*) c from audit_events where action = 'comment.mention_refused' and result = 'failure' and entity_id = ?`, CASE) === 3);
refused('a BEO of another block cannot post on the case at all', () => wt.postComment(otherBeo, { caseId: CASE, body: 'hello' }), 'scope');
refused('nor follow it', () => wt.setFollowing(otherBeo, CASE, true), 'scope');
run(`insert into case_watchers (case_id, user_id, following, reason, updated_at) values (?, ?, 1, 'moved away', '2026-10-01')`, CASE, otherBeo.user_id);
ok('a follower who can no longer see the case is not notified (scope re-checked)', !th.followersOf(CASE).includes(otherBeo.user_id));
refused('an empty comment is refused', () => wt.postComment(beo, { caseId: CASE, body: '   ' }), 'empty');

console.log('\n— editing —');
const v1 = one<{ version: number }>('select version from case_comments where id = ?', first.commentId)!.version;
const edit = wt.editComment(beo, { commentId: first.commentId, body: 'Spot-check SCH-00002 and SCH-00007 before Friday. @Ritu @BRC', mentions: [crc.user_id, brc.user_id], expectedVersion: v1 });
ok('the author can edit their comment, and the version moves on', edit.version === v1 + 1
  && one<{ edited_at: string | null }>('select edited_at from case_comments where id = ?', first.commentId)?.edited_at !== null);
ok('an edit notifies only the newly mentioned person', edit.newlyMentioned.length === 1 && edit.newlyMentioned[0] === brc.user_id
  && n(`select count(*) c from notifications where user_id = ? and kind = 'mention'`, brc.user_id) === 1
  && notes(crc.user_id, 'mention') === 1);
ok('the edit keeps the old text in the audit chain',
  (one<{ before: string }>(`select before from audit_events where action = 'comment.edited' and entity_id = ? order by rowid desc limit 1`, CASE)?.before ?? '').includes('before Friday, please'));
refused('a stale edit (an old version) is refused', () => wt.editComment(beo, { commentId: first.commentId, body: 'x', expectedVersion: v1 }), 'stale');
refused('nobody can edit someone else\'s comment', () => wt.editComment(crc, { commentId: first.commentId, body: 'changed', expectedVersion: v1 + 1 }), 'not_author');
ok('that attempt is audited', n(`select count(*) c from audit_events where action = 'comment.edit_refused' and actor_user_id = ?`, crc.user_id) === 1);
refused('an edit cannot sneak in an out-of-scope mention',
  () => wt.editComment(crc, { commentId: reply.commentId, body: 'Will do. @x', mentions: [otherBeo.user_id], expectedVersion: 1 }), 'mention_scope');

console.log('\n— decisions —');
refused('a CRC cannot record a decision', () => wt.postComment(crc, { caseId: CASE, body: 'Decided: go ahead', decision: true }), 'role');
refused('nor can an auditor', () => wt.postComment(auditor, { caseId: CASE, body: 'Decided', decision: true }), 'role');
ok('refused decisions are audited', n(`select count(*) c from audit_events where action = 'case.decision_refused' and entity_id = ?`, CASE) === 2);
const eventsBefore = n('select count(*) c from case_events where case_id = ?', CASE);
const dec = wt.postComment(beo, { caseId: CASE, body: 'Decision: run the remedial hour in the five driver schools from 1 Nov; CRC to spot-check weekly.', decision: true });
const ev = one<{ id: string; kind: string; related_entity: string; summary: string }>(
  `select id, kind, related_entity, summary from case_events where case_id = ? and kind = 'decision_recorded'`, CASE);
ok('a decision writes a case event pointing back at the comment', !!ev && ev.related_entity === dec.commentId
  && n('select count(*) c from case_events where case_id = ?', CASE) === eventsBefore + 1);
ok('the comment remembers its case event', one<{ case_event_id: string }>('select case_event_id from case_comments where id = ?', dec.commentId)?.case_event_id === ev?.id);
ok('followers are told a decision was recorded', notes(deo.user_id, 'decision_recorded') === 1 && notes(crc.user_id, 'decision_recorded') === 1);
ok('the decision is audited as such', n(`select count(*) c from audit_events where action = 'case.decision_recorded' and entity_id = ?`, CASE) === 1);
refused('a recorded decision cannot be edited', () => wt.editComment(beo, { commentId: dec.commentId, body: 'changed my mind', expectedVersion: 1 }), 'decision_locked');

console.log('\n— following —');
wt.setFollowing(deo, CASE, false);
wt.setFollowing(beo, CASE, false); // even the owner can opt out
const deoBefore = notes(deo.user_id, 'case_comment');
const beoBefore = notes(beo.user_id, 'case_comment');
wt.postComment(crc, { caseId: CASE, body: 'Visited SCH-00002 today.' });
ok('after unfollowing, the DEO hears nothing more', notes(deo.user_id, 'case_comment') === deoBefore);
ok('the owner who unfollowed hears nothing more', notes(beo.user_id, 'case_comment') === beoBefore);
ok('watch state reports the choice', th.watchState(beo, CASE).why === 'unfollowed' && th.watchState(crc, CASE).following);
wt.postComment(beo, { caseId: CASE, body: 'Thanks.' });
ok('commenting again does not silently re-follow someone who unfollowed', th.watchState(beo, CASE).why === 'unfollowed');
ok('follow and unfollow are audited', n(`select count(*) c from audit_events where action in ('case.followed', 'case.unfollowed') and entity_id = ?`, CASE) === 3);

console.log('\n— reading —');
const thread = th.caseThread(crc, CASE);
ok('the thread lists comments in order with authors and mentions', thread.length === 6 && thread[0].id === first.commentId
  && thread[0].mentions.length === 2 && thread[0].author_name.length > 0, String(thread.length));
ok('the viewer\'s own comments are marked as theirs', thread.filter((c) => c.mine).every((c) => c.author_user_id === crc.user_id));

console.log('\n— the audit chain —');
const chain = feed.verifyAuditChain(auditor);
ok('the hash chain still verifies', chain.linked && chain.contentOk, JSON.stringify(chain).slice(0, 160));

try { db().close(); } catch { /* already closed */ }
swap(BACKUP, LIVE);
try { rmSync(BACKUP); } catch { /* fine */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
