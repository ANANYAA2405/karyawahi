import 'server-only';
import { createHash } from 'node:crypto';
import { all, one, run, tx, db, nextId } from './db';
import { Refused, actingRole, may } from './guard';
import type { Session } from './session';
import { nowIso, today } from './clock';
import { appendAudit, notify, recordJob, addCaseEvent } from './write';
import { settingVersions, scopeName } from './repo';
import { grantFor } from '@domain/permissions';
import { detectFindings, type DetectRow } from '@domain/detect';
import { SIM_MODEL } from '@domain/catalog';
import type { SettingVersion, Severity } from '@domain/types';
import {
  validateRoundCsv, declaredRoundCode, countByCode,
  type SchoolRef, type ValidateContext, type RejectedRow, type ValidateResult,
} from './import-csv';

/**
 * Bringing an assessment round in, and the detection run that follows it.
 *
 * Part of the write layer: the same order of checks as write.ts —
 *
 *   signed in → role may import (refusal audited) → the round exists and its window has opened
 *   (refusal audited) → every row checked against the register and the uploader's own area →
 *   the same file twice adds nothing → commit as one batch with its refused rows → detection
 *
 * Nothing here trusts the browser. The preview and the commit both re-read the file text and
 * re-run every check; the commit also confirms the file is the one that was previewed.
 *
 * Demo clock. A round can be imported once its assessment window has OPENED on the demo clock
 * (results arrive school by school during the window), and any row dated after "today" is
 * refused as invalid_date. R4 (Midline 2026-27) opens on 16 Nov 2026 while the seed's clock
 * stands at 24 Oct 2026, so the demo admin moves the clock to 20 Nov first — the same step the
 * seed's README describes for the November round.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** The fingerprint ignores a BOM and line-ending style, so a re-saved copy is still "the same file". */
export const fileFingerprint = (text: string) => sha(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trimEnd());

const PROV = 'user_uploaded';

// ------------------------------------------------------------------ who may import what
interface Area { type: 'state' | 'district' | 'block'; id: string; name: string }

/** The areas this user may import for: every role assignment whose role holds data.import. */
function importAreas(s: Session): Area[] {
  return s.roles
    .filter((r) => grantFor(r.role, 'data.import') !== 'no')
    .filter((r) => r.scope_type === 'state' || r.scope_type === 'district' || r.scope_type === 'block')
    .map((r) => ({ type: r.scope_type as Area['type'], id: r.scope_id, name: scopeName(r.scope_type, r.scope_id) }));
}

const RANK: Record<Area['type'], number> = { state: 0, district: 1, block: 2 };

function inAreas(areas: Area[], sc: SchoolRef): boolean {
  return areas.some((a) =>
    (a.type === 'state' && sc.state_id === a.id)
    || (a.type === 'district' && sc.district_id === a.id)
    || (a.type === 'block' && sc.block_id === a.id));
}

function refuse(s: Session, entityId: string, reason: string, code: string, message: string, stage: 'preview' | 'commit'): never {
  // Outside any transaction: the record of a refused attempt must survive the refusal.
  appendAudit({
    actorUserId: s.user_id, actorRole: actingRole(s), action: 'import.refused',
    entityType: 'assessment_round', entityId, reason, after: { stage }, source: 'import', result: 'failure',
  });
  throw new Refused(message, code);
}

// ------------------------------------------------------------------ rounds
export interface RoundInfo {
  id: string; code: string; label: string; window_start: string; window_end: string; status: string; import_date: string | null;
}

export const roundByCode = (code: string): RoundInfo | null =>
  one<RoundInfo>('select id, code, label, window_start, window_end, status, import_date from assessment_rounds where code = ?', code);

/** True once the round's assessment window has opened on the demo clock. */
export const roundIsOpen = (r: RoundInfo, onDate = today()): boolean => r.window_start <= onDate;

/** The detection settings version in force on a date, read from setting_versions like the seed's settingsAt(). */
export function settingsInForce(onDate = today()): SettingVersion {
  const versions = settingVersions();
  return [...versions].reverse().find((v) => v.effective_from <= onDate) ?? versions[0];
}

