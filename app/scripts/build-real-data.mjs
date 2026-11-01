#!/usr/bin/env node
/**
 * Turns the public downloads in .data/sources/ (see scripts/fetch-real-data.mjs) into the two
 * small files the app reads, both committed so a fresh checkout runs without the downloads:
 *
 *   data/real/schools.json  — for each demo school id, the real UDISE+ school it now stands for:
 *                             position (moved ~0.3–0.7 km, see JITTER), management, category,
 *                             rural/urban, enrolment by class, teachers and classrooms.
 *                             NO school name, NO UDISE code, NO village: those never leave
 *                             .data/sources/, because the learning results stay simulated and a
 *                             real school must never look like it is failing.
 *   data/real/figures.json  — the published district figures (PRS 2024, ASER 2024, NFHS-5),
 *                             the UP PAB 2025-26 unit costs and which intervention card each
 *                             one costs, each with its page reference.
 *
 *   npm run data:build
 *
 * Which real school each demo school becomes:
 *   1. the pool: government schools (Department of Education or local body) that teach
 *      Classes 1–5, with a position inside the real district outline;
 *   2. the largest of them by Class 1–3 enrolment, as many as the demo has in that district,
 *      primary-only and Class 1–8 schools kept in the demo's own proportions;
 *   3. grouped by position into the demo's blocks (the first block takes the district town)
 *      and, inside each block, into the demo's clusters, with the demo's own group sizes;
 *   4. inside each cluster, each demo school takes the remaining real school of its type
 *      with the nearest Class 1–3 enrolment.
 * Demo ids, blocks, clusters, users and the case ledger are untouched. The demo's block and
 * cluster names are fictional and match no LGD block, so blocks are rebuilt from positions
 * rather than joined by name; districts are joined by LGD code (Rampur 176, Lucknow 162,
 * Varanasi 187 — PRS uses the same codes, IND09176 etc.).
 *
 * The PRS and PAB figures were read off the PDFs by position (pypdf text with coordinates) and
 * are written below with their pages; this script re-reads each cited page and refuses to
 * write the file if a figure is not on it. ASER and NFHS are parsed from the files.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, '.data', 'sources');
const OUT = join(APP, 'data', 'real');
const PRISTINE = join(APP, '.data', 'karyavahi.pristine.db');
const GEO = join(APP, 'data', 'up-geo.json');

/** Positions are moved by this much, in a direction fixed per school, so a pin never marks a real building. */
const JITTER_M = [300, 700];

const DISTRICTS = [
  { id: 'DST-01', name: 'Rampur', lgd: 176, prs: 'IND09176', file: 'udise-rampur.csv', pdf: 'Report_Rampur_IND09176.pdf' },
  { id: 'DST-02', name: 'Lucknow', lgd: 162, prs: 'IND09162', file: 'udise-lucknow.csv', pdf: 'Report_Lucknow_IND09162.pdf' },
  { id: 'DST-03', name: 'Varanasi', lgd: 187, prs: 'IND09187', file: 'udise-varanasi.csv', pdf: 'Report_Varanasi_IND09187.pdf' },
];

// ------------------------------------------------------------------ verified published figures
/**
 * PRS 2024 district reports, Foundational stage (Class 3). Page 15 of each PDF (printed
 * "Page : 01") holds "Average performance in Language / Mathematics (%)": district, Uttar
 * Pradesh, India. Page 18 (printed "Page : 04") holds the competency table. The text layer lists
 * the two overall charts in the opposite order to the page; the values were assigned by their
 * position under each heading (and the national row, 64 / 60, matches the national report).
 */
