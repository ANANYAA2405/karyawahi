'use client';

import { useMemo, useState } from 'react';
import { ActionForm } from './ActionForm';
import { registerAction } from '@/lib/actions';

/** Registration form with a scope picker that follows the requested role's level. */

type Opt = { id: string; name: string; parent?: string };
const ROLES: { key: string; label: string; level: 'state' | 'district' | 'block' | 'cluster' | 'school' }[] = [
  { key: 'headmaster', label: 'Headmaster', level: 'school' },
  { key: 'crc', label: 'Cluster Resource Coordinator', level: 'cluster' },
  { key: 'brc', label: 'Block Resource Coordinator', level: 'block' },
  { key: 'beo', label: 'Block Education Officer', level: 'block' },
  { key: 'deo', label: 'District Education Officer', level: 'district' },
  { key: 'auditor', label: 'Auditor (state)', level: 'state' },
  { key: 'state_admin', label: 'State programme team', level: 'state' },
];

export function RegisterForm({ state, districts, blocks, clusters, schools }: { state: Opt; districts: Opt[]; blocks: Opt[]; clusters: Opt[]; schools: Opt[] }) {
  const [role, setRole] = useState('headmaster');
  const [d, setD] = useState(districts[0]?.id ?? '');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [s, setS] = useState('');
  const level = ROLES.find((r) => r.key === role)!.level;
  const bs = useMemo(() => blocks.filter((x) => x.parent === d), [blocks, d]);
  const cs = useMemo(() => clusters.filter((x) => x.parent === b), [clusters, b]);
  const ss = useMemo(() => schools.filter((x) => x.parent === c), [schools, c]);
  const scopeId = level === 'state' ? state.id : level === 'district' ? d : level === 'block' ? b : level === 'cluster' ? c : s;
  const sel = 'input mt-1';

  return (
    <ActionForm action={registerAction} hidden={{ scope_type: level, scope_id: scopeId }} label="Submit request" disabled={!scopeId} disabledReason="Choose where you work.">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-sm font-medium text-ink">Full name</span><input name="full_name" required minLength={3} maxLength={120} className={sel} autoComplete="name" /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Official email</span><input name="email" type="email" required className={sel} autoComplete="email" placeholder="name@demo.karyavahi.test" /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Mobile <span className="font-normal text-ink-faint">(optional)</span></span><input name="mobile" inputMode="tel" pattern="[0-9+\- ]{8,16}" className={sel} /></label>
          <label className="block"><span className="text-sm font-medium text-ink">Organisation / office</span><input name="organisation" maxLength={120} className={sel} placeholder="e.g. Block Education Office" /></label>
        </div>
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Requested role and place</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="text-sm font-medium text-ink">Role</span>
              <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={sel}>
                {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-faint">Requesting a role grants nothing. A senior officer responsible for the place you choose must approve it.</span>
            </label>
            {level !== 'state' ? (
              <label className="block"><span className="text-sm font-medium text-ink">District</span>
                <select value={d} onChange={(e) => { setD(e.target.value); setB(''); setC(''); setS(''); }} className={sel}>{districts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            ) : <p className="text-sm text-ink-soft sm:col-span-2">Assigned to the whole state: {state.name}.</p>}
            {['block', 'cluster', 'school'].includes(level) ? (
              <label className="block"><span className="text-sm font-medium text-ink">Block</span>
                <select value={b} onChange={(e) => { setB(e.target.value); setC(''); setS(''); }} className={sel}><option value="">Choose…</option>{bs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            ) : null}
            {['cluster', 'school'].includes(level) ? (
              <label className="block"><span className="text-sm font-medium text-ink">Cluster</span>
                <select value={c} onChange={(e) => { setC(e.target.value); setS(''); }} className={sel} disabled={!b}><option value="">Choose…</option>{cs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            ) : null}
            {level === 'school' ? (
              <label className="block"><span className="text-sm font-medium text-ink">School</span>
                <select value={s} onChange={(e) => setS(e.target.value)} className={sel} disabled={!c}><option value="">Choose…</option>{ss.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            ) : null}
          </div>
        </fieldset>
        <label className="block"><span className="text-sm font-medium text-ink">Staff / affiliation reference</span>
          <input name="affiliation_ref" className={sel} placeholder="EMP-EDU-1234" maxLength={24} />
          <span className="mt-1 block text-xs text-ink-faint">Checked against a <strong>simulated</strong> staff registry in this demo. Format EMP-DEPT-1234.</span></label>
      </div>
    </ActionForm>
  );
}
