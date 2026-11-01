import { DISCLAIMER } from '@domain/catalog';
import { CASE_STATUSES } from '@domain/lifecycle';
import { STAGES } from '../case-stage';
import { RATE_LIMIT } from './keys';

/**
 * The OpenAPI 3.1 document for /api/v1, written by hand to match lib/api/read.ts and
 * lib/api/http.ts. If you change a field there, change it here; scripts/api-test.mts checks
 * that every route the code serves is listed.
 *
 * OpenAPI allows only `x-` fields at the top level, so the demo marker every other response
 * carries as `demo_data` / `disclaimer` appears here as `x-demo-data` / `x-disclaimer`.
 */

const SEVERITIES = ['critical', 'high', 'medium'];
const TASK_STATUSES = ['assigned', 'acknowledged', 'in_progress', 'submitted', 'verified', 'sent_back', 'cancelled'];
const CATEGORIES = ['improved_confirmed', 'improved_indicative', 'below_target', 'no_change', 'worsened', 'inconclusive'];
const ROLES = ['state_admin', 'deo', 'beo', 'brc', 'crc', 'headmaster', 'auditor', 'demo_admin'];

const str = (description?: string, extra: Record<string, unknown> = {}) => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const nstr = (description?: string, extra: Record<string, unknown> = {}) => ({ type: ['string', 'null'], ...(description ? { description } : {}), ...extra });
const int = (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) });
const numN = (description?: string) => ({ type: ['number', 'null'], ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) });
const dt = (description?: string) => str(description, { format: 'date-time' });
const ndt = (description?: string) => nstr(description, { format: 'date-time' });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const nobj = (properties: Record<string, unknown>) => ({ type: ['object', 'null'], properties, required: Object.keys(properties) });
const arr = (items: unknown) => ({ type: 'array', items });

const qp = (name: string, description: string, schema: Record<string, unknown>) => ({ name, in: 'query', required: false, description, schema });
const LIMIT = qp('limit', 'Page size, 1 to 200. Default 50.', { type: 'integer', minimum: 1, maximum: 200, default: 50 });
const CURSOR = qp('cursor', 'The `page.next_cursor` from the previous page. Opaque; do not build it yourself.', { type: 'string' });

const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '429': { $ref: '#/components/responses/RateLimited' },
};

function listResponse(item: string, description: string) {
  return {
    description,
    content: { 'application/json': { schema: { allOf: [ref('Envelope'), obj({ data: arr(ref(item)), page: ref('Page') })] } } },
  };
}

