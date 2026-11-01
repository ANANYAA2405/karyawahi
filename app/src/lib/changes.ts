import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localPath } from './http';
import type { RoleCode } from '@domain/types';

/**
 * "What we changed after testing": the improvements made because of user input, read from the
 * committed file app/data/changes.json (see docs/user-testing/analysis.md for how to add one).
 *
 * The file is read on every request, so an entry added there shows up without a rebuild. A
 * malformed entry is skipped rather than breaking the page, and a link is kept only when it
 * points at a page on this site.
 */

export interface ChangeEntry {
  id: string;
  date: string;
  placeholder: boolean;
  said: string;
  said_hi: string | null;
  who: string;
  who_hi: string | null;
  roles: RoleCode[];
  changed: string;
  changed_hi: string | null;
  link: string | null;
  feedback_ids: string[];
  session_refs: string[];
}

const ROLES: RoleCode[] = ['beo', 'brc', 'crc', 'headmaster', 'deo', 'state_admin', 'auditor', 'demo_admin'];
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown, re: RegExp): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && re.test(x)) : []);

export function loadChanges(file = join(process.cwd(), 'data', 'changes.json')): { entries: ChangeEntry[]; skipped: number } {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return { entries: [], skipped: 0 }; }
  const list = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return { entries: [], skipped: 0 };
  const entries: ChangeEntry[] = [];
  let skipped = 0;
  for (const e of list as Record<string, unknown>[]) {
    const date = str(e?.date);
    const said = str(e?.said);
    const changed = str(e?.changed);
    if (!e || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !said || !changed) { skipped++; continue; }
    const link = str(e.link);
    entries.push({
      id: str(e.id) ?? `CHG-${entries.length + 1}`,
      date,
      placeholder: e.placeholder === true,
      said,
      said_hi: str(e.said_hi),
      who: str(e.who) ?? '',
      who_hi: str(e.who_hi),
      roles: strs(e.roles, /^[a-z_]+$/).filter((r): r is RoleCode => (ROLES as string[]).includes(r)),
      changed,
      changed_hi: str(e.changed_hi),
      link: link ? (localPath(link, '') || null) : null,
      feedback_ids: strs(e.feedback_ids, /^FBK-\d{6}$/),
      session_refs: strs(e.session_refs, /^[A-Za-z0-9_-]{1,40}$/),
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || Number(a.placeholder) - Number(b.placeholder));
  return { entries, skipped };
}