const PRS = {
  'DST-01': { language: 73, mathematics: 67, participation: { schools: 34, teachers: 96, students: 799 },
    lang_comp: [77, 67, 70], math_comp: [74, 72, 62, 66, 68, 65, 49, 73, 70, 59, 61, 62] },
  'DST-02': { language: 72, mathematics: 66, participation: { schools: 53, teachers: 136, students: 1300 },
    lang_comp: [76, 68, 70], math_comp: [75, 76, 62, 66, 64, 61, 60, 69, 65, 57, 60, 61] },
  'DST-03': { language: 67, mathematics: 61, participation: { schools: 46, teachers: 135, students: 1152 },
    lang_comp: [71, 63, 64], math_comp: [71, 68, 53, 66, 61, 56, 44, 66, 63, 53, 56, 55] },
};
const PRS_STATE = { language: 68, mathematics: 64, lang_comp: [72, 65, 66], math_comp: [71, 68, 58, 64, 64, 62, 51, 66, 65, 57, 61, 59] };
const PRS_NATIONAL = { language: 64, mathematics: 60 };
const PRS_LANG = [
  ['C-9.7', 'Knows and uses enough words for day-to-day interactions; guesses new words from known vocabulary', 'रोज़मर्रा की बातचीत के लिए पर्याप्त शब्द जानता है; नए शब्दों का अर्थ अनुमान लगाता है'],
  ['C-10.5', 'Reads short stories and understands them on their own (characters, storyline, intent)', 'छोटी कहानियाँ स्वयं पढ़कर समझता है (पात्र, कथानक, आशय)'],
  ['C-10.7', 'Reads and understands short news items, instructions, recipes and notices', 'छोटी ख़बरें, निर्देश, नुस्ख़े और सूचनाएँ पढ़कर समझता है'],
];
const PRS_MATH = [
  ['C-8.1', 'Sorts objects into groups and sub-groups', 'वस्तुओं को समूहों व उप-समूहों में छाँटता है'],
  ['C-8.2', 'Identifies and extends simple patterns', 'सरल पैटर्न पहचानता और आगे बढ़ाता है'],
  ['C-8.4', 'Arranges numbers up to 99 in order', '99 तक की संख्याओं को क्रम में लगाता है'],
  ['C-8.5', 'Recognises and uses numerals up to 99 with place value', 'स्थानीय मान के साथ 99 तक के अंक पहचानता है'],
  ['C-8.6', 'Adds and subtracts 2-digit numbers fluently', 'दो अंकों की संख्याओं का जोड़-घटाव धाराप्रवाह करता है'],
  ['C-8.7', 'Multiplication as repeated addition, division as sharing', 'गुणा को बार-बार जोड़ और भाग को बराबर बाँटना समझता है'],
  ['C-8.8', 'Recognises basic shapes and relative position in space', 'मूल आकृतियाँ और स्थान में सापेक्ष स्थिति पहचानता है'],
  ['C-8.9', 'Simple measurement of length, weight and volume', 'लंबाई, भार व आयतन का सरल मापन'],
  ['C-8.10', 'Simple measurement of time', 'समय का सरल मापन'],
  ['C-8.11', 'Simple transactions with money up to ₹100', '₹100 तक के पैसों का सरल लेन-देन'],
  ['C-8.12', 'Vocabulary for quantities, shapes, space and measurement', 'मात्रा, आकृति, स्थान व मापन की शब्दावली'],
  ['C-8.13', 'Formulates and solves simple problems', 'सरल गणितीय समस्याएँ बनाता और हल करता है'],
];

/** ASER 2024 "Performance of districts", Uttar Pradesh rural, page 2. Parsed from the file and checked against these. */
const ASER_EXPECTED = {
  'DST-01': [38.6, 5.5, 41.8, 48.4, 64.8, 42.2],
  'DST-02': [41.8, 4.7, 54.7, 52.8, 72.5, 45.1],
  'DST-03': [49.6, 2.4, 61.0, 62.6, 75.8, 50.7],
  state: [49.1, 3.9, 46.5, 52.7, 68.8, 49.4],
};
const ASER_KEYS = ['govt_school_enrolment_6_14', 'not_in_school_6_14', 'std3_5_read_std2', 'std3_5_subtraction', 'std6_8_read_std2', 'std6_8_division'];

/** NFHS-5 (2019-21) district indicators kept for context, with NFHS-4 (2015-16) beside them where present. */
const NFHS_KEYS = [
  ['women_10plus_schooling', 'Women (15–49) with 10 or more years of schooling', '10 या अधिक वर्ष स्कूली शिक्षा वाली महिलाएँ (15–49)'],
  ['women_literate', 'Women (15–49) who are literate', 'साक्षर महिलाएँ (15–49)'],
  ['under5_stunted', 'Children under 5 who are stunted', 'ठिगनेपन से ग्रस्त 5 वर्ष से छोटे बच्चे'],
  ['population_electricity', 'Population living in households with electricity', 'बिजली वाले घरों में रहने वाली आबादी'],
];

/**
 * UP Samagra Shiksha PAB minutes 2025-26 (Internet Archive copy, 12 Jul 2025). Unit costs are
 * shown in lakh in the table (0.00165 lakh = ₹165). pdf_page is the page of the PDF file;
 * printed is the page number printed on it.
 */