function contextFor(s: Session, round: RoundInfo): { ctx: ValidateContext; areas: Area[] } {
  const areas = importAreas(s);
  const schools = new Map(
    all<SchoolRef>('select id, cluster_id, block_id, district_id, state_id from schools').map((x) => [x.id, x]),
  );
  const competencies = new Map(all<{ code: string; id: string }>('select code, id from competencies').map((c) => [c.code, c.id]));
  const existing = new Map<string, string>();
  for (const r of all<{ school_id: string; grade: number; competency_id: string; import_batch_id: string }>(
    'select school_id, grade, competency_id, import_batch_id from assessment_results where round_id = ?', round.id,
  )) existing.set(`${r.school_id}|${r.grade}|${r.competency_id}`, r.import_batch_id);
  const widest = [...areas].sort((a, b) => RANK[a.type] - RANK[b.type])[0];
  return {
    areas,
    ctx: {
      round, today: today(), schools, competencies, existing,
      inArea: (sc) => inAreas(areas, sc),
      areaName: widest ? widest.name : 'none',
      minParticipation: settingsInForce().detection.min_participation,
    },
  };
}

/** The checks shared by preview and commit. Throws (audited) when the attempt is refused outright. */
function gate(s: Session, text: string, stage: 'preview' | 'commit'): { round: RoundInfo; areas: Area[]; result: ValidateResult; ctx: ValidateContext } {
  const code = declaredRoundCode(text);
  const round = code ? roundByCode(code) : null;
  if (!may(s, 'data.import')) {
    refuse(s, round?.id ?? 'unknown', `role ${actingRole(s)} may not import data`, 'role',
      `Your role (${s.roles.map((r) => r.role).join(', ')}) cannot import data. Block officers, DEOs and the state team import assessment rounds.`, stage);
  }
  if (!round) {
    const v = validateRoundCsv(text, {
      round: { id: '', code: '', window_start: '', window_end: '' }, today: today(), schools: new Map(),
      competencies: new Map(), inArea: () => false, areaName: '', existing: new Map(), minParticipation: 0,
    });
    if (v.fatal) throw new Refused(v.fatal, 'bad_file');
    throw new Refused(code ? `There is no assessment round "${code}".` : 'The file does not say which round it is for (round_code).', 'bad_input');
  }
  if (!roundIsOpen(round)) {
    refuse(s, round.id, `round window opens ${round.window_start}; demo clock is ${today()}`, 'round_not_open',
      `${round.code} (${round.label}) cannot be imported yet: its assessment window opens on ${round.window_start} and the demo clock says ${today()}. ` +
      'The demo administrator can move the clock forward (to 20 Nov 2026 for the midline round) from the admin page.', stage);
  }
  const { ctx, areas } = contextFor(s, round);
  return { round, areas, ctx, result: validateRoundCsv(text, ctx) };
}

