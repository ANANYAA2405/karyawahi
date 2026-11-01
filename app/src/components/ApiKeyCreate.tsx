'use client';

import { useActionState, useState } from 'react';
import { pick } from '@/lib/i18n';
import type { CreateKeyState } from '@/lib/actions-api';

type Action = (prev: CreateKeyState, form: FormData) => Promise<CreateKeyState>;

/**
 * The "new key" form. The area is chosen from the hierarchy: the state, one district, or one
 * block (grouped under its district). When the server makes the key, it comes back once in the
 * action's response and is shown here with a copy button; reloading the page loses it for good,
 * because only its hash is kept.
 */
export function ApiKeyCreate({
  action, lang, state, districts, blocks,
}: {
  action: Action;
  lang: 'en' | 'hi';
  state: { id: string; name: string };
  districts: { id: string; name: string }[];
  blocks: { id: string; name: string; district_id: string }[];
}) {
  const [res, formAction, pending] = useActionState(action, {});
  const [scope, setScope] = useState<'state' | 'district' | 'block'>('district');
  const [copied, setCopied] = useState(false);

  const scopeChoice = (value: 'state' | 'district' | 'block', en: string, hi: string) => (
    <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${scope === value ? 'border-brand bg-brand-light text-ink' : 'border-line bg-white text-ink-soft'}`}>
      <input type="radio" name="scope_type" value={value} checked={scope === value} onChange={() => setScope(value)} />
      {pick(lang, en, hi)}
    </label>
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <label className="block">
          <span className="label">{pick(lang, 'Name', 'नाम')}</span>
          <input
            name="name" required minLength={3} maxLength={80} className="input mt-1"
            placeholder={pick(lang, 'e.g. VSK dashboard — Rampur district', 'जैसे VSK डैशबोर्ड — रामपुर ज़िला')}
          />
          <span className="mt-1 block text-xs text-ink-faint">
            {pick(lang, 'Say which system will use it, so it is clear what to revoke later.', 'लिखें कि कौन-सा सिस्टम इसे इस्तेमाल करेगा, ताकि बाद में पता रहे किसे रद्द करना है।')}
          </span>
        </label>

        <fieldset>
          <legend className="label">{pick(lang, 'Area the key may read', 'कुंजी किस क्षेत्र का डेटा पढ़ सकती है')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {scopeChoice('state', 'Whole state', 'पूरा राज्य')}
            {scopeChoice('district', 'One district', 'एक ज़िला')}
            {scopeChoice('block', 'One block', 'एक विकासखंड')}
          </div>
        </fieldset>

        {scope === 'state' ? (
          <p className="text-sm text-ink-soft">
            <input type="hidden" name="state_id" value={state.id} />
            {pick(lang, 'Every district, block and school in', 'इसके सभी ज़िले, विकासखंड और विद्यालय:')} <strong>{state.name}</strong>
          </p>
        ) : null}
        {scope === 'district' ? (
          <label className="block">
            <span className="label">{pick(lang, 'District', 'ज़िला')}</span>
            <select name="district_id" className="input mt-1" required defaultValue="">
              <option value="" disabled>{pick(lang, 'Choose a district', 'ज़िला चुनें')}</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
            </select>
          </label>
        ) : null}
        {scope === 'block' ? (
          <label className="block">
            <span className="label">{pick(lang, 'Block', 'विकासखंड')}</span>
            <select name="block_id" className="input mt-1" required defaultValue="">
              <option value="" disabled>{pick(lang, 'Choose a block', 'विकासखंड चुनें')}</option>
              {districts.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {blocks.filter((b) => b.district_id === d.id).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        ) : null}

        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? pick(lang, 'Working…', 'हो रहा है…') : pick(lang, 'Create key', 'कुंजी बनाएँ')}
        </button>

        {res.error ? (
          <p role="alert" className="rounded-md border border-crit/30 bg-crit-light px-3 py-2 text-sm leading-relaxed text-crit">
            <span className="font-semibold">{pick(lang, 'Refused. ', 'अस्वीकृत। ')}</span>{res.error}
          </p>
        ) : null}
      </form>

      {res.token ? (
        <div role="status" className="rounded-lg border border-good/30 bg-good-light p-4">
          <p className="font-semibold text-ink">{pick(lang, 'Key created. Copy it now — it will not be shown again.', 'कुंजी बन गई। इसे अभी कॉपी करें — यह दोबारा नहीं दिखेगी।')}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {pick(lang, 'Only a fingerprint of it is kept here. If it is lost, revoke it and make a new one.', 'यहाँ केवल इसका फ़िंगरप्रिंट रखा जाता है। खो जाए तो इसे रद्द करके नई बनाएँ।')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code data-testid="new-api-key" className="block max-w-full overflow-x-auto whitespace-nowrap rounded-md border border-line bg-white px-3 py-2 font-mono text-sm text-ink">{res.token}</code>
            <button
              type="button" className="btn-quiet"
              onClick={() => { void navigator.clipboard?.writeText(res.token!).then(() => setCopied(true)); }}
            >
              {copied ? pick(lang, 'Copied', 'कॉपी हो गई') : pick(lang, 'Copy', 'कॉपी करें')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
