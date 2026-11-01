/**
 * The two guards around Claude that need no model to test:
 *   - the auditor pass (lib/ai/audit-numbers.ts): figures Claude writes must be in its data;
 *   - the evidence library search (lib/evidence-search.ts): ranked, scoped, safe with any input.
 *
 *   npx tsx --conditions=react-server scripts/ai-guard-test.mts
 *
 * Reads the demo database; writes nothing.
 */
const { auditNumbers } = await import('../src/lib/ai/audit-numbers');
const { searchLibrary } = await import('../src/lib/evidence-search');
const { runTool, TOOL_DEFS } = await import('../src/lib/ai/tools');
const { loadSession } = await import('../src/lib/session');
const repo = await import('../src/lib/repo');
const { all } = await import('../src/lib/db');
const { casesPred } = await import('../src/lib/scope');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${detail ? `  [${detail}]` : ''}`); }
};
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

console.log('\n— the auditor pass —');
const data = { prev: 42.3, now: 24.4, change: -17.9, district: -6.6, rel: -11.3, participation: 0.855, assessed: 509, z: -3.92, note: 'CRC re-checked 18 / 18 schools' };
const a1 = auditNumbers('Fell from 42.3% to 24.4%, a 17.9-point drop (district −6.6 pts); participation 85.5%, z = -3.92, 509 students.', [data]);
ok('figures taken from the data pass, however they are written (%, pp, sign, 0.855 → 85.5%)', a1.unsupported.length === 0 && a1.checked >= 6, JSON.stringify(a1));
const a2 = auditNumbers('Learning will rise by 12.5 pp and reach 640 children.', [data]);
ok('a computed or invented figure is caught', same(a2.unsupported, ['12.5 pp', '640']), JSON.stringify(a2));
ok('rounding for writing is allowed (17.9 → 18 points)', auditNumbers('about 18 points', [data]).unsupported.length === 0);
ok('small counts in a sentence are not policed ("4 of 5 schools", "Class 3")', auditNumbers('4 of 5 schools in Class 3', [data]).checked === 0);
ok('record ids, dates and years are not figures', auditNumbers('CASE-0184 opened 19 Oct 2026, round R4, 2026-27, INT-04', [data]).checked === 0);
ok('Hindi digits are read as numbers', auditNumbers('भागीदारी ८५.५% थी', [data]).unsupported.length === 0
  && same(auditNumbers('नया आँकड़ा ३३.३%', [data]).unsupported, ['33.3%']));
ok('numbers inside the data\'s own text count as data', auditNumbers('18 of 18 schools re-checked', [data]).unsupported.length === 0);
ok('no figures, nothing to check', auditNumbers('The finding is solid; look at staffing first.', [data]).checked === 0);

console.log('\n— the evidence library search —');
const by = new Map(repo.demoAccounts().map((a) => [a.email, a]));
const sess = (e: string) => loadSession(by.get(e)!.id)!;
const beo = sess('beo.blk-01@demo.karyavahi.test');
const state = sess('state.lead@demo.karyavahi.test');

const camp = searchLibrary(state, 'volunteers reading camp');
ok('finds the intervention by what its evidence and delivery conditions say', camp.interventions.some((h) => h.id === 'INT-03'), camp.interventions.map((h) => h.id).join(','));
ok('and the cases that tried it, with the outcome check', camp.cases.length > 0 && camp.cases.every((c) => c.outcome && typeof c.outcome.category === 'string'));
ok('matched words are marked in the passage', camp.interventions.some((h) => /\[[^\]]+\]/.test(h.snippet)));

const mine = searchLibrary(beo, 'teacher', { cases: 50 });
const theirs = searchLibrary(state, 'teacher', { cases: 50 });
ok('the state sees more checked cases than one block officer', theirs.cases.length > mine.cases.length, `${theirs.cases.length} vs ${mine.cases.length}`);
const p = casesPred(beo, 'c');
const visible = new Set(all<{ id: string }>(`select c.id from cases c where ${p.sql}`, ...p.params).map((r) => r.id));
ok('every case a block officer is shown is one they may open', mine.cases.every((c) => visible.has(c.id)), mine.cases.filter((c) => !visible.has(c.id)).map((c) => c.id).join(','));

let threw = false;
const nasty = ['"', '"; drop table lib; --', 'NEAR(teacher camp)', '*', 'AND OR NOT', 'शिक्षक की कमी', '', '   ', 'a'.repeat(500)];
for (const q of nasty) { try { searchLibrary(beo, q); } catch { threw = true; } }
ok('no input can break the search (quotes, operators, Hindi, empty, very long)', !threw);
ok('an empty search returns nothing rather than everything', searchLibrary(beo, '  ').interventions.length === 0);

console.log('\n— Claude\'s lookup —');
ok('Claude has the search as a read-only tool', TOOL_DEFS.some((t) => t.name === 'search_evidence_library'));
const tr = runTool(beo, 'search_evidence_library', { query: 'CRC coaching visits', limit: 3 });
ok('the tool answers with its sources, scoped to the reader', !tr.error && tr.result.sources.length > 0
  && (tr.result.data as { checked_cases: { id: string }[] }).checked_cases.every((c) => visible.has(c.id)), tr.error ?? '');
ok('the tool refuses a missing query', Boolean(runTool(beo, 'search_evidence_library', {}).error));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
