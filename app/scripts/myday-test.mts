/**
 * My day and photo proof.
 *
 * Field roles land on My day; it lists their own work in the right order with the reason proof
 * came back; a photo attached to proof is checked and hashed by the server, stored under that
 * hash, refused if it is not an image, too large, or already used as proof elsewhere, and
 * refused again when served if the file on disk no longer matches.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/myday-test.mts
 */
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.mydaytestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

/** A tiny but real JPEG: the marker bytes the server checks, then filler that differs per call. */
const jpeg = (tag: string, size = 2048) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set(new TextEncoder().encode(tag), 8);
  return b;
};
const written: string[] = [];

let pass = 0, fail = 0;
try {
  const { loadSession } = await import('../src/lib/session');
  const { one } = await import('../src/lib/db');
  const { Refused } = await import('../src/lib/guard');
  const w = await import('../src/lib/write');
  const { myDay } = await import('../src/lib/myday');
  const { homeFor, navFor } = await import('../src/lib/nav');
  const { readPhoto } = await import('../src/lib/evidence-files');

  const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };
  const refused = (label: string, fn: () => unknown, codeWanted?: string) => {
    try { fn(); fail++; console.log(`  FAIL ${label} — it was ALLOWED`); }
    catch (e) {
      if (!(e instanceof Refused)) { fail++; console.log(`  FAIL ${label} — threw ${(e as Error).message}`); return; }
      if (codeWanted && e.code !== codeWanted) { fail++; console.log(`  FAIL ${label} — refused as "${e.code}" (${e.message}), wanted "${codeWanted}"`); return; }
      pass++; console.log(`  ok   ${label}  [${e.code}]`);
    }
  };
  const S = (email: string) => loadSession(one<{ id: string }>('select id from users where email = ?', email)!.id)!;

  console.log('--- who lands on My day ---');
  const crc = S('crc.clu-001@demo.karyavahi.test');
  const brc = S('brc1.blk-01@demo.karyavahi.test');
  const hmRow = one<{ owner_user_id: string; id: string }>(`select owner_user_id, id from tasks where owner_role = 'headmaster' and status = 'in_progress' order by id limit 1`)!;
  const hm = loadSession(hmRow.owner_user_id)!;
  ok('a cluster coordinator lands on My day', homeFor(crc) === '/today');
  ok('so does a block coordinator', homeFor(brc) === '/today');
  ok('and a headmaster', homeFor(hm) === '/today');
  ok('officers still land on the overview', homeFor(S('beo.blk-01@demo.karyavahi.test')) === '/overview');
  ok('coordinators keep the Field Operations workspace in the menu', navFor(crc).some((x) => x.href === '/field'));
  ok("a headmaster's menu links their school", navFor(hm).some((x) => x.children.some((c) => c.href === '/school')));

  console.log('\n--- what My day lists, and in what order ---');
  const order = ['sent_back', 'overdue', 'today', 'week', 'later', 'waiting'];
  const sentBackOwner = one<{ e: string }>(`select u.email e from tasks t join users u on u.id = t.owner_user_id where t.status = 'sent_back' and u.email like 'crc.%' order by t.id limit 1`)!.e;
  const day = myDay(S(sentBackOwner));
  ok('groups come in the order work should be done', day.groups.every((g, i, a) => i === 0 || order.indexOf(a[i - 1].key) < order.indexOf(g.key)));
  const back = day.groups.find((g) => g.key === 'sent_back');
  ok('proof that was sent back comes first', day.groups[0]?.key === 'sent_back');
  ok('with the reason it was sent back', !!back?.tasks.every((t) => t.rejection && t.rejection.length > 3), JSON.stringify(back?.tasks.map((t) => t.rejection)));
  ok('only the person\'s own tasks are listed', day.groups.flatMap((g) => g.tasks).every((t) => t.owner_user_id === S(sentBackOwner).user_id));
  ok('verified work is not listed', day.groups.flatMap((g) => g.tasks).every((t) => t.status !== 'verified'));
  ok('coordinators are shown schools due a visit', (day.visits?.length ?? 0) > 0);
  ok('headmasters are not', myDay(hm).visits === null);
  const urgent = day.groups.filter((g) => ['sent_back', 'overdue', 'today'].includes(g.key)).reduce((n, g) => n + g.tasks.length, 0);
  ok('the count of things needing attention today adds up', day.urgent === urgent, `${day.urgent} vs ${urgent}`);

  console.log('\n--- photo proof ---');
  const T = hmRow.id;
  const before = Number(one<{ c: number }>(`select count(*) c from evidence where task_id = ?`, T)?.c);
  refused('a file that is not an image is refused', () => w.submitEvidence(hm, { taskId: T, note: 'Register photo', photo: { bytes: new TextEncoder().encode('<html>not a photo</html>'), name: 'x.jpg' } }), 'bad_photo');
  refused('an image over 5 MB is refused', () => w.submitEvidence(hm, { taskId: T, note: 'Register photo', photo: { bytes: jpeg('big', 5 * 1024 * 1024 + 1), name: 'big.jpg' } }), 'bad_photo');
  refused('someone else cannot hand in proof for the task', () => w.submitEvidence(crc, { taskId: T, note: 'Register photo', photo: { bytes: jpeg('a'), name: 'a.jpg' } }), 'not_owner');
  ok('refusals wrote no proof', Number(one<{ c: number }>(`select count(*) c from evidence where task_id = ?`, T)?.c) === before);

  const bytes = jpeg('register-week-3');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const { evidenceId } = w.submitEvidence(hm, { taskId: T, note: 'Attendance register, week 3', gps: 'matched', photo: { bytes, name: 'IMG_2041.HEIC.jpg' } });
  const ev = one<{ sha256: string; file_name: string; summary: string }>('select sha256, file_name, summary from evidence where id = ?', evidenceId)!;
  ok("the proof's hash is the photo's own, computed by the server", ev.sha256 === sha);
  ok('the file name records the task and the real type', ev.file_name === `${T}-${evidenceId}.jpg`, ev.file_name);
  ok('the summary records the photo', JSON.parse(ev.summary).photo?.sha256 === sha);
  const f = one<{ sha256: string; mime: string; bytes: number }>('select sha256, mime, bytes from evidence_files where evidence_id = ?', evidenceId);
  ok('the photo is registered with its type and size', f?.sha256 === sha && f.mime === 'image/jpeg' && f.bytes === bytes.length);
  const path = join(DATA, 'evidence-files', `${sha}.jpg`);
  written.push(path);
  ok('the file is stored under its hash', existsSync(path));
  const read = readPhoto(evidenceId);
  ok('serving it re-hashes it and finds it intact', read?.intact === true && read.mime === 'image/jpeg');
  refused('the same photo cannot be handed in as proof again', () => w.submitEvidence(hm, { taskId: T, note: 'Same picture', photo: { bytes, name: 'again.jpg' } }), 'duplicate_photo');
  ok('the audit trail notes that a photo came with it',
    JSON.parse(one<{ a: string }>(`select after a from audit_events where action = 'evidence.submitted' and entity_id = ?`, evidenceId)!.a).photo === true);

  writeFileSync(path, jpeg('swapped on disk'));
  ok('a file changed on disk is caught when served', readPhoto(evidenceId)?.intact === false);

  const plain = w.submitEvidence(hm, { taskId: T, note: 'Signed register, no camera today' });
  ok('proof without a photo still works', one<{ c: number }>('select count(*) c from evidence_files where evidence_id = ?', plain.evidenceId)?.c === 0);
} catch (e) {
  fail++;
  console.log(`  FAIL the test crashed: ${(e as Error).stack}`);
} finally {
  const { db } = await import('../src/lib/db');
  try { db().close(); } catch { /* already closed */ }
  swap(BACKUP, LIVE);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(`${BACKUP}${s}`); } catch {} }
  for (const p of written) { try { rmSync(p); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