const PAB_DOC = {
  title: 'Samagra Shiksha — Uttar Pradesh: minutes of the Project Approval Board, 2025-26',
  url: 'https://web.archive.org/web/20250712214637id_/https://dsel.education.gov.in/sites/default/files/pab/UP_PAB_Minutes_2025_26.pdf',
  file: 'UP_PAB_Minutes_2025_26.pdf',
};
const PAB_LINES = [
  { key: 'tlm_grade3', amount_inr: 165, unit: 'per child', pdf_page: 48, printed: '20 of 35', check: ['Elementary Head TLM (Grade III)', '0.00165'],
    line_en: 'Elementary Head TLM (Grade III): teaching-learning material for every child in Grades 3–5 of government schools', line_hi: 'प्रारंभिक TLM (कक्षा 3): सरकारी विद्यालयों में कक्षा 3–5 के हर बच्चे के लिए शिक्षण-अधिगम सामग्री' },
  { key: 'tlm_grade1_2', amount_inr: 165, unit: 'per child', pdf_page: 48, printed: '20 of 35', check: ['Grade 1 and 2', '0.00165'],
    line_en: 'TLM for pre-primary sections and Grades 1 and 2', line_hi: 'पूर्व-प्राथमिक और कक्षा 1–2 के लिए TLM' },
  { key: 'teacher_resource_3_5', amount_inr: 100, unit: 'per teacher', pdf_page: 48, printed: '20 of 35', check: ['Teacher Resource Material (Grade III', '0.00100'],
    line_en: 'Teacher Resource Material for teachers of Grades 3–5', line_hi: 'कक्षा 3–5 के शिक्षकों के लिए शिक्षक संसाधन सामग्री' },
  { key: 'fln_training_3_5', amount_inr: 1300, unit: 'per teacher', pdf_page: 48, printed: '20 of 35', check: ['Capacity building of Teachers of', '0.01300'],
    line_en: 'Capacity building (5-day training) of teachers of Grades 3–5', line_hi: 'कक्षा 3–5 के शिक्षकों का क्षमता संवर्धन (5 दिवसीय प्रशिक्षण)' },
  { key: 'library_primary', amount_inr: 2000, unit: 'per school', pdf_page: 47, printed: '19 of 35', check: ['Primary School (I – V)', '0.02000', 'Library Grant'],
    line_en: 'Library grant, primary school (Classes 1–5)', line_hi: 'पुस्तकालय अनुदान, प्राथमिक विद्यालय (कक्षा 1–5)' },
  { key: 'library_composite', amount_inr: 3000, unit: 'per school', pdf_page: 47, printed: '19 of 35', check: ['Composite Elementary School (I-VIII)', '0.03000'],
    line_en: 'Library grant, composite school (Classes 1–8)', line_hi: 'पुस्तकालय अनुदान, कंपोज़िट विद्यालय (कक्षा 1–8)' },
  { key: 'inservice_training', amount_inr: 1500, unit: 'per teacher', pdf_page: 47, printed: '19 of 35', check: ['Teacher Training for CWSN', '0.01500', 'In-Service'],
    line_en: 'In-service teacher training (5 days, regular teachers of Classes 1–8)', line_hi: 'सेवारत शिक्षक प्रशिक्षण (5 दिन, कक्षा 1–8 के नियमित शिक्षक)' },
  { key: 'community_mobilisation', amount_inr: 1500, unit: 'per school', pdf_page: 39, printed: '11 of 35', check: ['Community Mobilization', 'Rs. 1,500'],
    line_en: 'Community mobilisation, per school', line_hi: 'सामुदायिक सहभागिता, प्रति विद्यालय' },
  { key: 'smc_training', amount_inr: 3000, unit: 'per school', pdf_page: 39, printed: '11 of 35', check: ['Training of SMC/ SDMC', 'Rs. 3,000'],
    line_en: 'Training of the School Management Committee, per school', line_hi: 'विद्यालय प्रबंध समिति का प्रशिक्षण, प्रति विद्यालय' },
  { key: 'remedial_6_8', amount_inr: 500, unit: 'per child', pdf_page: 44, printed: '16 of 35', check: ['Remedial Teaching', '0.00500', 'Grades 6 to 8'],
    line_en: 'Learning Enhancement Programme (remedial teaching), sanctioned for Classes 6–8 only', line_hi: 'अधिगम संवर्धन कार्यक्रम (उपचारात्मक शिक्षण), केवल कक्षा 6–8 के लिए स्वीकृत' },
  { key: 'learning_assessment', amount_inr: 65, unit: 'per child', pdf_page: 45, printed: '17 of 35', check: ['Student learning Assessment', '0.00065'],
    line_en: 'Student learning assessment (board exams of Classes 5 and 8)', line_hi: 'विद्यार्थी अधिगम आकलन (कक्षा 5 व 8 की बोर्ड परीक्षा)' },
];
/**
 * Which card each line costs. basis 'pab': the line is for this kind of activity and these
 * classes. 'pab_proxy': the nearest line is for other classes or a longer activity; the rate is
 * used, and the card says so. Every other card keeps its illustrative cost.
 */
