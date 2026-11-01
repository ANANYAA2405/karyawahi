/**
 * Reading and checking an assessment-results CSV. Pure: no database, no session.
 *
 * The write layer (write-import.ts) gathers the facts this needs — the school register, the
 * uploader's area, the rows already on record for the round — and hands them in. Keeping the
 * checks free of I/O means the preview and the commit run exactly the same code, and the
 * import test can exercise every rule without a server.
 *
 * Every refused row gets one of the rejection codes the seed already uses
 * (import_rejected_rows.error_code), checked in this order; the first failure wins:
 *
 *   missing_required             a required value is blank, or is not a value the register
 *                                recognises (round, grade 1–3, competency L1–L3 / N1–N3)
 *   non_numeric                  grade, enrolled, n_assessed or n_proficient is not a whole number
 *   unknown_school_id            the school is not in the register, or not in the uploader's area
 *   invalid_date                 assessment_date is unreadable, outside the round window, or in
 *                                the future on the demo clock
 *   proficient_exceeds_assessed  more children met the benchmark than were assessed
 *   duplicate_row                the same school + grade + competency appears earlier in the
 *                                file, or is already on record for this round
 */

export const REQUIRED_COLUMNS = [
  'round_code', 'school_id', 'grade', 'competency_code', 'enrolled', 'n_assessed', 'n_proficient',
] as const;
export const OPTIONAL_COLUMNS = ['assessment_date'] as const;

export type RejectCode =
  | 'missing_required' | 'non_numeric' | 'unknown_school_id' | 'invalid_date'
  | 'proficient_exceeds_assessed' | 'duplicate_row';

export interface SchoolRef { id: string; cluster_id: string; block_id: string; district_id: string; state_id: string }

export interface ValidateContext {
  round: { id: string; code: string; window_start: string; window_end: string };
  /** The demo clock's date, YYYY-MM-DD. Rows dated after it are refused. */
  today: string;
  schools: Map<string, SchoolRef>;
  /** competency code (L1) -> competency id (CMP-L1) */
  competencies: Map<string, string>;
  /** Whether the uploader may submit data for this school. */
  inArea: (school: SchoolRef) => boolean;
  /** A plain-words name for the uploader's area, used in messages. */
  areaName: string;
  /** "school|grade|competency_id" already on record for this round -> the batch that holds it. */
  existing: Map<string, string>;
  /** Below this participation a row is kept but flagged (settings.detection.min_participation). */
  minParticipation: number;
}

export interface AcceptedRow {
  row_number: number;
  school_id: string; grade: number; competency_id: string;
  enrolled: number; n_assessed: number; n_proficient: number;
  pct_proficient: number; participation_rate: number; dq_flags: string[];
}

export interface RejectedRow { row_number: number; raw: Record<string, string>; error_code: RejectCode; message: string }

export interface ValidateResult {
  /** Set when the file as a whole cannot be read (no header, a required column missing, no rows). */
  fatal: string | null;
  header: string[];
  accepted: AcceptedRow[];
  rejected: RejectedRow[];
  warnings: number;
}

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // Drop blank lines (a trailing newline, an empty line in the middle).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const WHOLE = /^\d+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function realDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The round code the file declares, taken from its first data row. */
export function declaredRoundCode(text: string): string | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = header.indexOf('round_code');
  if (at < 0) return null;
  return rows[1][at]?.trim() || null;
}

