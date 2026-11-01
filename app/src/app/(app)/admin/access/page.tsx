import { getLanguage } from '@/lib/session';
import { pageSession } from '@/lib/page-session';
import { may } from '@/lib/guard';
import { all } from '@/lib/db';
import { pick } from '@/lib/i18n';
import { PageHead, Callout, Card, CardHead, fmtInt } from '@/components/ui';
import { MATRIX, ACTIONS, ROLE_LABELS, type Grant } from '@domain/permissions';
import type { RoleCode } from '@domain/types';

/**
 * Roles, permissions and scope — rendered straight from src/domain/permissions.ts, the matrix
 * the server enforces on every write. Read-only: changing authority is a governance decision,
 * not a toggle on a web page.
 */

const ROLES: RoleCode[] = ['state_admin', 'deo', 'beo', 'brc', 'crc', 'headmaster', 'auditor', 'demo_admin'];
const LEVEL: Record<RoleCode, string> = {
  state_admin: 'State', deo: 'District', beo: 'Block', brc: 'Block', crc: 'Cluster',
  headmaster: 'School', auditor: 'State (read-only)', demo_admin: 'Demo',
};
const GRANT_STYLE: Record<Grant, string> = {
  yes: 'bg-good-light text-good border-good/30',
  own: 'bg-brand-light text-brand border-brand/30',
  spot: 'bg-pend-light text-pend border-pend/30',
  propose: 'bg-warn-light text-warn border-warn/30',
  raise: 'bg-warn-light text-warn border-warn/30',
  no: 'bg-paper-sunk text-ink-faint border-line',
};
const GRANT_TEXT: Record<Grant, string> = {
  yes: 'Yes', own: 'Own', spot: 'Spot-check', propose: 'Propose', raise: 'Raise', no: '—',
};

export default async function AccessPage() {
  const session = await pageSession();
  const lang = await getLanguage();
  if (!may(session, 'audit.view') && !may(session, 'users.manage')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHead title={pick(lang, 'Roles & permissions', 'भूमिकाएँ व अनुमतियाँ')} />
        <Callout tone="warn">{pick(lang, 'Your role cannot view the access model.', 'आपकी भूमिका यह नहीं देख सकती।')}</Callout>
      </div>
    );
  }

  const counts = new Map(
    all<{ role: string; c: number }>(
      `select ur.role, count(*) c from user_roles ur join users u on u.id = ur.user_id where u.status = 'active' group by ur.role`,
    ).map((r) => [r.role, Number(r.c)]),
  );

  return (
    <div className="space-y-5">
      <PageHead
        title={pick(lang, 'Roles, permissions & scope', 'भूमिकाएँ, अनुमतियाँ व दायरा')}
        sub={pick(
          lang,
          'This is the matrix the server checks on every action. Scope is applied on top of it: a “Yes” for a block officer means yes, within their own block.',
          'सर्वर हर कार्य पर यही तालिका जाँचता है। दायरा इसके ऊपर लागू होता है।',
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-xl border border-line bg-white px-4 py-3 shadow-card">
            <p className="text-sm font-semibold text-ink">{pick(lang, ROLE_LABELS[r].en, ROLE_LABELS[r].hi)}</p>
            <p className="text-xs text-ink-faint">{LEVEL[r]} · {fmtInt(counts.get(r) ?? 0)} {pick(lang, 'accounts', 'खाते')}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHead
          title={pick(lang, 'Permission matrix', 'अनुमति तालिका')}
          hint={pick(lang, 'Own = only records assigned to or submitted by that user. Spot-check = may verify a sample of others’ proof, never their own.', 'Own = केवल अपने रिकॉर्ड। Spot-check = दूसरों के सबूत की नमूना जाँच।')}
        />
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-paper-sunk">{pick(lang, 'Action', 'कार्य')}</th>
                {ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABELS[r].en.replace('Education Officer', 'EO').replace('Resource Coordinator', 'RC').replace('State programme team', 'State').replace('Demo administrator', 'Demo admin')}</th>)}
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((a) => (
                <tr key={a}>
                  <td className="sticky left-0 bg-white font-mono text-xs text-ink-soft">{a}</td>
                  {ROLES.map((r) => {
                    const g = MATRIX[a][r];
                    return (
                      <td key={r} className="text-center">
                        <span className={`chip ${GRANT_STYLE[g]}`}>{GRANT_TEXT[g]}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Callout tone="method" title={pick(lang, 'Authority by level', 'स्तर अनुसार अधिकार')}>
        {pick(
          lang,
          'Block-lever plans are decided by the BEO or DEO. District and PAB-lever plans are decided by the DEO or the state programme team. Only a BEO or DEO closes a case, and only on an eligible outcome. Nobody verifies evidence they submitted.',
          'खंड-स्तर योजनाएँ BEO या DEO तय करते हैं; ज़िला/PAB योजनाएँ DEO या राज्य दल। केवल BEO या DEO पात्र परिणाम पर प्रकरण बंद करते हैं।',
        )}
      </Callout>
    </div>
  );
}
