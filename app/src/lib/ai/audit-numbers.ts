import 'server-only';
import { ID_RE } from './chat';

/**
 * The auditor pass: every figure Claude writes must come from the data it was given.
 *
 * Code computes every number in Karyavahi; Claude only narrates. This checks that promise after
 * the fact, without a second model: pull each figure out of Claude's text and look for it in the
 * data the draft was built from (the JSON bundle, the tool results, the user's own question).
 * A figure that is not there is "unsupported" — Claude computed or invented it — and the draft is
 * sent back once, then shown with those figures marked if it still uses them.
 *
 * What counts as a figure: decimals, percentages, signed changes, anything with a unit of
 * learning ("pp", "points", "%"), and any whole number above ten. Small counts written alone
 * ("3 schools", "Class 3", "2 days") are not checked: they are how sentences are built, and the
 * risk of a wrong small count is low next to a wrong percentage. Record ids, dates and years are
 * removed before checking.
 */

export interface NumberAudit {
  /** Figures found in the text and checked against the data. */
  checked: number;
  /** Figures in the text that the data does not contain, as written. */
  unsupported: string[];
}

const DEVANAGARI = /[०-९]/g;
const toLatinDigits = (s: string) => s.replace(DEVANAGARI, (d) => String(d.charCodeAt(0) - 0x0966));

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_RES = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/gi,                          // 2026-10-24, ISO timestamps
  new RegExp(`\\b\\d{1,2}\\s+${MONTHS}\\.?(?:\\s+\\d{4})?\\b`, 'gi'),     // 24 Oct, 24 October 2026
  new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, 'gi'),   // Oct 24, 2026
  /\b\d{1,2}:\d{2}\b/g,                                                  // 12:00
  /\b(?:19|20)\d{2}(?:[-–]\d{2,4})?\b/g,                                 // 2026, 2025-26
  /\b(?:R\d|INT-\d{2})\b/g,                                              // round codes, intervention codes
];

/** A figure as written and its numeric value. */
interface Figure { raw: string; value: number; checkable: boolean }

const FIGURE_RE = /([+\-−–]?\d[\d,]*(?:\.\d+)?)(\s*(?:%|pp\b|pts?\b|points?\b|percent\b|प्रतिशत|अंक))?/gi;

function figuresIn(text: string): Figure[] {
  let t = toLatinDigits(text).replace(ID_RE, ' ');
  for (const re of DATE_RES) t = t.replace(re, ' ');
  const out: Figure[] = [];
  for (const m of t.matchAll(FIGURE_RE)) {
    const raw = m[0].trim();
    const num = Number(m[1].replace(/[−–]/g, '-').replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    const hasUnit = Boolean(m[2]);
    const isDecimal = m[1].includes('.');
    const signed = /^[+\-−–]/.test(m[1]);
    out.push({ raw, value: num, checkable: hasUnit || isDecimal || signed || Math.abs(num) > 10 });
  }
  return out;
}

/** Every number the data holds: JSON numbers, and numbers written inside its strings. */
function numbersIn(sources: unknown[]): number[] {
  const found: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') { if (Number.isFinite(v)) found.push(v); return; }
    if (typeof v === 'string') { for (const f of figuresIn(v)) found.push(f.value); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  sources.forEach(walk);
  return found;
}

/** Does the data hold this figure, allowing for rounding, sign words and 0.855 ↔ 85.5%? */
function supported(value: number, pool: number[]): boolean {
  const a = Math.abs(value);
  return pool.some((p) => {
    const b = Math.abs(p);
    for (const c of [b, b * 100, b / 100]) {
      if (Math.abs(c - a) < 1e-9) return true;
      // Rounded for writing: 17.94 → 17.9 or 18; 0.8551 → 85.5%.
      const decimals = (String(a).split('.')[1] ?? '').length;
      if (Number(c.toFixed(decimals)) === a) return true;
    }
    return false;
  });
}

export function auditNumbers(text: string, sources: unknown[]): NumberAudit {
  const figures = figuresIn(text).filter((f) => f.checkable);
  if (figures.length === 0) return { checked: 0, unsupported: [] };
  const pool = numbersIn(sources);
  const unsupported = [...new Set(figures.filter((f) => !supported(f.value, pool)).map((f) => f.raw))];
  return { checked: figures.length, unsupported };
}