export function validateRoundCsv(text: string, ctx: ValidateContext): ValidateResult {
  const rows = parseCsv(text);
  const empty = (fatal: string, header: string[] = []): ValidateResult =>
    ({ fatal, header, accepted: [], rejected: [], warnings: 0 });
  if (rows.length === 0) return empty('The file is empty.');

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return empty(
      `Required column${missing.length === 1 ? '' : 's'} ${missing.map((m) => `"${m}"`).join(', ')} missing; ` +
      'the file does not follow the assessment template. Nothing was committed.',
      header,
    );
  }
  if (rows.length < 2) return empty('The file has a header but no data rows.', header);

  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  const accepted: AcceptedRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Map<string, number>();
  let warnings = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNumber = i + 1; // the header is row 1, as in a spreadsheet
    const raw: Record<string, string> = {};
    for (const h of header) if (h) raw[h] = col(r, h);
    const reject = (error_code: RejectCode, message: string) => { rejected.push({ row_number: rowNumber, raw, error_code, message }); };

    // 1. blanks
    const blank = REQUIRED_COLUMNS.find((c) => raw[c] === '' || raw[c] === undefined);
    if (blank) { reject('missing_required', `${blank} is blank`); continue; }

    // 2. numbers
    const notNumber = (['grade', 'enrolled', 'n_assessed', 'n_proficient'] as const).find((c) => !WHOLE.test(raw[c]));
    if (notNumber) { reject('non_numeric', `${notNumber} is not a number ("${raw[notNumber]}")`); continue; }
    const grade = Number(raw.grade);
    const enrolled = Number(raw.enrolled);
    const nA = Number(raw.n_assessed);
    const nP = Number(raw.n_proficient);

    // 3. values the register must recognise
    if (raw.round_code !== ctx.round.code) {
      reject('missing_required', `round_code "${raw.round_code}" does not match the round being imported (${ctx.round.code})`);
      continue;
    }
    if (grade < 1 || grade > 3) { reject('missing_required', `grade ${grade} is not assessed (grades 1–3 only)`); continue; }
    const competencyId = ctx.competencies.get(raw.competency_code.toUpperCase());
    if (!competencyId) {
      reject('missing_required', `competency_code "${raw.competency_code}" is not a known competency (${[...ctx.competencies.keys()].join(', ')})`);
      continue;
    }

    // 4. the school, and whether this uploader may report it
    const school = ctx.schools.get(raw.school_id);
    if (!school) { reject('unknown_school_id', 'School ID not found in the school master'); continue; }
    if (!ctx.inArea(school)) {
      reject('unknown_school_id', `School ${raw.school_id} is not in the school register for your area (${ctx.areaName})`);
      continue;
    }

    // 5. the date, when given
    const date = raw.assessment_date ?? '';
    if (date !== '') {
      if (!realDate(date)) { reject('invalid_date', `assessment_date "${date}" is not a valid date`); continue; }
      if (date < ctx.round.window_start || date > ctx.round.window_end) {
        reject('invalid_date', `assessment_date ${date} is outside the ${ctx.round.code} window (${ctx.round.window_start} to ${ctx.round.window_end})`);
        continue;
      }
      if (date > ctx.today) { reject('invalid_date', `assessment_date ${date} is in the future (today is ${ctx.today})`); continue; }
    }

    // 6. arithmetic
    if (nP > nA) { reject('proficient_exceeds_assessed', 'n_proficient is greater than n_assessed'); continue; }

    // 7. duplicates — within the file, then against what is already on record
    const key = `${school.id}|${grade}|${competencyId}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      reject('duplicate_row', `Duplicate of row ${earlier} (same school, grade, competency, round)`);
      continue;
    }
    const onRecord = ctx.existing.get(key);
    if (onRecord) {
      reject('duplicate_row', `Already on record for ${ctx.round.code} (batch ${onRecord}); a correction needs a reviewed re-upload, not a second copy`);
      continue;
    }
    seen.set(key, rowNumber);

    // Accepted. Suspicious but possible values are kept and flagged, as the seed does.
    const participation = enrolled > 0 ? nA / enrolled : 0;
    const pct = nA > 0 ? (nP / nA) * 100 : 0;
    const flags: string[] = [];
    if (participation < ctx.minParticipation) flags.push('low_participation');
    if (nA > enrolled || (nA >= 10 && pct >= 97)) flags.push('suspicious_high_score');
    if (flags.length > 0) warnings++;
    accepted.push({
      row_number: rowNumber, school_id: school.id, grade, competency_id: competencyId,
      enrolled, n_assessed: nA, n_proficient: nP,
      pct_proficient: r1(pct), participation_rate: r3(participation), dq_flags: flags,
    });
  }

  return { fatal: null, header, accepted, rejected, warnings };
}

/** Count of refused rows by code, most common first. */
export function countByCode(rows: readonly RejectedRow[]): { code: RejectCode; count: number; example: string }[] {
  const m = new Map<RejectCode, { count: number; example: string }>();
  for (const r of rows) {
    const e = m.get(r.error_code) ?? { count: 0, example: r.message };
    e.count++;
    m.set(r.error_code, e);
  }
  return [...m.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count);
}
