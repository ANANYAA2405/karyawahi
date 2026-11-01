import 'server-only';
import type { Param } from './db';
import type { Session } from './session';
import type { RoleCode } from '@domain/types';

/**
 * Row-level security, ported.
 *
 * Postgres enforces visibility with the policies in sql/schema.sql. SQLite has no RLS, so
 * every scoped read in this app composes a predicate from here into its WHERE clause. These
 * are line-for-line ports of in_scope(), can_see_school() and can_see_case(), including the
 * headmaster carve-outs, so the two backends show a given user exactly the same rows.
 *
 * Rule for anyone adding a query: if the table appears in the "scoped data" block of
 * schema.sql, it must be filtered through one of these. Never interpolate a scope id into SQL
 * by hand — always pass the params this module returns.
 */

export interface Pred { sql: string; params: Param[] }

export const TRUE: Pred = { sql: '1=1', params: [] };
export const FALSE: Pred = { sql: '1=0', params: [] };

export function and(...ps: (Pred | null)[]): Pred {
  const live = ps.filter((p): p is Pred => p !== null && p.sql !== '1=1');
  if (live.length === 0) return TRUE;
  if (live.length === 1) return live[0];
  return { sql: `(${live.map((p) => `(${p.sql})`).join(' and ')})`, params: live.flatMap((p) => p.params) };
}

/**
 * Disjunction, wrapped.
 *
 * The outer parentheses are not cosmetic. A predicate containing a bare `or` interpolated into
 * `where ${pred} and status = 'closed'` parses as `A or (B and status = ...)`, because `or`
 * binds looser than `and` — the caller's filter silently applies to only one branch. Returning
 * a parenthesised expression makes that impossible however the caller splices it in.
 */
export function or(...ps: (Pred | null)[]): Pred {
  const live = ps.filter((p): p is Pred => p !== null);
  if (live.length === 0) return FALSE;
  if (live.some((p) => p.sql === '1=1')) return TRUE;
  if (live.length === 1) return live[0];
  return { sql: `(${live.map((p) => `(${p.sql})`).join(' or ')})`, params: live.flatMap((p) => p.params) };
}

export const hasRole = (s: Session, ...roles: RoleCode[]): boolean =>
  s.roles.some((r) => roles.includes(r.role));

export const isHeadmaster = (s: Session): boolean =>
  s.roles.every((r) => r.role === 'headmaster');

/** Columns holding the geography of a row. Mirrors the in_scope() signature. */
export interface GeoCols {
  state?: string;
  district?: string;
  block?: string;
  cluster?: string;
  /** Column holding a JSON array of school ids (cases.school_ids). */
  schoolIds?: string;
  /** Column holding a single school id. */
  school?: string;
  /** JSON array of objects each with a school_id key (findings.driver_schools). */
  driverSchools?: string;
}

/**
 * in_scope(...) for a row whose geography sits in the given columns.
 * A state-scoped user matches on state_id, a district-scoped one on district_id, and so on;
 * a school-scoped user matches when their school appears in the row's school list.
 */
export function inScope(s: Session, c: GeoCols): Pred {
  const parts: Pred[] = [];
  for (const r of s.roles) {
    switch (r.scope_type) {
      case 'state':
        if (c.state) parts.push({ sql: `${c.state} = ?`, params: [r.scope_id] });
        break;
      case 'district':
        if (c.district) parts.push({ sql: `${c.district} = ?`, params: [r.scope_id] });
        break;
      case 'block':
        if (c.block) parts.push({ sql: `${c.block} = ?`, params: [r.scope_id] });
        break;
      case 'cluster':
        if (c.cluster) parts.push({ sql: `${c.cluster} = ?`, params: [r.scope_id] });
        break;
      case 'school': {
        if (c.school) parts.push({ sql: `${c.school} = ?`, params: [r.scope_id] });
        if (c.schoolIds) {
          parts.push({
            sql: `exists (select 1 from json_each(${c.schoolIds}) je where je.value = ?)`,
            params: [r.scope_id],
          });
        }
        if (c.driverSchools) {
          parts.push({
            sql: `exists (select 1 from json_each(${c.driverSchools}) je where json_extract(je.value, '$.school_id') = ?)`,
            params: [r.scope_id],
          });
        }
        break;
      }
    }
  }
  return or(...parts);
}