function priorCommit(round: RoundInfo, areas: Area[], fingerprint: string): { import_batch_id: string; created_at: string; file_name: string } | null {
  for (const a of areas) {
    const hit = one<{ import_batch_id: string; created_at: string; file_name: string }>(
      `select import_batch_id, created_at, file_name from import_file_hashes
        where sha256 = ? and round_id = ? and scope_type = ? and scope_id = ?`,
      fingerprint, round.id, a.type, a.id,
    );
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ preview
export interface ImportPreview {
  fileName: string;
  fingerprint: string;
  round: RoundInfo;
  area: string;
  fatal: string | null;
  totalRows: number;
  accepted: number;
  rejected: number;
  warnings: number;
  schools: number;
  clusters: number;
  byCode: { code: string; count: number; example: string }[];
  sampleRejected: RejectedRow[];
  sampleAccepted: { row_number: number; school_id: string; grade: number; competency_id: string; n_assessed: number; n_proficient: number; pct_proficient: number }[];
  duplicateOf: { batchId: string; at: string; fileName: string } | null;
}

/** Validate without writing anything (apart from an audited refusal). */
export function previewRoundImport(s: Session, fileName: string, text: string): ImportPreview {
  const { round, areas, ctx, result } = gate(s, text, 'preview');
  const fingerprint = fileFingerprint(text);
  const prior = priorCommit(round, areas, fingerprint);
  const clusters = new Set(result.accepted.map((r) => ctx.schools.get(r.school_id)!.cluster_id));
  return {
    // node:sqlite rows have a null prototype, which React will not pass to a client component.
    fileName, fingerprint, round: { ...round }, area: ctx.areaName, fatal: result.fatal,
    totalRows: result.accepted.length + result.rejected.length,
    accepted: result.accepted.length, rejected: result.rejected.length, warnings: result.warnings,
    schools: new Set(result.accepted.map((r) => r.school_id)).size, clusters: clusters.size,
    byCode: countByCode(result.rejected),
    sampleRejected: result.rejected.slice(0, 30),
    sampleAccepted: result.accepted.slice(0, 6).map(({ row_number, school_id, grade, competency_id, n_assessed, n_proficient, pct_proficient }) =>
      ({ row_number, school_id, grade, competency_id, n_assessed, n_proficient, pct_proficient })),
    duplicateOf: prior ? { batchId: prior.import_batch_id, at: prior.created_at, fileName: prior.file_name } : null,
  };
}

// ------------------------------------------------------------------ commit
export interface CommitResult {
  batchId: string | null;
  status: 'committed' | 'committed_with_rejections' | 'failed' | 'duplicate';
  accepted: number;
  rejected: number;
  duplicateOf: { batchId: string; at: string } | null;
  detection: DetectionSummary | null;
}

/** Make sure a counter in app_sequences is at least the largest id already in a seeded table. */
function seqFloor(name: string, table: 'import_batches' | 'import_rejected_rows' | 'assessment_results' | 'findings' | 'cases' | 'diagnoses', prefix: string): void {
  const max = one<{ m: number | null }>(
    `select max(cast(substr(id, ?) as integer)) m from ${table} where id like ?`, prefix.length + 1, `${prefix}%`,
  )?.m ?? 0;
  run(
    `insert into app_sequences (name, value) values (?, ?)
     on conflict(name) do update set value = max(value, excluded.value)`,
    name, max,
  );
}

/** Reserve n consecutive values of a counter in one step (a 37,000-row file would otherwise take 74,000 statements). */
function reserve(name: string, n: number): number {
  const start = (one<{ value: number }>('select value from app_sequences where name = ?', name)?.value ?? 0) + 1;
  run('update app_sequences set value = ? where name = ?', start + n - 1, name);
  return start;
}

export function commitRoundImport(
  s: Session, fileName: string, text: string, expectedFingerprint?: string,
): CommitResult {
  const { round, areas, result } = gate(s, text, 'commit');
  const fingerprint = fileFingerprint(text);
  if (expectedFingerprint && expectedFingerprint !== fingerprint) {
    throw new Refused('The file is not the one that was previewed. Preview it again before committing.', 'stale');
  }
  const role = actingRole(s);
  const area = [...areas].sort((a, b) => RANK[a.type] - RANK[b.type])[0];
  const name = (fileName || 'upload.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 120);

  // The same file twice adds nothing. Recorded, so the second attempt is visible in the audit.
  const prior = priorCommit(round, areas, fingerprint);
  if (prior) {
    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: 'import.duplicate_ignored',
      entityType: 'import_batch', entityId: prior.import_batch_id,
      after: { file_name: name, sha256: fingerprint, round: round.code }, source: 'import',
      reason: 'identical file already committed for this round and area',
    });
    return { batchId: prior.import_batch_id, status: 'duplicate', accepted: 0, rejected: 0, duplicateOf: { batchId: prior.import_batch_id, at: prior.created_at }, detection: null };
  }

  const committed = tx(() => {
    seqFloor('import_batch', 'import_batches', 'IMP-');
    seqFloor('import_rejected_row', 'import_rejected_rows', 'REJ-');
    seqFloor('assessment_result', 'assessment_results', 'RES-');
    const batchId = nextId('import_batch', 'IMP-', 4);
    const now = nowIso();
    const accepted = result.accepted.length;
    const rejected = result.rejected.length;
    const status = result.fatal || accepted === 0 ? 'failed' : rejected > 0 ? 'committed_with_rejections' : 'committed';
    const summary = result.fatal
      ? result.fatal
      : accepted === 0 ? `All ${rejected} rows rejected (see error report); nothing was committed.`
      : rejected > 0 ? `${rejected} rows rejected (see error report); ${accepted} accepted.` : null;

    run(
      `insert into import_batches
        (id, dataset_id, file_name, scope_type, scope_id, round_id, uploaded_by, uploaded_at, status,
         total_rows, accepted_rows, rejected_rows, warnings, error_summary, committed_at, provenance)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      batchId, 'DS-02', name, area.type, area.id, round.id, s.user_id, now, status,
      accepted + rejected, status === 'failed' ? 0 : accepted, rejected, status === 'failed' ? 0 : result.warnings,
      summary, status === 'failed' ? null : now, PROV,
    );

    if (status !== 'failed') {
      const ins = db().prepare(
        `insert into assessment_results
          (id, round_id, school_id, grade, competency_id, metric_id, enrolled, n_assessed, n_proficient,
           pct_proficient, participation_rate, dq_flags, import_batch_id, provenance)
         values (?,?,?,?,?,'MET-PCT-PROF',?,?,?,?,?,?,?,?)`,
      );
      let n = reserve('assessment_result', result.accepted.length);
      for (const r of result.accepted) {
        ins.run(
          `RES-${String(n++).padStart(6, '0')}`, round.id, r.school_id, r.grade, r.competency_id,
          r.enrolled, r.n_assessed, r.n_proficient, r.pct_proficient, r.participation_rate,
          JSON.stringify(r.dq_flags), batchId, PROV,
        );
      }
    }
    const rej = db().prepare(
      'insert into import_rejected_rows (id, import_batch_id, row_number, raw, error_code, message) values (?,?,?,?,?,?)',
    );
    let k = reserve('import_rejected_row', result.rejected.length);
    for (const r of result.rejected) {
      rej.run(`REJ-${String(k++).padStart(4, '0')}`, batchId, r.row_number, JSON.stringify(r.raw), r.error_code, r.message);
    }

    if (status !== 'failed') {
      // The first batch for a scheduled round brings the round in.
      run(
        `update assessment_rounds set status = 'completed', import_date = coalesce(import_date, ?),
           instrument_note = case when status = 'scheduled' then 'Fictional state spot-assessment, grades 1–3 (imported in the app)' else instrument_note end
         where id = ?`,
        today(), round.id,
      );
      run('update datasets set last_import_batch_id = ?, last_updated_at = ? where id = ?', batchId, now, 'DS-02');
      run(
        `insert into import_file_hashes (sha256, round_id, scope_type, scope_id, import_batch_id, file_name, uploaded_by, created_at)
         values (?,?,?,?,?,?,?,?)`,
        fingerprint, round.id, area.type, area.id, batchId, name, s.user_id, now,
      );
    }

    appendAudit({
      actorUserId: s.user_id, actorRole: role, action: status === 'failed' ? 'import.failed' : 'import.committed',
      entityType: 'import_batch', entityId: batchId, source: 'import',
      after: { rows: status === 'failed' ? 0 : accepted, rejected, round: round.code, scope: `${area.type}:${area.id}`, sha256: fingerprint, file_name: name },
      reason: summary, result: status === 'failed' ? 'failure' : 'success',
    });
    notify({
      userId: s.user_id, kind: status === 'failed' ? 'import_failed' : 'import_succeeded',
      title: status === 'failed' ? 'Import failed' : rejected ? 'Import committed with rejected rows' : 'Import committed',
      body: status === 'failed' ? `${name}: ${summary}` : `${name}: ${accepted} rows accepted${rejected ? `, ${rejected} rejected` : ''}`,
      entityType: 'import_batch', entityId: batchId, link: `/import/${batchId}`,
    });
    recordJob('import_validation', status === 'failed' ? 'failed' : 'succeeded',
      { batch: batchId, round: round.code, accepted: status === 'failed' ? 0 : accepted, rejected }, status === 'failed' ? summary : null);
    return { batchId, status: status as CommitResult['status'], accepted: status === 'failed' ? 0 : accepted, rejected };
  });

  // Detection runs after the commit, in its own transaction: if it fails, the uploaded rows are
  // still safely on record and the failure is a failed system job, not a lost upload.
  let detection: DetectionSummary | null = null;
  if (committed.status !== 'failed') {
    try {
      detection = runDetection(round.id, committed.batchId);
    } catch (e) {
      recordJob('detection_run', 'failed', { round: round.code, batch: committed.batchId }, (e as Error).message);
    }
  }
  return { ...committed, duplicateOf: null, detection };
}

// ------------------------------------------------------------------ detection run
export interface DetectionSummary {
  round: string;
  prevRound: string;
  settings: string;
  candidates: number;
  flagged: number;
  rejectedNoise: number;
  rejectedDataQuality: number;
  alreadyKnown: number;
  newFindings: string[];
  casesOpened: { id: string; title: string; severity: Severity; owner: string }[];
  monitoring: { findingId: string; caseId: string | null }[];
  schoolsReporting: number;
}

const COMPETENCY_NAME = () => new Map(all<{ id: string; name_en: string }>('select id, name_en from competencies').map((c) => [c.id, c.name_en]));

/**
 * Run the detector over a round, exactly as the seed generator does: src/domain/detect.ts on
 * the previous round's rows against this round's, with the detection settings in force today.
 *
 * Re-runnable. A candidate already on record for this round (same cluster, grade and
 * competency) is left alone, so a second batch for the same round — another block, a late
 * district — adds only what is new. Until every block has reported, the "district change" the
 * detector subtracts is the change across the schools that have reported so far.
 */
export function runDetection(roundId: string, batchId: string | null): DetectionSummary {
  return tx(() => {
    const rounds = all<RoundInfo>('select id, code, label, window_start, window_end, status, import_date from assessment_rounds order by window_start');
    const at = rounds.findIndex((r) => r.id === roundId);
    if (at < 1) throw new Refused('There is no earlier round to compare this one with.', 'no_previous_round');
    const round = rounds[at];
    const prev = [...rounds.slice(0, at)].reverse().find((r) =>
      (one<{ c: number }>('select count(*) c from assessment_results where round_id = ?', r.id)?.c ?? 0) > 0);
    if (!prev) throw new Refused('There is no earlier round with results to compare this one with.', 'no_previous_round');

    const rowsOf = (id: string) => all<DetectRow>(
      `select school_id, grade, competency_id, enrolled, n_assessed, n_proficient
         from assessment_results where round_id = ? and metric_id = 'MET-PCT-PROF'`, id,
    );
    const prevRows = rowsOf(prev.id);
    const currRows = rowsOf(round.id);
    const schools = all<{ id: string; cluster_id: string; block_id: string; district_id: string }>(
      'select id, cluster_id, block_id, district_id from schools',
    );
    const settings = settingsInForce();
    const cands = detectFindings(prevRows, currRows, schools, settings.detection);

    seqFloor('finding', 'findings', 'FND-');
    seqFloor('case', 'cases', 'CASE-');
    seqFloor('diagnosis', 'diagnoses', 'DGN-');

    const known = new Set(
      all<{ k: string }>(`select cluster_id || '|' || grade || '|' || competency_id k from findings where round_id = ?`, round.id).map((r) => r.k),
    );
    const openedThisRound = new Set(
      all<{ cluster_id: string }>(`select cluster_id from findings where round_id = ? and status = 'case_opened'`, round.id).map((r) => r.cluster_id),
    );
    const names = COMPETENCY_NAME();
    const now = nowIso();
    const out: DetectionSummary = {
      round: round.code, prevRound: prev.code, settings: settings.id, candidates: cands.length,
      flagged: 0, rejectedNoise: 0, rejectedDataQuality: 0, alreadyKnown: 0,
      newFindings: [], casesOpened: [], monitoring: [], schoolsReporting: new Set(currRows.map((r) => r.school_id)).size,
    };

    for (const cd of cands) {
      if (cd.status === 'flagged') out.flagged++;
      else if (cd.status === 'rejected_noise') out.rejectedNoise++;
      else out.rejectedDataQuality++;
      const key = `${cd.cluster_id}|${cd.grade}|${cd.competency_id}`;
      if (known.has(key)) { out.alreadyKnown++; continue; }
      known.add(key);

      // A cluster gets one new case per round; a drop where an open case already covers the same
      // grade and competency is monitored on that case rather than opened twice.
      const openCase = cd.status === 'flagged'
        ? one<{ id: string }>(
            `select id from cases where cluster_id = ? and grade = ? and competency_id = ?
               and status not in ('closed', 'dismissed') order by created_at desc limit 1`,
            cd.cluster_id, cd.grade, cd.competency_id,
          )
        : null;
      const status = cd.status !== 'flagged' ? cd.status
        : openedThisRound.has(cd.cluster_id) || openCase ? 'monitoring' : 'case_opened';

      const findingId = nextId('finding', 'FND-', 5);
      run(
        `insert into findings
          (id, round_id, prev_round_id, district_id, block_id, cluster_id, grade, competency_id, metric_id,
           prev_value_pct, curr_value_pct, change_pp, district_change_pp, relative_change_pp, z_score,
           n_prev, n_curr, schools_reporting, schools_total, participation_rate, dq_checks, detection_method,
           thresholds, settings_version_id, status, case_id, driver_schools, measured_prev_window_end,
           measured_curr_window_end, detected_at, severity, provenance)
         values (?,?,?,?,?,?,?,?,'MET-PCT-PROF',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,null,?,?,?,?,?,?)`,
        findingId, round.id, prev.id, cd.district_id, cd.block_id, cd.cluster_id, cd.grade, cd.competency_id,
        cd.prev_value_pct, cd.curr_value_pct, cd.change_pp, cd.district_change_pp, cd.relative_change_pp, cd.z_score,
        cd.n_prev, cd.n_curr, cd.schools_reporting, cd.schools_total, cd.participation_rate, JSON.stringify(cd.dq_checks),
        'Cluster change minus district change; two-proportion z-test; materiality and data-quality gates',
        JSON.stringify({ materiality_pp: settings.detection.materiality_pp, z_threshold: settings.detection.z_threshold }),
        settings.id, status, JSON.stringify(cd.driver_schools), prev.window_end, round.window_end, now, cd.severity, PROV,
      );
      out.newFindings.push(findingId);
      appendAudit({
        actorUserId: null, actorRole: 'system', actorLabel: 'system:detector', action: 'finding.detected',
        entityType: 'finding', entityId: findingId, source: 'system',
        after: { status, relative_change_pp: cd.relative_change_pp, z: cd.z_score, batch: batchId },
      });

      if (status === 'monitoring') {
        out.monitoring.push({ findingId, caseId: openCase?.id ?? null });
        if (openCase) {
          addCaseEvent({
            caseId: openCase.id, actorUserId: null, actorLabel: 'system:detector', kind: 'finding_linked',
            summary: `${round.code} shows the drop again: ${cd.relative_change_pp} pts against the district (finding ${findingId}); monitored on this case`,
            related: findingId,
          });
        }
        continue;
      }
      if (status !== 'case_opened') continue;

      openedThisRound.add(cd.cluster_id);
      out.casesOpened.push(openDetectedCase(findingId, cd, names.get(cd.competency_id) ?? cd.competency_id, round, now));
    }

    recordJob('detection_run', 'succeeded', {
      round: round.code, prev_round: prev.code, batch: batchId, candidates: cands.length,
      flagged: out.flagged, rejected_noise: out.rejectedNoise, rejected_data_quality: out.rejectedDataQuality,
      already_known: out.alreadyKnown, new_findings: out.newFindings.length,
      cases_opened: out.casesOpened.length, case_ids: out.casesOpened.map((c) => c.id),
      schools_reporting: out.schoolsReporting, settings: settings.id,
    });
    return out;
  });
}

type Cand = ReturnType<typeof detectFindings>[number];

/** Open a case for a new hotspot the way the seed does: owned by the block's BEO, scoped to the cluster. */
function openDetectedCase(findingId: string, cd: Cand, competencyName: string, round: RoundInfo, now: string) {
  const cluster = one<{ id: string; name: string; block_id: string; district_id: string }>(
    'select id, name, block_id, district_id from clusters where id = ?', cd.cluster_id,
  )!;
  const stateId = one<{ state_id: string }>('select state_id from districts where id = ?', cluster.district_id)?.state_id ?? 'STA-01';
  const owner = one<{ user_id: string }>(
    `select user_id from user_roles where role = 'beo' and scope_type = 'block' and scope_id = ? order by user_id limit 1`, cluster.block_id,
  )?.user_id ?? one<{ user_id: string }>(
    `select user_id from user_roles where role = 'deo' and scope_type = 'district' and scope_id = ? order by user_id limit 1`, cluster.district_id,
  )?.user_id;
  if (!owner) throw new Error(`No BEO or DEO to own a case in ${cluster.block_id}.`);

  const caseId = nextId('case', 'CASE-', 4);
  const drivers = cd.driver_schools.map((d) => d.school_id);
  const title = cd.change_pp < 0
    ? `Class ${cd.grade} ${competencyName.toLowerCase()} fell ${Math.abs(cd.change_pp).toFixed(1)} pts in ${cluster.name} cluster`
    : `Class ${cd.grade} ${competencyName.toLowerCase()} lagged the district by ${Math.abs(cd.relative_change_pp).toFixed(1)} pts in ${cluster.name} cluster`;

  run(
    `insert into cases
      (id, title, origin, finding_id, diagnosis_id, state_id, district_id, block_id, cluster_id, school_ids,
       grade, competency_id, severity, lever, status, owner_user_id, current_plan_id, created_at, updated_at,
       due_date, verification_status, reopen_count, closure_type, closed_at, pab_cycle, provenance)
     values (?,?,'detected',?,null,?,?,?,?,?,?,?,?,'block','detected',?,null,?,?,null,'not_started',0,null,null,null,?)`,
    caseId, title, findingId, stateId, cluster.district_id, cluster.block_id, cluster.id, JSON.stringify(drivers),
    cd.grade, cd.competency_id, cd.severity, owner, now, now, PROV,
  );
  run('update findings set case_id = ? where id = ?', caseId, findingId);
  appendAudit({
    actorUserId: null, actorRole: 'system', actorLabel: 'system:detector', action: 'case.created',
    entityType: 'case', entityId: caseId, source: 'system',
    after: { status: 'detected', finding_id: findingId, origin: 'detected', owner_user_id: owner },
  });
  addCaseEvent({
    caseId, actorUserId: null, actorLabel: 'system:detector', kind: 'created',
    summary: `Finding ${findingId} crossed materiality and noise gates on the ${round.code} upload; case opened`,
    toStatus: 'detected', related: findingId,
  });

  const diagId = diagnose(caseId, findingId, drivers, round.window_end < today() ? round.window_end : today(), now);
  run('update cases set diagnosis_id = ? where id = ?', diagId, caseId);

  notify({
    userId: owner, kind: 'approval_request', title: 'New case in your queue', body: title,
    entityType: 'case', entityId: caseId, link: `/cases/${caseId}`,
  });
  return { id: caseId, title, severity: cd.severity, owner };
}

// ------------------------------------------------------------------ diagnosis (rules, as in the seed)
const FACTOR_LABEL = (st: SettingVersion['diagnosis']) => ({
  teacher_transfer: 'Teacher transferred out, not replaced',
  visit_gap: `No CRC visit for ${st.visit_gap_days}+ days`,
  attendance_drop: `Attendance fell ${st.attendance_drop_pp}+ points`,
  high_ptr: `Pupil–teacher ratio above ${st.ptr_threshold}`,
});

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;

/**
 * The seed's diagnosis rules, read from the context tables: teacher transfers (staff_events),
 * CRC visit gaps (visits), attendance (attendance_monthly) and pupil–teacher ratio (schools).
 * Observations are facts with their source record ids; the ranking counts flagged schools and
 * claims association only.
 */
function diagnose(caseId: string, findingId: string, schools: string[], windowEnd: string, ts: string): string {
  const settings = settingsInForce();
  const st = settings.diagnosis;
  const labels = FACTOR_LABEL(st);
  type Obs = { factor: keyof typeof labels; school_id: string; value: number; unit: string; threshold: number; flagged: boolean; source_table: string; source_record_ids: string[] };
  const obs: Obs[] = [];
  for (const sid of schools) {
    const evs = all<{ id: string; event_type: string; event_date: string }>(
      'select id, event_type, event_date from staff_events where school_id = ? and event_date <= ? order by event_date', sid, windowEnd,
    );
    const outs = evs.filter((e) => e.event_type === 'transfer_out' && days(windowEnd, e.event_date) <= st.teacher_transfer_window_days);
    const lastOut = outs[outs.length - 1];
    const replaced = lastOut ? evs.some((e) => e.event_type === 'joined' && e.event_date > lastOut.event_date) : false;
    obs.push({ factor: 'teacher_transfer', school_id: sid, value: lastOut ? days(windowEnd, lastOut.event_date) : 0, unit: 'days since transfer', threshold: st.teacher_transfer_window_days, flagged: !!lastOut && !replaced, source_table: 'staff_events', source_record_ids: lastOut ? [lastOut.id] : [] });

    const lastV = one<{ id: string; visit_date: string }>(
      'select id, visit_date from visits where school_id = ? and visit_date <= ? order by visit_date desc limit 1', sid, windowEnd,
    );
    const gap = lastV ? days(windowEnd, lastV.visit_date) : 365;
    obs.push({ factor: 'visit_gap', school_id: sid, value: gap, unit: 'days since last CRC visit', threshold: st.visit_gap_days, flagged: gap > st.visit_gap_days, source_table: 'visits', source_record_ids: lastV ? [lastV.id] : [] });

    const att = all<{ id: string; avg_attendance_pct: number }>(
      'select id, avg_attendance_pct from attendance_monthly where school_id = ? and month <= ? order by month', sid, windowEnd.slice(0, 7),
    );
    const recent = att.slice(-3);
    const prior = att.slice(-9, -3);
    const delta = recent.length && prior.length ? mean(recent.map((a) => a.avg_attendance_pct)) - mean(prior.map((a) => a.avg_attendance_pct)) : 0;
    obs.push({ factor: 'attendance_drop', school_id: sid, value: Math.round(delta * 10) / 10, unit: 'pp change, last 3 months vs 6 before', threshold: -st.attendance_drop_pp, flagged: delta <= -st.attendance_drop_pp, source_table: 'attendance_monthly', source_record_ids: [...recent, ...prior].map((a) => a.id) });

    const ptr = one<{ ptr: number }>('select ptr from schools where id = ?', sid)?.ptr ?? 0;
    obs.push({ factor: 'high_ptr', school_id: sid, value: ptr, unit: 'pupils per teacher', threshold: st.ptr_threshold, flagged: ptr > st.ptr_threshold, source_table: 'schools+staff_events', source_record_ids: [sid] });
  }
  const order = ['teacher_transfer', 'visit_gap', 'attendance_drop', 'high_ptr'] as const;
  const ranked = order
    .map((f) => ({ factor: f, label: labels[f], schools_flagged: obs.filter((o) => o.factor === f && o.flagged).length, of_driver_schools: schools.length, rank: 0 }))
    .sort((a, b) => b.schools_flagged - a.schools_flagged || order.indexOf(a.factor) - order.indexOf(b.factor));
  ranked.forEach((r, i) => (r.rank = i + 1));
  const top = ranked.filter((r) => r.schools_flagged > 0);
  const hyp = top.length
    ? `Possible contributors (association, not proven cause): ${top.map((r) => `${r.label.toLowerCase()} in ${r.schools_flagged} of ${r.of_driver_schools} driver schools`).join('; ')}. Confirm with the CRC before acting.`
    : 'No contributing factor in the available feeds crossed its threshold. Check for a data or marking problem first.';

  const id = nextId('diagnosis', 'DGN-', 5);
  run(
    `insert into diagnoses (id, case_id, finding_id, observations, ranked_factors, ai_hypothesis, ai_hypothesis_model,
       human_conclusion, human_conclusion_by, created_at, method_note)
     values (?,?,?,?,?,?,?,null,null,?,?)`,
    id, caseId, findingId, JSON.stringify(obs), JSON.stringify(ranked), `Simulated AI hypothesis — ${hyp}`, SIM_MODEL, ts,
    `Rule thresholds from settings ${settings.id}. Observations are facts from the listed tables; rankings count flagged schools and show association only.`,
  );
  appendAudit({
    actorUserId: null, actorRole: 'system', actorLabel: 'system:diagnosis-rules', action: 'diagnosis.created',
    entityType: 'diagnosis', entityId: id, source: 'system', after: { case_id: caseId, top_factor: ranked[0].factor },
  });
  return id;
}
