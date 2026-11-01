/**
 * Sign-in session tests: the cookie is a revocable token, not an identity, and the plain POST
 * routes refuse other sites.
 *
 * Part 1 runs against the server-side modules. It writes only to the sessions table and removes
 * its own rows, so it is safe while a server holds the database. Part 2 runs when you pass the
 * address of a running server, and checks the same things over HTTP the way a browser sees them.
 *
 *   npx tsx --conditions=react-server scripts/session-test.mts [http://localhost:3000]
 */
import { createHash } from 'node:crypto';

const BASE = process.argv[2]?.replace(/\/$/, '');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const { createSession, userIdForToken, revokeSession, loadSession } = await import('../src/lib/session');
const { isCrossSite, localPath, sameSitePath } = await import('../src/lib/http');
const { one, run } = await import('../src/lib/db');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); } };
const TAG = 'session-test';
const beoId = one<{ id: string }>(`select id from users where email = 'beo.blk-01@demo.karyavahi.test'`)!.id;

console.log('--- session tokens ---');
const token = createSession(beoId, TAG);
ok('a new session resolves to its user', userIdForToken(token) === beoId);
ok('the cookie token is not the user id', token !== beoId && !token.includes(beoId));
ok('two sign-ins get different tokens', createSession(beoId, TAG) !== token);
ok('only a hash of the token is stored', one(`select 1 from sessions where id = ?`, token) === null && one(`select 1 from sessions where id = ?`, sha256(token)) !== null);
ok('a raw user id is not a session', userIdForToken(beoId) === null);
ok('a missing or malformed token is nobody', userIdForToken(undefined) === null && userIdForToken('') === null && userIdForToken("x' or '1'='1") === null);
ok('a well-formed but unknown token is nobody', userIdForToken('A'.repeat(43)) === null);

const expiring = createSession(beoId, TAG);
run(`update sessions set expires_at = '2000-01-01T00:00:00.000Z' where id = ?`, sha256(expiring));
ok('an expired session is nobody', userIdForToken(expiring) === null);
ok('the token it was compared with still works', userIdForToken(token) === beoId);

revokeSession(token);
ok('a revoked session is nobody', userIdForToken(token) === null);
ok('revoking leaves other sessions of the same user alone', userIdForToken(createSession(beoId, TAG)) === beoId);
ok('a session still needs an active user with a role', loadSession('USR-NOPE') === null);

console.log('\n--- request checks ---');
const req = (headers: Record<string, string>) => new Request('http://localhost:3000/api/sign-in', { method: 'POST', headers: { host: 'localhost:3000', ...headers } });
ok('same-origin form post is allowed', !isCrossSite(req({ origin: 'http://localhost:3000' })));
ok('another origin is refused', isCrossSite(req({ origin: 'https://evil.example' })));
ok('a look-alike host is refused', isCrossSite(req({ origin: 'http://localhost:3000.evil.example' })));
ok('the opaque "null" origin is refused', isCrossSite(req({ origin: 'null' })));
ok('Sec-Fetch-Site cross-site is refused', isCrossSite(req({ 'sec-fetch-site': 'cross-site' })));
ok('a script with neither header is allowed', !isCrossSite(req({})));
ok('a proxied request is compared with the forwarded host', !isCrossSite(req({ origin: 'https://karyavahi.example', 'x-forwarded-host': 'karyavahi.example' })));

ok('a local path is kept', localPath('/notifications?x=1') === '/notifications?x=1');
for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '']) {
  ok(`redirect target ${JSON.stringify(bad)} falls back`, localPath(bad) === '/');
}
const h = new Headers({ host: 'localhost:3000' });
ok('a same-site Referer keeps its path', sameSitePath('http://localhost:3000/cases?tab=all', h) === '/cases?tab=all');
ok('another site in the Referer is ignored', sameSitePath('https://evil.example/phish', h) === '/');

if (BASE) {
  console.log(`\n--- over HTTP at ${BASE} ---`);
  const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams(body), headers, redirect: 'manual' });
  const page = (cookie: string, path = '/overview') => fetch(`${BASE}${path}`, { headers: { cookie: `kv_session=${cookie}` }, redirect: 'manual' });
  const cookieOf = (r: Response) => /kv_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

  const forged = await page(beoId);
  ok('a cookie set to a user id is sent to sign in', forged.status >= 300 && forged.status < 400 && (forged.headers.get('location') ?? '').includes('/login'), `status ${forged.status}`);

  const signIn = await post('/api/sign-in', { email: 'beo.blk-01@demo.karyavahi.test' }, { origin: BASE });
  const t = cookieOf(signIn);
  const setCookie = signIn.headers.get('set-cookie') ?? '';
  ok('signing in sets a session token', signIn.status === 303 && /^[A-Za-z0-9_-]{43}$/.test(t), `status ${signIn.status}`);
  ok('the cookie is HttpOnly and SameSite=Lax', /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
  ok('the token opens the app', (await page(t)).status === 200);

  const evil = await post('/api/sign-in', { email: 'admin@demo.karyavahi.test' }, { origin: 'https://evil.example' });
  ok('a sign-in form posted from another site is refused', evil.status === 403 && !cookieOf(evil), `status ${evil.status}`);
  const evil2 = await post('/api/sign-in', { user_id: beoId }, { 'sec-fetch-site': 'cross-site' });
  ok('a cross-site sign-in without Origin is refused', evil2.status === 403, `status ${evil2.status}`);

  const lang = await post('/api/language', { to: 'en' }, { origin: BASE, referer: 'https://evil.example/phish' });
  ok('the language switch never redirects to another site', new URL(lang.headers.get('location') ?? '', BASE).origin === new URL(BASE).origin, lang.headers.get('location') ?? '');
  const langBack = await post('/api/language', { to: 'en' }, { origin: BASE, referer: `${BASE}/cases?tab=all` });
  ok('the language switch returns to the page it was on', (langBack.headers.get('location') ?? '').endsWith('/cases?tab=all'), langBack.headers.get('location') ?? '');

  const outEvil = await post('/api/sign-out', {}, { origin: 'https://evil.example', cookie: `kv_session=${t}` });
  ok('a sign-out posted from another site is refused', outEvil.status === 403 && (await page(t)).status === 200);
  const out = await post('/api/sign-out', {}, { origin: BASE, cookie: `kv_session=${t}` });
  ok('signing out redirects to sign in', out.status === 303);
  const after = await page(t);
  ok('the old token stops working after sign-out', after.status >= 300 && after.status < 400, `status ${after.status}`);
}

run('delete from sessions where user_agent = ?', TAG);
console.log(`\n${pass} passed, ${fail} failed${BASE ? '' : ' (pass a server address to run the HTTP checks too)'}`);
process.exit(fail === 0 ? 0 : 1);