/** can_see_school(col): resolve the school's geography, then apply in_scope. */
export function canSeeSchool(s: Session, schoolCol: string, alias = 'sc_scope'): Pred {
  const geo = inScope(s, {
    state: `${alias}.state_id`,
    district: `${alias}.district_id`,
    block: `${alias}.block_id`,
    cluster: `${alias}.cluster_id`,
    school: `${alias}.id`,
  });
  return {
    sql: `exists (select 1 from schools ${alias} where ${alias}.id = ${schoolCol} and (${geo.sql}))`,
    params: geo.params,
  };
}

/**
 * can_see_case(col): the case is in scope, OR the user owns a task on it. The second arm is
 * what lets a headmaster or CRC open a case they were given work on but whose cluster-level
 * record they would not otherwise see.
 */
export function canSeeCase(s: Session, caseIdCol: string, alias = 'c_scope'): Pred {
  const geo = inScope(s, {
    state: `${alias}.state_id`,
    district: `${alias}.district_id`,
    block: `${alias}.block_id`,
    cluster: `${alias}.cluster_id`,
    schoolIds: `${alias}.school_ids`,
  });
  return or(
    {
      sql: `exists (select 1 from cases ${alias} where ${alias}.id = ${caseIdCol} and (${geo.sql}))`,
      params: geo.params,
    },
    {
      sql: `exists (select 1 from tasks t_scope where t_scope.case_id = ${caseIdCol} and t_scope.owner_user_id = ?)`,
      params: [s.user_id],
    },
  );
}

/** The predicate for `cases` queried under its own alias (no sub-select needed). */
export function casesPred(s: Session, alias = 'cases'): Pred {
  return or(
    inScope(s, {
      state: `${alias}.state_id`,
      district: `${alias}.district_id`,
      block: `${alias}.block_id`,
      cluster: `${alias}.cluster_id`,
      schoolIds: `${alias}.school_ids`,
    }),
    {
      sql: `exists (select 1 from tasks t_scope where t_scope.case_id = ${alias}.id and t_scope.owner_user_id = ?)`,
      params: [s.user_id],
    },
  );
}

/** `findings`: in_scope over the finding's geography plus its driver schools. */
export function findingsPred(s: Session, alias = 'findings'): Pred {
  return inScope(s, {
    state: `(select d_scope.state_id from districts d_scope where d_scope.id = ${alias}.district_id)`,
    district: `${alias}.district_id`,
    block: `${alias}.block_id`,
    cluster: `${alias}.cluster_id`,
    driverSchools: `${alias}.driver_schools`,
  });
}

/** `schools` queried under its own alias. */
export function schoolsPred(s: Session, alias = 'schools'): Pred {
  return inScope(s, {
    state: `${alias}.state_id`,
    district: `${alias}.district_id`,
    block: `${alias}.block_id`,
    cluster: `${alias}.cluster_id`,
    school: `${alias}.id`,
  });
}

/** `tasks`: mine, or in a case I can see — but headmasters only ever see their own. */
export function tasksPred(s: Session, alias = 'tasks'): Pred {
  const own: Pred = { sql: `${alias}.owner_user_id = ?`, params: [s.user_id] };
  if (isHeadmaster(s)) return own;
  return or(own, canSeeCase(s, `${alias}.case_id`));
}

/** `evidence`: submitted by me, or attached to a case I can see. */
export function evidencePred(s: Session, alias = 'evidence'): Pred {
  return or(
    { sql: `${alias}.submitted_by = ?`, params: [s.user_id] },
    canSeeCase(s, `${alias}.case_id`),
  );
}

/** `staff_events`: school in scope, and never visible to a headmaster. */
export function staffEventsPred(s: Session, alias = 'staff_events'): Pred {
  if (isHeadmaster(s)) return FALSE;
  return canSeeSchool(s, `${alias}.school_id`);
}

/** Holds a role whose reach is the whole state: the state team, the demo admin, or an auditor
 *  appointed at state level. A district auditor is not one: their reach is their district. */
export const isStateWide = (s: Session): boolean =>
  s.roles.some((r) => r.role === 'state_admin' || r.role === 'demo_admin' || (r.role === 'auditor' && r.scope_type === 'state'));

/**
 * A place, named by a scope type and id held in two columns (as user_roles and import_batches
 * store them), that lies inside one of the user's scopes, at or below it. A block officer's
 * area contains their block, its clusters and its schools, but not the district above it.
 */