const CARD_COSTS = {
  'INT-01': { basis: 'pab_proxy', line: 'remedial_6_8', per: 'child_in_class',
    note_en: 'PAB rate for remedial teaching, which UP sanctions for Classes 6–8 only; there is no Class 1–3 line. Used as the nearest rate.',
    note_hi: 'उपचारात्मक शिक्षण की PAB दर, जो उत्तर प्रदेश में केवल कक्षा 6–8 के लिए स्वीकृत है; कक्षा 1–3 की कोई पंक्ति नहीं। निकटतम दर के रूप में प्रयुक्त।' },
  'INT-02': { basis: 'pab_proxy', line: 'remedial_6_8', per: 'child_in_class',
    note_en: 'PAB rate for remedial teaching, which UP sanctions for Classes 6–8 only; there is no Class 1–3 line. Used as the nearest rate.',
    note_hi: 'उपचारात्मक शिक्षण की PAB दर, जो उत्तर प्रदेश में केवल कक्षा 6–8 के लिए स्वीकृत है; कक्षा 1–3 की कोई पंक्ति नहीं। निकटतम दर के रूप में प्रयुक्त।' },
  'INT-05': { basis: 'pab', line: 'teacher_resource_3_5', per: 'teacher',
    note_en: 'PAB line for teacher resource material (the Grades 1–2 handbook line has the same ₹100). The half-day orientation has no line of its own.',
    note_hi: 'शिक्षक संसाधन सामग्री की PAB पंक्ति (कक्षा 1–2 की पुस्तिका की दर भी ₹100)। आधे दिन के अभिमुखीकरण की अलग पंक्ति नहीं है।' },
  'INT-06': { basis: 'pab', line: 'teacher_resource_3_5', per: 'teacher',
    note_en: 'PAB line for teacher resource material (the Grades 1–2 handbook line has the same ₹100). The orientation has no line of its own.',
    note_hi: 'शिक्षक संसाधन सामग्री की PAB पंक्ति (कक्षा 1–2 की पुस्तिका की दर भी ₹100)। अभिमुखीकरण की अलग पंक्ति नहीं है।' },
  'INT-08': { basis: 'pab', line: 'tlm_grade3', per: 'child_in_class',
    note_en: 'PAB TLM line, ₹165 a child (the same rate as the Grades 1–2 TLM line).',
    note_hi: 'PAB की TLM पंक्ति, ₹165 प्रति बच्चा (कक्षा 1–2 की TLM दर भी यही)।' },
  'INT-10': { basis: 'pab', line: 'community_mobilisation', per: 'school',
    note_en: 'PAB line for community mobilisation, per school.', note_hi: 'सामुदायिक सहभागिता की PAB पंक्ति, प्रति विद्यालय।' },
  'INT-14': { basis: 'pab_proxy', line: 'inservice_training', per: 'teacher',
    note_en: 'PAB rate for a 5-day in-service training; this card is a 2-day training, so the rate overstates it.',
    note_hi: '5 दिवसीय सेवारत प्रशिक्षण की PAB दर; यह कार्ड 2 दिन का प्रशिक्षण है, इसलिए दर अधिक आँकती है।' },
  'INT-15': { basis: 'pab_proxy', line: 'learning_assessment', per: 'child_in_class',
    note_en: 'PAB rate for one student assessment (the Class 5 and 8 board exams), applied once per child.',
    note_hi: 'एक विद्यार्थी आकलन की PAB दर (कक्षा 5 व 8 की बोर्ड परीक्षा), प्रति बच्चा एक बार।' },
  'INT-16': { basis: 'pab', line: 'library_primary', line_composite: 'library_composite', per: 'school',
    note_en: 'PAB library grant: ₹2,000 a primary school, ₹3,000 a composite (Class 1–8) school.',
    note_hi: 'PAB पुस्तकालय अनुदान: प्राथमिक विद्यालय ₹2,000, कंपोज़िट (कक्षा 1–8) विद्यालय ₹3,000।' },
};

