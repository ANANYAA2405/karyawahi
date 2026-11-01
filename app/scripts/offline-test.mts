/**
 * Offline proof and real GPS.
 *
 * - A proof sent twice with the same client id (the phone retrying after a lost answer, or the
 *   page and the service worker both sending it) is one evidence row, per submitter.
 * - Where proof was handed in is worked out by the server from the phone's fix and the school's
 *   position: at the school (within 250 m), far away, or not available. A status sent by the
 *   client is never used.
 * - Scoping is unchanged: a client id cannot be used to reach someone else's proof or task.
 *
 * Runs on a scratch copy of the pristine seed and restores the demo database afterwards. Do not
 * run while a server holds the database.
 *
 *   npx tsx --conditions=react-server scripts/offline-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.offlinetestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

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
  const { one, all, db } = await import('../src/lib/db');
  const { Refused } = await import('../src/lib/guard');
  const w = await import('../src/lib/write');
  const g = await import('../src/lib/proof-gps');

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
  db(); // opens the database and runs the migrations

  console.log('--- the migration ---');
  const cols = all<{ name: string }>(`select name from pragma_table_info('evidence')`).map((c) => c.name);
  ok('evidence gains client_id, the fix and the distance', ['client_id', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_distance_m'].every((c) => cols.includes(c)), cols.join(','));
  ok('a unique index keeps one row per submitter and client id',
    !!one(`select 1 from sqlite_master where type = 'index' and name = 'evidence_client_uq' and sql like '%submitted_by%client_id%'`));
  ok('the migration is recorded once', one<{ value: string }>(`select value from ext_meta where key = 'proof_sync'`)?.value === 'proof-sync-v1');

  console.log('\n--- distance and status, worked out by the server ---');
  const school = { lat: 26.8, lng: 80.9 };
  const north = (m: number) => ({ lat: school.lat + m / 111_195, lng: school.lng });
  const fix = (m: number, accuracy: number) => ({ ...north(m), accuracy });
  ok('the distance is real arithmetic (1 km north is 1000 m)', Math.abs(g.distanceM(school, north(1000)) - 1000) < 2, String(g.distanceM(school, north(1000))));
  ok(`within ${g.GPS_RADIUS_M} m counts as at the school`, g.classifyFix(school, fix(40, 15)).status === 'matched');
  ok('240 m away is still at the school', g.classifyFix(school, fix(240, 10)).status === 'matched');
  ok('260 m away is not', g.classifyFix(school, fix(260, 10)).status === 'outside_radius');
  const far = g.classifyFix(school, fix(1200, 25));
  ok('1.2 km away is outside, with the distance', far.status === 'outside_radius' && Math.abs((far.distance_m ?? 0) - 1200) <= 2, JSON.stringify(far));
  ok('no fix is not available', g.classifyFix(school, null).status === 'unavailable' && g.classifyFix(school, null).reason === 'no_fix');
  ok('a school with no position is not available', g.classifyFix(null, fix(0, 10)).reason === 'no_school_position');
  ok('a rough fix near the school cannot say "at the school"', g.classifyFix(school, fix(100, 2000)).status === 'unavailable');
  ok('a rough fix 30 km away is still clearly away', g.classifyFix(school, fix(30_000, 2000)).status === 'outside_radius');
  ok('garbage coordinates are no fix', g.parseFix('abc', '80', '10') === null && g.parseFix('91', '80', '10') === null && g.parseFix('0', '0', '5') === null);
  ok('a missing accuracy counts as too rough', g.classifyFix(school, g.parseFix(String(school.lat), String(school.lng), '')).status === 'unavailable');

  // A headmaster's open task at a school that has a position on the map.
  const T = one<{ id: string; owner_user_id: string; school_id: string }>(
    `select t.id, t.owner_user_id, t.school_id from tasks t join geo_units gu on gu.id = t.school_id and gu.level = 'school' and gu.centroid_lat is not null
      where t.owner_role = 'headmaster' and t.status in ('in_progress','acknowledged','assigned') and t.proof_count >= 3 order by t.id limit 1`)!;
  const hm = loadSession(T.owner_user_id)!;
  const pos = g.schoolPosition(T.school_id)!;
  ok('the task\'s school has a position', !!pos);
  const at = (m: number, acc = 12) => ({ lat: pos.lat + m / 111_195, lng: pos.lng, accuracy: acc });
  const row = (id: string) => one<{ gps_status: string; gps_lat: number | null; gps_lng: number | null; gps_accuracy_m: number | null; gps_distance_m: number | null; client_id: string | null; summary: string }>(
    'select gps_status, gps_lat, gps_lng, gps_accuracy_m, gps_distance_m, client_id, summary from evidence where id = ?', id)!;

  const a = w.submitEvidence(hm, { taskId: T.id, note: 'Register, at the school', location: at(30) });
  const ra = row(a.evidenceId);
  ok('proof handed in at the school is "matched"', ra.gps_status === 'matched' && a.gps.status === 'matched', JSON.stringify(ra));
  ok('the fix and the distance are stored', ra.gps_lat !== null && ra.gps_accuracy_m === 12 && (ra.gps_distance_m ?? 999) <= 31);

  // The client's own claim is never read: these calls carry gps: 'matched' as an old form would.
  const claim = { gps: 'matched' } as Record<string, unknown>;
  const b = w.submitEvidence(hm, { taskId: T.id, note: 'Register, from the block office', location: at(1200, 20), ...claim } as Parameters<typeof w.submitEvidence>[1]);
  ok('a client saying "matched" from 1.2 km away is recorded as outside', row(b.evidenceId).gps_status === 'outside_radius', row(b.evidenceId).gps_status);
  ok('with how far away it was', Math.abs((row(b.evidenceId).gps_distance_m ?? 0) - 1200) <= 2, String(row(b.evidenceId).gps_distance_m));

  console.log('\n--- one row per proof, however often it is sent ---');
  // Use a second task so the first one's piece count does not interfere.
  const T2 = one<{ id: string }>(
    `select id from tasks where owner_user_id = ? and id <> ? and status in ('in_progress','acknowledged','assigned','sent_back') order by id limit 1`, hm.user_id, T.id)
    ?? { id: T.id };
  const cid = 'c0ffee00-1234-4abc-9def-000000000001';
  const bytes = jpeg('offline-register');
  written.push(join(DATA, 'evidence-files', `${createHash('sha256').update(bytes).digest('hex')}.jpg`));
  const before = Number(one<{ c: number }>('select count(*) c from evidence where task_id = ?', T2.id)?.c);
  const audits = () => Number(one<{ c: number }>(`select count(*) c from audit_events where action = 'evidence.submitted'`)?.c);
  const auditBefore = audits();
  const first = w.submitEvidence(hm, { taskId: T2.id, note: 'Saved offline', clientId: cid, photo: { bytes, name: 'p.jpg' }, savedOfflineAt: '2026-10-24T09:00:00Z', ...claim } as Parameters<typeof w.submitEvidence>[1]);
  ok('the first send is stored', !first.duplicate && row(first.evidenceId).client_id === cid);
  ok('with no fix it is "not available", whatever the client claimed', row(first.evidenceId).gps_status === 'unavailable', row(first.evidenceId).gps_status);
  ok('the summary notes it was saved offline and why there is no location',
    JSON.parse(row(first.evidenceId).summary).saved_offline_at === '2026-10-24T09:00:00Z' && JSON.parse(row(first.evidenceId).summary).location_unavailable === 'no_fix');
  const second = w.submitEvidence(hm, { taskId: T2.id, note: 'Saved offline', clientId: cid, photo: { bytes, name: 'p.jpg' } });
  ok('the same client id again returns the same proof', second.duplicate && second.evidenceId === first.evidenceId);
  const third = w.submitEvidence(hm, { taskId: T2.id, note: 'Saved offline (third try, different words)', clientId: cid, location: at(10) });
  ok('and again, even with different contents', third.duplicate && third.evidenceId === first.evidenceId);
  ok('exactly one evidence row was added', Number(one<{ c: number }>('select count(*) c from evidence where task_id = ?', T2.id)?.c) === before + 1);
  ok('exactly one row carries that client id', Number(one<{ c: number }>('select count(*) c from evidence where client_id = ?', cid)?.c) === 1);
  ok('and one audit event, one notification trail', audits() === auditBefore + 1);
  // Reusing an id for another task: a coordinator has several open tasks at once.
  const two = all<{ id: string; owner_user_id: string }>(
    `select id, owner_user_id from tasks where owner_user_id = (
       select owner_user_id from tasks where owner_role = 'crc' and status in ('in_progress','acknowledged','assigned','sent_back')
        group by owner_user_id having count(*) >= 2 order by owner_user_id limit 1)
     and status in ('in_progress','acknowledged','assigned','sent_back') order by id limit 2`);
  const crcOwner = loadSession(two[0].owner_user_id)!;
  const cid2 = 'c0ffee00-1234-4abc-9def-000000000002';
  w.submitEvidence(crcOwner, { taskId: two[0].id, note: 'Coaching visit log', clientId: cid2 });
  refused('the same client id cannot be reused for a different task', () => w.submitEvidence(crcOwner, { taskId: two[1].id, note: 'x', clientId: cid2 }), 'client_id_reused');
  refused('a malformed client id is refused', () => w.submitEvidence(hm, { taskId: T2.id, note: 'x', clientId: 'a b' }), 'bad_client_id');
  let dupInsert = false;
  try {
    db().prepare(`insert into evidence (id, task_id, submitted_by, client_id) values ('EVD-TEST-DUP', ?, ?, ?)`).run(T2.id, hm.user_id, cid);
  } catch { dupInsert = true; }
  ok('the database itself refuses a second row with that client id', dupInsert);

  console.log('\n--- scoping ---');
  const crc = S('crc.clu-001@demo.karyavahi.test');
  refused('someone else using the same client id gets no one\'s proof back: it is not their task', () => w.submitEvidence(crc, { taskId: T2.id, note: 'x', clientId: cid }), 'not_owner');
  const other = one<{ id: string; owner_user_id: string }>(
    `select id, owner_user_id from tasks where owner_role = 'headmaster' and owner_user_id <> ? and status in ('in_progress','acknowledged','assigned','sent_back') order by id limit 1`, hm.user_id)!;
  const hm2 = loadSession(other.owner_user_id)!;
  const theirs = w.submitEvidence(hm2, { taskId: other.id, note: 'Their own proof', clientId: cid });
  ok('client ids are per submitter: another person with the same id gets their own row',
    !theirs.duplicate && theirs.evidenceId !== first.evidenceId && Number(one<{ c: number }>('select count(*) c from evidence where client_id = ?', cid)?.c) === 2);
  refused('and still cannot hand in proof for a task that is not theirs', () => w.submitEvidence(hm2, { taskId: T2.id, note: 'x', clientId: 'another-client-id-0001' }), 'not_owner');
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
