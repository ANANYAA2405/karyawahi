/**
 * RBAC, geographic scope, complaint workflow, onboarding and map-scope tests.
 *
 * Runs on a scratch copy of the pristine seed (the live demo database is backed up and restored),
 * against the real server-side modules — no browser, no server needed. Do not run while a server
 * holds the database.
 *
 *   npx tsx --conditions=react-server scripts/security-test.mts
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), '.data');
const LIVE = join(DATA, 'karyavahi.db');
const PRISTINE = join(DATA, 'karyavahi.pristine.db');
const BACKUP = join(DATA, 'karyavahi.sectestbackup.db');
if (!existsSync(PRISTINE)) { console.error('No pristine database.'); process.exit(1); }
const swap = (from: string, to: string) => { for (const s of ['-wal', '-shm']) { try { rmSync(`${to}${s}`); } catch {} } copyFileSync(from, to); };
swap(LIVE, BACKUP);
swap(PRISTINE, LIVE);

const { loadSession } = await import('../src/lib/session');
const { one, all, db } = await import('../src/lib/db');
const { authorize } = await import('../src/lib/authz');
const org = await import('../src/lib/org');
const cmp = await import('../src/lib/complaints');
const onb = await import('../src/lib/onboarding');
const geo = await import('../src/lib/geo');
const { setClock, resetClock } = await import('../src/lib/clock');
const { Refused } = await import('../src/lib/guard');
const { listCases } = await import('../src/lib/cases');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };
const refused = (label: string, fn: () => unknown, match?: RegExp) => {
  try { fn(); ok(label, false, 'was allowed'); }
  catch (e) { ok(label, e instanceof Refused && (!match || match.test((e as Error).message)), (e as Error).message); }
};
const uid = (email: string) => one<{ id: string }>('select id from users where email = ?', email)!.id;
const S = (email: string) => loadSession(uid(email))!;
const hmOf = (school: string) => one<{ user_id: string }>(`select user_id from user_roles where role = 'headmaster' and scope_id = ?`, school)!.user_id;

try {
  db(); // applies the extension schema to the fresh copy
  const beo = S('beo.blk-01@demo.karyavahi.test');
  const beo9 = S('beo.blk-09@demo.karyavahi.test');
  const deo = S('deo.rmp@demo.karyavahi.test');
  const crc = S('crc.clu-001@demo.karyavahi.test');
  const brc = S('brc1.blk-01@demo.karyavahi.test');
  const state = S('state.lead@demo.karyavahi.test');
  const auditor = S('auditor.state@demo.karyavahi.test');
  const hm2 = loadSession(hmOf('SCH-00002'))!;
  const hm1 = loadSession(hmOf('SCH-00001'))!;
  const otherDistrict = one<{ id: string }>(`select id from districts where id <> 'DST-01' limit 1`)!.id;

  console.log('\n— hierarchy and geography —');
  ok('every cluster has an admin parent block', Number(one<{ n: number }>(`select count(*) n from clusters c where not exists (select 1 from geo_relationships r where r.child_id = c.id and r.hierarchy_id = 'admin' and r.parent_id = c.block_id)`)!.n) === 0);
  // On the real map school positions are 'udise' (real schools) or 'simulated'; without the boundary file, 'illustrative'.
  ok('every school has a placed point', Number(one<{ n: number }>(`select count(*) n from geo_units where level = 'school' and (boundary is null or geometry_source not in ('illustrative','simulated','udise'))`)!.n) === 0);
  ok('cities form a second hierarchy (city ≠ district)', all(`select 1 from geo_relationships where hierarchy_id = 'urban' and parent_id like 'CTY-%'`).length >= 3);
  ok('India has no drawn outline', one<{ boundary: string | null }>(`select boundary from geo_units where id = 'IN'`)!.boundary === null);
  ok('every non-top user has a designated authority', Number(one<{ n: number }>(`select count(*) n from reporting_lines r join user_roles u on u.user_id = r.user_id where r.manager_user_id is null and u.role not in ('state_admin','demo_admin')`)!.n) === 0);
  ok('headmaster → CRC → BEO → DEO chain', org.chainAbove(hm2.user_id).slice(0, 3).join('>') === [crc.user_id, beo.user_id, deo.user_id].join('>'));

  console.log('\n— geographic scope —');
  ok('headmaster cannot access another school', !org.scopeContains(hm1, 'school', 'SCH-00005') && !authorize(hm1, 'view_map', { kind: 'scope', type: 'school', id: 'SCH-00005' }).allowed);
  ok('CRC cannot access another cluster', !org.scopeContains(crc, 'cluster', 'CLU-002'));
  ok('BEO cannot access another block', !org.scopeContains(beo, 'block', 'BLK-02') && !authorize(beo, 'view_map', { kind: 'scope', type: 'block', id: 'BLK-09' }).allowed);
  ok(`DEO cannot access another district (${otherDistrict})`, !org.scopeContains(deo, 'district', otherDistrict));
  const acting = loadSession(one<{ user_id: string }>(`select user_id from user_roles where role = 'crc' and scope_id = 'CLU-003'`)!.user_id)!;
  ok('acting CRC gains CLU-002 through the delegation', org.scopeContains(acting, 'cluster', 'CLU-002') && acting.roles.some((r) => r.delegated));
  ok('delegation does not change their primary scope', acting.scope_id === 'CLU-003');
  ok('the CRC of CLU-001 (not delegated) still cannot see CLU-002', !org.scopeContains(crc, 'cluster', 'CLU-002'));
  setClock('2026-11-10T06:30:00.000Z');
  ok('delegation lapses after its end date', !org.scopeContains(loadSession(acting.user_id)!, 'cluster', 'CLU-002'));
  resetClock();
  void brc;

  console.log('\n— map scope —');
  const m1 = geo.mapData(beo, {});
  ok('BEO map opens at their block', 'parent' in m1 && m1.parent.id === 'BLK-01' && m1.childLevel === 'cluster');
  ok('BEO map returns only clusters of BLK-01', 'parent' in m1 && m1.features.features.every((f) => one<{ block_id: string }>('select block_id from clusters where id = ?', String(f.id))?.block_id === 'BLK-01'));
  const m2 = geo.mapData(beo, { parentId: 'DST-01' });
  ok('BEO cannot open the district by changing the parent id', 'error' in m2 && m2.status === 404);
  const m3 = geo.mapData(beo, { parentId: 'BLK-09' });
  ok('BEO cannot open another block — same 404 as a missing id', 'error' in m3 && m3.status === 404);
  const m4 = geo.mapData(hm1, {});
  ok('headmaster map shows only their own school', 'parent' in m4 && m4.features.features.length === 1 && m4.features.features[0].id === 'SCH-00001');
  ok('headmaster cannot open their cluster', 'error' in geo.mapData(hm1, { parentId: 'CLU-001' }));
  const m5 = geo.mapData(state, {});
  // The real map also draws the state's other districts, marked as having no demo data.
  ok('state officer opens at state level showing districts', 'parent' in m5 && m5.childLevel === 'district'
    && m5.features.features.filter((f) => !Number((f.properties as Record<string, unknown>).noData)).length === 3);
  ok('urban hierarchy: DEO sees the district city', 'parent' in geo.mapData(deo, { parentId: 'DST-01', hierarchy: 'urban' }));
  ok('geo search never returns out-of-scope places', geo.geoSearch(beo, 'a').every((c) => geo.canOpen(beo, geo.geoUnit(c.id)!)));
  ok('map features carry every layer metric', 'parent' in m1 && ['severity', 'critical', 'complaints', 'overdue', 'delivery', 'improved', 'insufficient'].every((k) => k in (m1.features.features[0].properties ?? {})));

  console.log('\n— complaint routing and workflow —');
  const c1 = cmp.createComplaint(hm2, { category: 'material_shortage', title: 'Reading cards missing', description: 'No reading cards for Class 2 this term.', priority: 'medium', severity: 'moderate', schoolId: 'SCH-00002' });
  ok('headmaster complaint goes to their designated CRC', one<{ assigned_user_id: string }>('select assigned_user_id from complaints where id = ?', c1)!.assigned_user_id === crc.user_id);
  ok('it is not broadcast: the DEO is not the assignee and receives no notification', one<{ n: number }>(`select count(*) n from notifications where user_id = ? and entity_id = ?`, deo.user_id, c1)!.n === 0);
  refused('headmaster cannot raise a complaint about another school', () => cmp.createComplaint(hm2, { category: 'other', title: 'Not mine', description: 'About a school that is not mine.', priority: 'low', severity: 'low', schoolId: 'SCH-00050' }), /scope/);
  refused('the complainant cannot acknowledge their own complaint', () => cmp.actOnComplaint(hm2, c1, 'acknowledge', ''));
  refused('a BEO who is not the assignee cannot acknowledge', () => cmp.actOnComplaint(beo, c1, 'acknowledge', ''));
  cmp.actOnComplaint(crc, c1, 'acknowledge', '');
  cmp.actOnComplaint(crc, c1, 'investigate', '');
  refused('proposing a resolution needs a note', () => cmp.actOnComplaint(crc, c1, 'propose', ''));
  cmp.actOnComplaint(crc, c1, 'propose', 'Cards dispatched from the BRC store.');
  cmp.actOnComplaint(hm2, c1, 'confirm', '');
  ok('confirmed by complainant → resolved', one<{ status: string }>('select status from complaints where id = ?', c1)!.status === 'resolved');
  cmp.actOnComplaint(hm2, c1, 'reopen', 'Only half the cards came.');
  ok('complainant can reopen', one<{ status: string }>('select status from complaints where id = ?', c1)!.status === 'reopened');
  ok('full timeline recorded', all('select 1 from complaint_events where complaint_id = ?', c1).length >= 6);
  ok('every step is in the audit chain', all(`select 1 from audit_events where entity_type = 'complaint' and entity_id = ?`, c1).length >= 6);

  const c2 = cmp.createComplaint(hm2, { category: 'infrastructure', title: 'Broken toilet door', description: 'The girls’ toilet door is broken.', priority: 'medium', severity: 'moderate', schoolId: 'SCH-00002' });
  ok('explicit rule: infrastructure routes to the BEO', one<{ assigned_user_id: string }>('select assigned_user_id from complaints where id = ?', c2)!.assigned_user_id === beo.user_id);
  const c3 = cmp.createComplaint(hm2, { category: 'teacher_availability', title: 'School closed — no teacher', description: 'The only teacher is on leave; school closed.', priority: 'critical', severity: 'critical', schoolId: 'SCH-00002' });
  ok('critical teacher absence routes directly to the DEO', one<{ assigned_user_id: string }>('select assigned_user_id from complaints where id = ?', c3)!.assigned_user_id === deo.user_id);

  const c4 = cmp.createComplaint(hm2, { category: 'conduct', title: 'Visits logged but not made', description: 'Visit records do not match reality.', priority: 'high', severity: 'high', schoolId: 'SCH-00002', accusedUserId: crc.user_id });
  const r4 = one<{ assigned_user_id: string; confidentiality: string }>('select assigned_user_id, confidentiality from complaints where id = ?', c4)!;
  ok('conduct complaint is restricted and routed around the accused CRC to the BEO', r4.confidentiality === 'restricted' && r4.assigned_user_id === beo.user_id);
  ok('the accused CRC cannot see it', cmp.complaintAccess(crc, c4) === null && !cmp.listComplaints(crc, {}).some((c) => c.id === c4));
  ok('a senior officer not on the route (DEO) cannot see the restricted complaint', cmp.complaintAccess(deo, c4) === null);
  ok('the state auditor can see it for oversight', cmp.complaintAccess(auditor, c4)?.relation === 'auditor');
  ok('the DEO can oversee a standard complaint in their district', cmp.complaintAccess(deo, c1)?.relation === 'oversight');
  ok('oversight is read-only', !authorize(deo, 'resolve_complaint', { kind: 'complaint', id: c1 }).allowed);
  ok('another block’s BEO cannot see it', cmp.complaintAccess(beo9, c1) === null);

  refused('manual escalation needs a reason', () => cmp.escalateComplaint(beo, c2, 'no', false));
  refused('a non-assignee cannot escalate', () => cmp.escalateComplaint(crc, c2, 'Please take this upward now.', false));
  cmp.escalateComplaint(beo, c2, 'Needs a district works order.', false);
  ok('manual escalation goes to the next designated authority (DEO)', one<{ assigned_user_id: string; escalation_level: number }>('select assigned_user_id, escalation_level from complaints where id = ?', c2)!.assigned_user_id === deo.user_id);

  const c5 = cmp.createComplaint(hm2, { category: 'academic_support_delay', title: 'No coaching visit', description: 'No coaching visit for two months.', priority: 'medium', severity: 'moderate', schoolId: 'SCH-00002' });
  setClock('2026-10-31T06:30:00.000Z');
  const sw = cmp.complaintSlaSweep();
  const r5 = one<{ assigned_user_id: string; status: string }>('select assigned_user_id, status from complaints where id = ?', c5)!;
  ok('missed acknowledgement SLA escalates to the BEO', r5.assigned_user_id === beo.user_id && r5.status === 'escalated', JSON.stringify(sw));
  const before = one<{ n: number }>(`select count(*) n from complaint_events where kind = 'escalated'`)!.n;
  cmp.complaintSlaSweep();
  ok('the sweep is idempotent on the same day', one<{ n: number }>(`select count(*) n from complaint_events where kind = 'escalated'`)!.n === before);
  resetClock();

  console.log('\n— onboarding —');
  const { id: reg, code } = onb.createRegistration({ fullName: 'Test Applicant', email: 'test.applicant@demo.karyavahi.test', role: 'headmaster', scopeType: 'school', scopeId: 'SCH-00020', affiliationRef: 'bad' });
  ok('registration starts at email verification and creates no account', one<{ status: string }>('select status from registration_requests where id = ?', reg)!.status === 'email_verification_pending' && !one('select 1 x from users where email = ?', 'test.applicant@demo.karyavahi.test'));
  refused('duplicate pending request for the same email is refused', () => onb.createRegistration({ fullName: 'Again', email: 'test.applicant@demo.karyavahi.test', role: 'headmaster', scopeType: 'school', scopeId: 'SCH-00020' }), /already in progress/);
  refused('wrong email code is refused', () => onb.verifyEmail(reg, 'test.applicant@demo.karyavahi.test', '000000'));
  onb.verifyEmail(reg, 'test.applicant@demo.karyavahi.test', code);
  ok('a bad affiliation reference does not pass', !onb.checkAffiliation(reg, 'test.applicant@demo.karyavahi.test').passed);
  ok('a valid reference routes to the designated verifier (BEO of the block)', onb.checkAffiliation(reg, 'test.applicant@demo.karyavahi.test', 'EMP-EDU-1234').passed && one<{ verifier_user_id: string }>('select verifier_user_id from registration_requests where id = ?', reg)!.verifier_user_id === org.authorityFor('block', one<{ block_id: string }>('select block_id from schools where id = ?', 'SCH-00020')!.block_id));
  refused('a CRC cannot approve accounts', () => onb.decideRegistration(crc, reg, 'approve', ''), /does not have|junior/);
  refused('another block’s BEO cannot approve it', () => onb.decideRegistration(beo9, reg, 'approve', ''), /outside your scope/);
  refused('rejecting needs a reason', () => onb.decideRegistration(beo, reg, 'reject', ''));
  onb.decideRegistration(beo, reg, 'request_info', 'Which school register number?');
  onb.respondToInfo(reg, 'test.applicant@demo.karyavahi.test', 'Register 4471.');
  const newUser = onb.decideRegistration(beo, reg, 'approve', 'Checked with the headmaster register.');
  const ns = newUser ? loadSession(newUser) : null;
  ok('approved account is active with exactly the requested role and scope', !!ns && ns.role === 'headmaster' && ns.scope_id === 'SCH-00020');
  ok('its designated authority is set', !!newUser && org.managerOf(newUser) !== null);
  refused('a duplicate of an existing account cannot be approved', () => onb.decideRegistration(beo, 'REG-0004', 'approve', ''), /already belongs/);
  refused('a BEO cannot approve a DEO-level request', () => onb.decideRegistration(beo, 'REG-0003', 'approve', ''));
  refused('the demo admin role cannot be requested', () => onb.createRegistration({ fullName: 'X Y', email: 'x.y@demo.karyavahi.test', role: 'demo_admin', scopeType: 'state', scopeId: 'STA-01' }), /cannot be requested/);
  const ch = onb.requestChange(beo, 'beo', 'block', 'BLK-02', 'Transferred by state order.');
  refused('you cannot approve your own change request', () => onb.decideRegistration(beo, ch, 'approve', ''));
  ok('requesting a change does not change your role', loadSession(beo.user_id)!.scope_id === 'BLK-01');

  console.log('\n— account status and self-protection —');
  ok('nobody can manage their own account', !authorize(beo, 'manage_users', { kind: 'user', userId: beo.user_id }).allowed);
  ok('a BEO cannot manage a DEO', !authorize(beo, 'manage_users', { kind: 'user', userId: deo.user_id }).allowed);
  ok('a BEO can manage a headmaster in their block', authorize(beo, 'manage_users', { kind: 'user', userId: hm2.user_id }).allowed);
  org.setAccountStatus(beo, hm2.user_id, 'suspended', 'Test suspension');
  ok('a suspended user cannot sign in', loadSession(hm2.user_id) === null);
  ok('a suspended user’s existing session is refused', !authorize(hm2, 'create_complaint').allowed);
  refused('a suspended user cannot raise a complaint', () => cmp.createComplaint(hm2, { category: 'other', title: 'After suspension', description: 'Should be refused.', priority: 'low', severity: 'low', schoolId: 'SCH-00002' }));
  org.setAccountStatus(beo, hm2.user_id, 'active', 'Test complete');
  ok('reactivation restores access', loadSession(hm2.user_id) !== null);
  ok('status changes are audited', all(`select 1 from audit_events where entity_type = 'user' and entity_id = ? and action in ('user.suspend','user.reactivate')`, hm2.user_id).length === 2);

  console.log('\n— existing case scoping still holds —');
  ok('BEO of BLK-01 still sees 14 cases', listCases(beo, { limit: 500 }).length === 14);
  ok('BLK-09 BEO cannot see CASE-0184', !listCases(beo9, { limit: 500 }).some((c) => c.id === 'CASE-0184'));

  console.log('\n— who may sign in without a password —');
  {
    const si = await import('../src/lib/sign-in');
    const { run } = await import('../src/lib/db');
    const signedIn = (r: ReturnType<typeof si.resolveSignIn>) => ('session' in r ? r.session.user_id : r.error);
    // An account whose address could be a real person's, as an older registration could have made.
    run(`insert into users (id, full_name, email, preferred_language, preferred_channel, is_demo_account, status, created_at, provenance)
         values ('USR-REAL1', 'Real Person', 'real.person@gmail.com', 'en', 'in_app', 0, 'active', '2026-10-01T00:00:00.000Z', 'test')`);
    run(`insert into user_roles (id, user_id, role, scope_type, scope_id, granted_at, granted_by) values ('UR-REAL1', 'USR-REAL1', 'headmaster', 'school', 'SCH-00030', '2026-10-01', 'test')`);
    ok('a featured demo persona signs in by email', signedIn(si.resolveSignIn({ email: 'BEO.BLK-01@demo.karyavahi.test' })) === beo.user_id);
    ok('so does any other fictional officer on the demo domain (the walkthroughs use them)', signedIn(si.resolveSignIn({ email: 'beo.blk-17@demo.karyavahi.test' })) === uid('beo.blk-17@demo.karyavahi.test'));
    const hmId = one<{ id: string }>(`select u.id from users u join user_roles ur on ur.user_id = u.id where ur.role = 'headmaster' and u.is_demo_account = 0 order by u.id limit 1`)!.id;
    ok('and a headmaster picked by id, as the route crawl does', signedIn(si.resolveSignIn({ userId: hmId })) === hmId);
    ok('an account on a real-looking address cannot be signed into by email', signedIn(si.resolveSignIn({ email: 'real.person@gmail.com' })) === 'unknown-email');
    ok('…and gets the same answer as an address with no account, so it cannot be probed', signedIn(si.resolveSignIn({ email: 'nobody.at.all@gmail.com' })) === 'unknown-email');
    ok('…nor by its user id', signedIn(si.resolveSignIn({ userId: 'USR-REAL1' })) === 'unknown-account');
    ok('a malformed address is called malformed', signedIn(si.resolveSignIn({ email: 'not-an-address' })) === 'invalid-email');
    ok('an unknown demo address is unknown', signedIn(si.resolveSignIn({ email: 'nobody@demo.karyavahi.test' })) === 'unknown-email');
    org.setAccountStatus(beo, hm2.user_id, 'suspended', 'Test suspension for sign-in');
    ok('a suspended demo account cannot sign in', signedIn(si.resolveSignIn({ userId: hm2.user_id })) === 'unknown-account');
    org.setAccountStatus(beo, hm2.user_id, 'active', 'Test complete');
    refused('registration refuses an address that could be a real person\'s', () => onb.createRegistration({ fullName: 'Real Person', email: 'someone@gmail.com', role: 'headmaster', scopeType: 'school', scopeId: 'SCH-00031' }), /only accepts fictional addresses/);
  }
} finally {
  const { db: dbf } = await import('../src/lib/db');
  try { dbf().close(); } catch {}
  swap(BACKUP, LIVE);
  rmSync(BACKUP, { force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