// ------------------------------------------------------------------ helpers
const need = (p, what) => { if (!existsSync(p)) { console.error(`Missing ${what}: ${p}\nRun "npm run data:fetch" first.`); process.exit(1); } return p; };
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [h, ...body] = rows;
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const hash01 = (...xs) => parseInt(createHash('sha256').update(xs.join('|')).digest('hex').slice(0, 8), 16) / 0xffffffff;
const outer = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));
function inRing([x, y], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inside = (pt, g) => outer(g).some((r) => inRing(pt, r));
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

let pdfChecks = 0;
const pdfCache = new Map();
function pageText(file, page) {
  const k = `${file}#${page}`;
  if (!pdfCache.has(k)) {
    const out = execFileSync('python3', ['-I', join(APP, 'scripts', 'pdf-page-text.py'), file, String(page)], { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    pdfCache.set(k, JSON.parse(out)[String(page)].replace(/\s+/g, ' '));
  }
  return pdfCache.get(k);
}
function mustContain(file, page, needles) {
  const t = pageText(file, page);
  for (const s of needles) {
    if (!t.includes(String(s).replace(/\s+/g, ' '))) throw new Error(`${file.split('/').pop()} page ${page} does not contain "${s}"`);
    pdfChecks++;
  }
}
let canCheckPdf = true;
try { execFileSync('python3', ['-I', '-c', 'import pypdf'], { stdio: 'ignore' }); } catch { canCheckPdf = false; }

/** Assign points to groups of fixed sizes, close to each group's centre (capacitated k-means). */
function groupBySize(points, sizes, seeds) {
  const k = sizes.length;
  let centers = seeds.slice(0, k).map((s) => [...s]);
  while (centers.length < k) {
    // farthest point from the centres so far
    let best = null, bd = -1;
    for (const p of points) {
      const d = Math.min(...centers.map((c) => (c[0] - p.x) ** 2 + (c[1] - p.y) ** 2));
      if (d > bd) { bd = d; best = p; }
    }
    centers.push([best.x, best.y]);
  }
  let assign = new Array(points.length).fill(-1);
  for (let it = 0; it < 25; it++) {
    const pairs = [];
    points.forEach((p, i) => centers.forEach((c, j) => pairs.push([(c[0] - p.x) ** 2 + (c[1] - p.y) ** 2, i, j])));
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const left = [...sizes]; const next = new Array(points.length).fill(-1);
    for (const [, i, j] of pairs) { if (next[i] >= 0 || left[j] === 0) continue; next[i] = j; left[j]--; }
    const moved = next.some((v, i) => v !== assign[i]);
    assign = next;
    // the seeded first centre (the district town) stays put; the others follow their members
    centers = centers.map((c, j) => {
      if (j < seeds.length && seeds[j].fixed) return c;
      const m = points.filter((_, i) => assign[i] === j);
      return m.length ? [m.reduce((t, p) => t + p.x, 0) / m.length, m.reduce((t, p) => t + p.y, 0) / m.length] : c;
    });
    if (!moved) break;
  }
  return assign;
}

// ------------------------------------------------------------------ build
need(PRISTINE, 'the pristine demo database');
const geo = JSON.parse(readFileSync(need(GEO, 'the boundary file'), 'utf8'));
const lgdDistricts = parseCsv(readFileSync(need(join(SRC, 'lgd', 'lgd-districts.csv'), 'LGD districts'), 'utf8'));
const lgdBlocks = parseCsv(readFileSync(need(join(SRC, 'lgd', 'lgd-blocks.csv'), 'LGD blocks'), 'utf8'));
const db = new DatabaseSync(PRISTINE, { readOnly: true });
const demoSchools = db.prepare(`select s.id, s.district_id, s.block_id, s.cluster_id, s.category, s.enrolment_g1 g1, s.enrolment_g2 g2, s.enrolment_g3 g3
  from schools s order by s.id`).all();
const demoBlocks = db.prepare('select id, district_id, name from blocks order by id').all();
const demoClusters = db.prepare('select id, block_id from clusters order by id').all();

const schoolsOut = {};
const report = {};
const MGMT = { 'Department of Education': 'state_govt', 'Local body': 'local_body' };
const CATEGORY = (r) => (n(r.class_to) >= 8 ? 'primary_upper_primary' : 'primary');

for (const D of DISTRICTS) {
  const lgdRow = lgdDistricts.find((r) => r.state_code === '9' && Number(r.district_code) === D.lgd);
  if (!lgdRow || lgdRow.district_name !== D.name) throw new Error(`LGD district ${D.lgd} is not ${D.name} (${lgdRow?.district_name})`);
  const outline = geo.districts.find((x) => x.name === D.name)?.geometry;
  if (!outline) throw new Error(`no outline for ${D.name}`);
  const city = geo.cities.find((c) => c.district === D.name);
  const rows = parseCsv(readFileSync(need(join(SRC, 'udise', D.file), `UDISE+ ${D.name}`), 'utf8'));
  const wrong = rows.filter((r) => Number(r.district_code) !== D.lgd || r.state_code !== '09');
  if (wrong.length) throw new Error(`${D.name}: ${wrong.length} rows carry another district code`);
  const blockNames = new Map(lgdBlocks.filter((b) => Number(b.district_code) === D.lgd).map((b) => [Number(b.block_code), b.block_name]));

  const lat0 = Math.cos((((outline.type === 'Polygon' ? outline.coordinates[0] : outline.coordinates[0][0])[0][1]) * Math.PI) / 180);
  const pool = rows
    .filter((r) => MGMT[r.management] && n(r.class_from) === 1 && n(r.class_to) >= 5)
    .map((r) => ({ r, lon: n(r.longitude), lat: n(r.latitude), g123: n(r.i_students) + n(r.ii_students) + n(r.iii_students), type: CATEGORY(r) }))
    .filter((p) => p.g123 > 0 && p.lon && p.lat && inside([p.lon, p.lat], outline))
    .map((p) => ({ ...p, x: p.lon * lat0, y: p.lat }));
  const demo = demoSchools.filter((s) => s.district_id === D.id);
  const demoType = (s) => (s.category === 'primary' ? 'primary' : 'primary_upper_primary');
  const needP = demo.filter((s) => demoType(s) === 'primary').length;
  const needC = demo.length - needP;
  const bySize = (a, b) => b.g123 - a.g123 || a.r.udise_school_code.localeCompare(b.r.udise_school_code);
  const prim = pool.filter((p) => p.type === 'primary').sort(bySize);
  const comp = pool.filter((p) => p.type !== 'primary').sort(bySize);
  let chosen = [...prim.slice(0, needP), ...comp.slice(0, needC)];
  if (chosen.length < demo.length) {
    const rest = [...prim.slice(needP), ...comp.slice(needC)].sort(bySize);
    chosen = [...chosen, ...rest.slice(0, demo.length - chosen.length)];
  }
  if (chosen.length < demo.length) throw new Error(`${D.name}: only ${chosen.length} eligible schools for ${demo.length} demo schools`);

  // blocks: the first takes the district town
  const blocks = demoBlocks.filter((b) => b.district_id === D.id);
  const sizes = blocks.map((b) => demo.filter((s) => s.block_id === b.id).length);
  const seeds = city ? [Object.assign([city.center[0] * lat0, city.center[1]], { fixed: true })] : [];
  const bAssign = groupBySize(chosen, sizes, seeds);
  const matched = new Map();
  blocks.forEach((b, bi) => {
    const pts = chosen.filter((_, i) => bAssign[i] === bi);
    const clusters = demoClusters.filter((c) => c.block_id === b.id);
    const csz = clusters.map((c) => demo.filter((s) => s.cluster_id === c.id).length);
    const cAssign = groupBySize(pts, csz, []);
    clusters.forEach((c, ci) => {
      const real = pts.filter((_, i) => cAssign[i] === ci);
      const mine = demo.filter((s) => s.cluster_id === c.id).sort((a, b2) => (b2.g1 + b2.g2 + b2.g3) - (a.g1 + a.g2 + a.g3) || a.id.localeCompare(b2.id));
      const used = new Set();
      for (const s of mine) {
        let best = -1, bc = Infinity;
        real.forEach((p, i) => {
          if (used.has(i)) return;
          const cost = (p.type === demoType(s) ? 0 : 1e6) + Math.abs(p.g123 - (s.g1 + s.g2 + s.g3)) + Math.abs(n(p.r.iii_students) - s.g3);
          if (cost < bc) { bc = cost; best = i; }
        });
        used.add(best);
        matched.set(s.id, real[best]);
      }
    });
  });

  let typeMismatch = 0, g3Gap = 0;
  for (const s of demo) {
    const p = matched.get(s.id);
    if (!p) throw new Error(`${s.id} unmatched`);
    if (p.type !== demoType(s)) typeMismatch++;
    g3Gap += Math.abs(n(p.r.iii_students) - s.g3);
    // move the pin a few hundred metres, the same way every build
    let pt = null;
    for (let t = 0; t < 12 && !pt; t++) {
      const a = (hash01(s.id, 'angle', t) * 2 * Math.PI);
      const m = JITTER_M[0] + hash01(s.id, 'dist', t) * (JITTER_M[1] - JITTER_M[0]);
      const cand = [p.lon + (m / 111320 / lat0) * Math.cos(a), p.lat + (m / 110540) * Math.sin(a)].map((v) => Math.round(v * 1e5) / 1e5);
      if (inside(cand, outline)) pt = cand;
    }
    const r = p.r;
    const enr = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'].map((c) => n(r[`${c}_students`]));
    schoolsOut[s.id] = {
      pos: pt ?? [Math.round(p.lon * 1e3) / 1e3, Math.round(p.lat * 1e3) / 1e3],
      mgmt: MGMT[r.management],
      cat: p.type,
      loc: r.location_type === 'Urban' ? 'urban' : 'rural',
      enr,
      teachers: n(r.total_teachers),
      rooms: n(r.class_rooms),
    };
  }
  const blockCoded = rows.filter((r) => blockNames.has(Number(r.subdistrict_code))).length;
  report[D.id] = {
    name: D.name, lgd_district: D.lgd,
    udise_rows: rows.length,
    udise_rows_with_lgd_block: blockCoded,
    lgd_blocks: [...blockNames.values()].sort(),
    government_class_1_5: pool.length,
    outside_outline_or_no_position: rows.filter((r) => MGMT[r.management] && n(r.class_from) === 1 && n(r.class_to) >= 5 && !inside([n(r.longitude), n(r.latitude)], outline)).length,
    used: demo.length,
    type_mismatches: typeMismatch,
    mean_class3_gap: Math.round((g3Gap / demo.length) * 10) / 10,
  };
  console.log(`${D.name}: ${rows.length} UDISE+ rows (${blockCoded} with an LGD block code), ${pool.length} government Class 1–5 schools, ${demo.length} used; type mismatches ${typeMismatch}, mean Class 3 enrolment gap ${report[D.id].mean_class3_gap}`);
}

// ------------------------------------------------------------------ figures
const nfhsRows = parseCsv(readFileSync(need(join(SRC, 'nfhs', 'nfhs-district.csv'), 'NFHS'), 'utf8'));
const nfhsOf = (lgd, year) => nfhsRows.find((r) => r.state_code === '09' && Number(r.district_code) === lgd && r.year === year);

const aserFile = need(join(SRC, 'aser', 'Uttar-Pradesh_District-Estimates.pdf'), 'ASER');
function aserRow(name) {
  if (!canCheckPdf) return null;
  const t = pageText(aserFile, 2);
  const m = t.match(new RegExp(`${name} ((?:\\d+\\.\\d ){5}\\d+\\.\\d)`));
  return m ? m[1].split(' ').map(Number) : null;
}

const districts = {};
for (const D of DISTRICTS) {
  const prs = PRS[D.id];
  const pdf = join(SRC, 'parakh', D.pdf);
  if (canCheckPdf) {
    mustContain(pdf, 15, ['FOUNDATION', 'PERFORMANCE IN LANGUAGE', 'PERFORMANCE IN MATHEMATICS', prs.language, prs.mathematics, PRS_STATE.language, PRS_NATIONAL.mathematics,
      prs.participation.schools, prs.participation.teachers, prs.participation.students]);
    mustContain(pdf, 18, ['FOUNDATION STAGE', 'Competencies in Language', ...PRS_LANG.map((c) => c[0]), ...PRS_MATH.map((c) => c[0]),
      ...prs.lang_comp.map((v, i) => `${v} ${PRS_STATE.lang_comp[i]}`)]);
  }
  const aser = aserRow(D.name);
  if (aser && aser.join() !== ASER_EXPECTED[D.id].join()) throw new Error(`ASER ${D.name}: file says ${aser}, expected ${ASER_EXPECTED[D.id]}`);
  const n5 = nfhsOf(D.lgd, '2019-21'), n4 = nfhsOf(D.lgd, '2015-16');
  if (!n5) throw new Error(`NFHS-5 row missing for ${D.name}`);
  districts[D.id] = {
    name: D.name, lgd_code: D.lgd, prs_code: D.prs,
    prs: {
      language: prs.language, mathematics: prs.mathematics,
      state: { language: PRS_STATE.language, mathematics: PRS_STATE.mathematics }, national: PRS_NATIONAL,
      participation: prs.participation,
      competencies: {
        language: PRS_LANG.map(([code, en, hi], i) => ({ code, en, hi, district: prs.lang_comp[i], state: PRS_STATE.lang_comp[i] })),
        mathematics: PRS_MATH.map(([code, en, hi], i) => ({ code, en, hi, district: prs.math_comp[i], state: PRS_STATE.math_comp[i] })),
      },
      pages: { overall: { pdf: 15, printed: '01' }, competencies: { pdf: 18, printed: '04' } },
      url: `https://parakh.ncert.gov.in/media/public_files/2025-08/${D.pdf}`,
    },
    aser: { ...Object.fromEntries(ASER_KEYS.map((k, i) => [k, ASER_EXPECTED[D.id][i]])), page: 2, verified_from_file: !!aser },
    nfhs: Object.fromEntries(NFHS_KEYS.map(([k, en, hi]) => [k, { en, hi, nfhs5: n5[k] === '' ? null : Number(n5[k]), nfhs4: n4 && n4[k] !== '' ? Number(n4[k]) : null }])),
    udise: report[D.id],
  };
}
const aserState = aserRow('Uttar Pradesh');
if (aserState && aserState.join() !== ASER_EXPECTED.state.join()) throw new Error(`ASER state row: ${aserState}`);

const pabFile = join(SRC, 'pab', PAB_DOC.file);
if (canCheckPdf) for (const l of PAB_LINES) mustContain(pabFile, l.pdf_page, [...l.check, `Page no ${l.printed}`]);
const lines = Object.fromEntries(PAB_LINES.map(({ check, ...l }) => [l.key, l]));
const cards = Object.fromEntries(Object.entries(CARD_COSTS).map(([id, c]) => {
  const l = lines[c.line];
  const lc = c.line_composite ? lines[c.line_composite] : null;
  return [id, { ...c, amount_inr: l.amount_inr, amount_composite_inr: lc?.amount_inr ?? null, unit: l.unit, pdf_page: l.pdf_page, printed: l.printed }];
}));

const figures = {
  about: 'Published figures used by the demo, with page references. Built by scripts/build-real-data.mjs from the files in .data/sources/ (not committed).',
  built: new Date().toISOString().slice(0, 10),
  pdf_checks: canCheckPdf ? pdfChecks : 'skipped (python3 with pypdf not available)',
  districts,
  state: { name: 'Uttar Pradesh', prs: { language: PRS_STATE.language, mathematics: PRS_STATE.mathematics },
    aser: Object.fromEntries(ASER_KEYS.map((k, i) => [k, ASER_EXPECTED.state[i]])) },
  pab: { ...PAB_DOC, revision_url: 'https://web.archive.org/web/20250712222733id_/https://dsel.education.gov.in/sites/default/files/pab/PAB_minutes_revision_UP.pdf', lines, cards },
  calibration: { anchor_round: 'RND-2025-02', grade: 3, note: 'PRS 2024 was held in December 2024; the demo round nearest to it is R0, February 2025.' },
};

const schoolsFile = {
  about: 'For each demo school id, the real UDISE+ 2020-21 school (India Data Portal, ODC-BY) it stands for. Names, UDISE codes and villages are deliberately not stored. Positions are moved 300–700 m.',
  built: new Date().toISOString().slice(0, 10),
  fields: { pos: '[lon, lat], moved 300–700 m', mgmt: 'state_govt | local_body', cat: 'primary | primary_upper_primary', loc: 'rural | urban', enr: 'enrolment, Classes 1–8', teachers: 'total teachers', rooms: 'classrooms' },
  schools: schoolsOut,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'schools.json'), JSON.stringify(schoolsFile));
writeFileSync(join(OUT, 'figures.json'), JSON.stringify(figures, null, 1));
console.log(`Wrote data/real/schools.json (${Object.keys(schoolsOut).length} schools) and data/real/figures.json; ${canCheckPdf ? `${pdfChecks} figures checked against their PDF pages` : 'PDF checks skipped (no pypdf)'}.`);