export function unitInScope(s: Session, typeCol: string, idCol: string): Pred {
  const arm = (type: string, table: string, cols: GeoCols): Pred => {
    const geo = inScope(s, cols);
    if (geo.sql === '1=0') return FALSE;
    return {
      sql: `${typeCol} = '${type}' and exists (select 1 from ${table} u_${type} where u_${type}.id = ${idCol} and (${geo.sql}))`,
      params: geo.params,
    };
  };
  return or(
    arm('school', 'schools', { state: 'u_school.state_id', district: 'u_school.district_id', block: 'u_school.block_id', cluster: 'u_school.cluster_id', school: 'u_school.id' }),
    arm('cluster', 'clusters', { state: '(select state_id from districts where id = u_cluster.district_id)', district: 'u_cluster.district_id', block: 'u_cluster.block_id', cluster: 'u_cluster.id' }),
    arm('block', 'blocks', { state: '(select state_id from districts where id = u_block.district_id)', district: 'u_block.district_id', block: 'u_block.id' }),
    arm('district', 'districts', { state: 'u_district.state_id', district: 'u_district.id' }),
    arm('state', 'states', { state: 'u_state.id' }),
  );
}

/** `audit_events`: the whole chain for state-wide roles; a BEO, DEO or district auditor sees
 *  the entries for cases in their own area. */
export function auditPred(s: Session, alias = 'audit_events'): Pred {
  if (isStateWide(s)) return TRUE;
  if (hasRole(s, 'beo', 'deo', 'auditor')) {
    return and(
      { sql: `${alias}.entity_type = 'case'`, params: [] },
      canSeeCase(s, `${alias}.entity_id`),
    );
  }
  return FALSE;
}

/** `ai_interactions`: my own; everything for state-wide roles; a district auditor also reads
 *  the questions of everyone whose role sits inside their district. */
export function aiPred(s: Session, alias = 'ai_interactions'): Pred {
  if (isStateWide(s)) return TRUE;
  const mine: Pred = { sql: `${alias}.user_id = ?`, params: [s.user_id] };
  const auditing = s.roles.filter((r) => r.role === 'auditor');
  if (auditing.length === 0) return mine;
  const area = unitInScope({ ...s, roles: auditing }, 'aur.scope_type', 'aur.scope_id');
  return or(mine, {
    sql: `exists (select 1 from user_roles aur where aur.user_id = ${alias}.user_id and (${area.sql}))`,
    params: area.params,
  });
}

/** `reports`: mine, anything in my scope, plus everything for state-wide roles. */
export function reportsPred(s: Session, alias = 'reports'): Pred {
  if (isStateWide(s)) return TRUE;
  return or(
    { sql: `${alias}.generated_by = ?`, params: [s.user_id] },
    ...s.roles.map((r) => ({ sql: `${alias}.scope_id = ?`, params: [r.scope_id] as Param[] })),
  );
}

/** Whether this user's role reads import data at all. Which batches and rows: below. */
export function importPred(s: Session): Pred {
  return hasRole(s, 'beo', 'deo', 'state_admin', 'auditor', 'demo_admin') ? TRUE : FALSE;
}

/** `import_batches`: a batch whose area overlaps the user's, i.e. covers at least one school
 *  they can see. A state-wide batch is visible to every officer; a district batch only inside it. */
export function importBatchPred(s: Session, alias = 'import_batches'): Pred {
  if (importPred(s).sql === '1=0') return FALSE;
  if (isStateWide(s)) return TRUE;
  const geo = inScope(s, { state: 'ov.state_id', district: 'ov.district_id', block: 'ov.block_id', cluster: 'ov.cluster_id', school: 'ov.id' });
  return {
    sql: `exists (select 1 from schools ov
             where (case ${alias}.scope_type when 'state' then ov.state_id when 'district' then ov.district_id
                    when 'block' then ov.block_id when 'cluster' then ov.cluster_id else ov.id end) = ${alias}.scope_id
               and (${geo.sql}))`,
    params: geo.params,
  };
}

/** `import_rejected_rows`: rows for schools in the user's area. A rejected row is a school's own
 *  data, so seeing the batch it came in is not enough. A row whose school id matches no school
 *  (rejected for exactly that) carries no school's data, and goes to whoever can see its batch,
 *  since they are the ones who must correct it. */
export function rejectedRowPred(s: Session, alias = 'import_rejected_rows'): Pred {
  if (importPred(s).sql === '1=0') return FALSE;
  if (isStateWide(s)) return TRUE;
  const school = `json_extract(${alias}.raw, '$.school_id')`;
  const batch = importBatchPred(s, 'rb');
  return or(
    canSeeSchool(s, school),
    {
      sql: `not exists (select 1 from schools rs where rs.id = ${school})
            and exists (select 1 from import_batches rb where rb.id = ${alias}.import_batch_id and (${batch.sql}))`,
      params: batch.params,
    },
  );
}