export function openApiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    'x-demo-data': true,
    'x-disclaimer': DISCLAIMER,
    info: {
      title: 'Karyavahi case ledger API (read-only)',
      version: '1.0.0',
      summary: 'Read-only access to the case ledger for state dashboard systems (Vidya Samiksha Kendras).',
      description: [
        `${DISCLAIMER}. Every response carries "demo_data": true and this disclaimer.`,
        '',
        'Authenticate with `Authorization: Bearer kv_demo_…`. Keys are issued by the state programme team at /admin/api-keys; each key reads one area (the state, a district or a block) and everything inside it, and nothing else. Records outside the key\'s area answer 404, exactly as records that do not exist.',
        '',
        `Rate limit: ${RATE_LIMIT} requests a minute per key, over a sliding window. Over the limit you get 429 with a Retry-After header (seconds).`,
        '',
        'No personal data: owners are given as roles, never names, ids, phone numbers or emails. No free text people typed (discussion, rationale, reasons, notes) and no complaints.',
        '',
        'Dates are ISO 8601. Times are UTC date-times; due dates are calendar dates (YYYY-MM-DD, India time). "Overdue" is judged against the demo clock, given in `as_of` on every response.',
        '',
        'Lists are sorted oldest-first by the field named in each endpoint and paginated with an opaque cursor. To sync, remember the newest `updated_at` you saw and pass it back as `updated_since` next time.',
      ].join('\n'),
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerKey: [] }],
    paths: {
      '/cases': {
        get: {
          operationId: 'listCases',
          summary: 'Cases in the key\'s area',
          description: 'Sorted by `updated_at`, then `id`, ascending.',
          parameters: [
            qp('status', 'Comma-separated case statuses.', { type: 'string', example: 'in_progress,awaiting_verification' }),
            qp('severity', 'Comma-separated severities.', { type: 'string', example: 'critical,high' }),
            qp('block', 'Only cases in this block (BLK-xx). A block outside the key\'s area returns an empty list.', { type: 'string', pattern: '^BLK-\\d{2,3}$' }),
            qp('updated_since', 'Only cases updated at or after this date or date-time.', { type: 'string', format: 'date-time' }),
            qp('open', 'true for open cases only, false for closed, referred and dismissed only.', { type: 'boolean' }),
            LIMIT, CURSOR,
          ],
          responses: { '200': listResponse('Case', 'A page of cases.'), ...errors },
        },
      },
      '/cases/{id}': {
        get: {
          operationId: 'getCase',
          summary: 'One case, with its finding, plan, task counts and latest outcome check',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^CASE-\\d{3,6}$' } }],
          responses: {
            '200': { description: 'The case.', content: { 'application/json': { schema: { allOf: [ref('Envelope'), obj({ data: ref('CaseDetail') })] } } } },
            '401': errors['401'],
            '404': { $ref: '#/components/responses/NotFound' },
            '429': errors['429'],
          },
        },
      },
      '/tasks': {
        get: {
          operationId: 'listTasks',
          summary: 'Field tasks in the key\'s area',
          description: 'Sorted by `due_date`, then `id`, ascending. Owners are given as roles only.',
          parameters: [
            qp('case', 'Only tasks on this case.', { type: 'string', pattern: '^CASE-\\d{3,6}$' }),
            qp('status', 'Comma-separated task statuses.', { type: 'string', example: 'assigned,in_progress' }),
            qp('block', 'Only tasks on cases in this block.', { type: 'string', pattern: '^BLK-\\d{2,3}$' }),
            qp('overdue', 'true for overdue tasks only (not submitted, due date before the demo date); false for the rest.', { type: 'boolean' }),
            LIMIT, CURSOR,
          ],
          responses: { '200': listResponse('Task', 'A page of tasks.'), ...errors },
        },
      },
      '/outcomes': {
        get: {
          operationId: 'listOutcomes',
          summary: 'Outcome checks (difference-in-differences) in the key\'s area',
          description: 'Sorted by `evaluated_at`, then `id`, ascending.',
          parameters: [
            qp('case', 'Only checks on this case.', { type: 'string', pattern: '^CASE-\\d{3,6}$' }),
            qp('category', 'Comma-separated outcome categories.', { type: 'string', example: 'improved_confirmed,worsened' }),
            qp('evaluated_since', 'Only checks made at or after this date or date-time.', { type: 'string', format: 'date-time' }),
            LIMIT, CURSOR,
          ],
          responses: { '200': listResponse('Outcome', 'A page of outcome checks.'), ...errors },
        },
      },
      '/hotspots': {
        get: {
          operationId: 'listHotspots',
          summary: 'Learning hotspot units one level below the key\'s area',
          description: 'A state key gets districts, a district key blocks, a block key clusters; `within` drills one level further down. Worst first. Not paginated.',
          parameters: [
            qp('within', 'A district, block or cluster inside the key\'s area; returns the units one level below it. Outside the area: 404.', { type: 'string', example: 'BLK-01' }),
            qp('round', 'The later of the two assessment rounds compared (a completed round id). Default: the latest.', { type: 'string', example: 'RND-2026-07' }),
            qp('grade', 'Only this class.', { type: 'integer', enum: [1, 2, 3] }),
            qp('subject', 'N numeracy or L literacy.', { type: 'string', enum: ['N', 'L'] }),
          ],
          responses: {
            '200': {
              description: 'Hotspot units.',
              content: { 'application/json': { schema: { allOf: [ref('Envelope'), obj({
                level: str('The level of the units returned.', { enum: ['district', 'block', 'cluster', 'school'] }),
                within: { type: ['object', 'null'], properties: { level: str(), id: str() } },
                rounds: { type: ['object', 'null'], properties: { previous: ref('Round'), current: ref('Round') } },
                filters: obj({ grade: { type: ['integer', 'null'] }, subject: nstr() }),
                rules: { type: 'object', description: 'The thresholds the severity bands are computed with.' },
                data: arr(ref('HotspotUnit')),
              })] } } },
            },
            '400': errors['400'], '401': errors['401'], '404': { $ref: '#/components/responses/NotFound' }, '429': errors['429'],
          },
        },
      },
      '/summary': {
        get: {
          operationId: 'getSummary',
          summary: 'Headline figures for the key\'s area',
          responses: {
            '200': { description: 'The summary.', content: { 'application/json': { schema: { allOf: [ref('Envelope'), obj({ data: ref('Summary') })] } } } },
            '401': errors['401'], '429': errors['429'],
          },
        },
      },
      '/openapi.json': {
        get: {
          operationId: 'getOpenApi',
          summary: 'This document',
          security: [],
          responses: { '200': { description: 'The OpenAPI 3.1 document.', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerKey: { type: 'http', scheme: 'bearer', bearerFormat: 'kv_demo_<12 hex>_<43 base64url>', description: 'An API key from /admin/api-keys. Cookies are ignored.' },
      },
      responses: {
        BadRequest: { description: 'A query parameter is not valid; the message says which.', content: { 'application/json': { schema: ref('Error') } } },
        Unauthorized: {
          description: 'No key, or a key that is malformed, unknown, wrong or revoked. The response does not say which.',
          headers: { 'WWW-Authenticate': { schema: { type: 'string' } } },
          content: { 'application/json': { schema: ref('Error') } },
        },
        NotFound: { description: 'No such record in the key\'s area. A record in another area answers the same way.', content: { 'application/json': { schema: ref('Error') } } },
        RateLimited: {
          description: `More than ${RATE_LIMIT} requests in the last minute with this key.`,
          headers: { 'Retry-After': { description: 'Seconds to wait.', schema: { type: 'integer' } } },
          content: { 'application/json': { schema: ref('Error') } },
        },
      },
      schemas: {
        Demo: obj({ demo_data: { const: true }, disclaimer: str(undefined, { const: DISCLAIMER }) }),
        Envelope: {
          allOf: [ref('Demo'), obj({
            api_version: str(undefined, { const: 'v1' }),
            scope: obj({ type: str(undefined, { enum: ['state', 'district', 'block'] }), id: str(), name: nstr() }),
            generated_at: dt('When this response was made (wall clock).'),
            as_of: dt('The demo clock: the date "overdue" and "due" are judged against.'),
          })],
        },
        Error: { allOf: [ref('Demo'), obj({ error: obj({ code: str(undefined, { enum: ['bad_request', 'unauthorized', 'not_found', 'rate_limited', 'server_error'] }), message: str() }) })] },
        Page: obj({
          limit: int(), returned: int(), total: int('Rows matching the filters, across all pages.'),
          next_cursor: nstr('Pass as `cursor` for the next page; null on the last page.'),
        }),
        Round: obj({ id: str(), code: nstr(), label: nstr() }),
        Competency: obj({ id: str(), name_en: nstr(), name_hi: nstr() }),
        TaskCounts: obj({ total: int(), open: int(), overdue: int(), submitted: int(), verified: int(), sent_back: int(), escalated: int() }),
        Case: obj({
          id: str(undefined, { example: 'CASE-0184' }),
          title: str('Generated from the data. For a manual case the officer\'s own title is not given.'),
          origin: str(undefined, { enum: ['detected', 'manual'] }),
          status: str(undefined, { enum: [...CASE_STATUSES] }),
          stage: str('The status grouped into seven plain stages.', { enum: STAGES.map((s) => s.key) }),
          is_open: bool(),
          severity: str(undefined, { enum: SEVERITIES }),
          lever: str(undefined, { enum: ['block', 'district', 'pab'] }),
          grade: int(),
          competency: ref('Competency'),
          area: obj({ state_id: str(), district_id: str(), block_id: str(), cluster_id: str() }),
          school_ids: arr(str()),
          owner_role: nstr('The role of the officer who owns the case. Never a name.', { enum: [...ROLES, null] }),
          due_date: nstr(undefined, { format: 'date' }),
          created_at: dt(), updated_at: dt(), closed_at: ndt(),
          closure_type: nstr('The outcome category the case closed on, when closed.'),
          reopen_count: int(),
          verification_status: str(),
          pab_cycle: nstr(),
          task_counts: ref('TaskCounts'),
        }),
        CaseDetail: {
          allOf: [ref('Case'), obj({
            finding: nobj({
              id: str(),
              rounds: obj({ previous: ref('Round'), current: ref('Round') }),
              metric_id: str(), previous_pct: numN(), current_pct: numN(), change_pp: numN(),
              district_change_pp: numN(), relative_change_pp: numN(), z_score: numN(),
              students_assessed: obj({ previous: int(), current: int() }),
              schools_reporting: int(), schools_total: int(), participation_rate: numN(),
              detection_method: str(), detected_at: dt(),
              driver_schools: arr(obj({ school_id: str(), previous_pct: numN(), current_pct: numN(), change_pp: numN(), contribution_share: numN() })),
            }),
            diagnosis: nobj({
              ranked_factors: arr(obj({ factor: str(), rank: int(), schools_flagged: int(), of_driver_schools: int() })),
              concluded: bool('Whether an officer has recorded a conclusion. The conclusion itself is not given.'),
            }),
            plan: nobj({
              id: str(), cycle: int(), version: int(), status: str(), drafted_by: str(undefined, { enum: ['ai_draft', 'officer'] }),
              intervention: obj({ id: str(), name: nstr(), category: nstr(), duration_weeks: { type: ['integer', 'null'] } }),
              school_count: int(), estimated_cost_inr: numN(), cost_is_illustrative: bool(),
              pre_registration: nobj({ baseline_round: ref('Round'), followup_round: ref('Round'), success_threshold_pp: numN(), comparison_school_count: int() }),
              created_at: dt(),
            }),
            plan_cycles: int(),
            task_due_dates: obj({ next_due: nstr(undefined, { format: 'date' }), overdue_since: nstr(undefined, { format: 'date' }) }),
            latest_outcome: { oneOf: [ref('Outcome'), { type: 'null' }] },
            outcome_checks: int(),
          })],
        },
        Task: obj({
          id: str(), case_id: str(), plan_id: str(), cycle: int(), template_key: str(),
          title_en: str('From the task template, not typed by a person.'), title_hi: str(),
          school_id: nstr(), owner_role: str('Never a name.', { enum: ROLES }),
          proof: obj({ type: str(), count: int() }),
          status: str(undefined, { enum: TASK_STATUSES }),
          is_overdue: bool(),
          due_date: str(undefined, { format: 'date' }), original_due_date: str(undefined, { format: 'date' }),
          deadline_moved: bool('The reason given for moving it is not included.'),
          assigned_at: dt(), acknowledged_at: ndt(), started_at: ndt(), submitted_at: ndt(), verified_at: ndt(), escalated_at: ndt(),
        }),
        Outcome: obj({
          id: str(), case_id: str(), plan_id: str(), cycle: int(), grade: int(), competency: ref('Competency'),
          rounds: obj({ baseline: ref('Round'), followup: ref('Round') }),
          treated: obj({ school_count: int(), baseline_mean_pct: numN(), followup_mean_pct: numN(), change_pp: numN() }),
          comparison: obj({ school_count: int(), baseline_mean_pct: numN(), followup_mean_pct: numN(), change_pp: numN() }),
          did_pp: numN('Difference in differences, percentage points.'),
          interval: obj({ low_pp: numN(), high_pp: numN(), method: str() }),
          success_threshold_pp: numN(),
          participation_check: { type: ['object', 'null'] },
          category: str(undefined, { enum: CATEGORIES }),
          delivery_verified: bool(), cross_source_verified: bool(), closure_eligible: bool(), is_illustrative: bool(),
          evaluated_at: dt(), reviewed: bool(),
        }),
        HotspotUnit: obj({
          id: str(), name: str(), level: str(undefined, { enum: ['district', 'block', 'cluster', 'school'] }), parent_id: nstr(),
          severity: str(undefined, { enum: ['critical', 'significant', 'moderate', 'stable', 'improving', 'insufficient'] }),
          reason: str('Generated from the figures.'),
          previous_pct: numN(), current_pct: numN(), change_pp: numN(), district_change_pp: numN(),
          relative_change_pp: numN(), z_score: numN(), overall_relative_change_pp: numN(),
          students_assessed: obj({ previous: int(), current: int() }),
          participation_rate: numN(), schools: int(),
          focus: { type: ['object', 'null'], description: 'The class × competency cell that drives the severity.' },
          cells_by_severity: { type: 'object', additionalProperties: { type: 'integer' } },
          hot_sub_areas: int(), open_cases: int(), critical_open_cases: int(), overdue_tasks: int(),
        }),
        Summary: obj({
          schools: int(),
          latest_round: { oneOf: [ref('Round'), { type: 'null' }] },
          cases: obj({
            total: int(), open: int(), critical_open: int(), awaiting_approval: int(), outcome_pending: int(), closed: int(), reopened_ever: int(),
            by_status: { type: 'object', additionalProperties: { type: 'integer' } },
            open_by_severity: { type: 'object', additionalProperties: { type: 'integer' } },
            by_stage: { type: 'object', additionalProperties: { type: 'integer' } },
            median_days_to_close: { type: ['integer', 'null'] },
          }),
          tasks: obj({ open: int(), overdue: int(), escalated_open: int(), verified: int() }),
          proof_awaiting_check: int(),
          outcomes: obj({ by_category: { type: 'object', additionalProperties: { type: 'integer' } } }),
        }),
      },
    },
  };
}
