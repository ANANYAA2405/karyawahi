'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ASK_CLAUDE_EVENT } from './ask-claude';
import { SourceChip } from './AiBriefing';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from './primitives/sheet';
import { MicButton, SpeakButton } from './voice';
import { appendDictation, speakable } from '@/lib/voice-text';
import { FeedbackThumbs } from './Feedback';

/**
 * The Claude conversation UI. Streams from /api/ai/chat, shows which tools ran, renders
 * citations as links, and keeps the conversation in sessionStorage so the full page and the
 * drawer share it. Starter questions are optional — any question can be typed.
 */

interface ToolStep { id: string; label: string; status: 'running' | 'done' | 'failed'; records?: number }
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolStep[];
  sources?: string[];
  unverified?: string[];
  /** Figures in the answer that none of the retrieved records contain (the auditor pass). */
  unchecked?: string[];
  followUps?: string[];
  error?: { message: string; retryable: boolean };
  model?: string;
  streaming?: boolean;
  /** The AI log row of this answer, from the done event; feedback points at it. */
  interactionId?: string;
}
export interface ChatContext { path?: string; caseId?: string; area?: { level: string; id: string }; reportId?: string; label?: string }

const STORE = 'kv_ai_chat_v1';
const ID_RE = /\b(CASE-\d{4}|TSK-\d{5}|EVD-\d{6}|FND-\d{5}|PLN-\d{5}|APR-\d{5}|OUT-\d{4}|DGN-\d{5}|CEV-\d{6}|VIS-\d{6}|IMP-\d{4}|INT-\d{2}|CMP-\d{4}|BLKR-\d{5}|RPT-\d{5}|SCH-\d{5}|CLU-\d{3}|BLK-\d{2}|DST-\d{2})\b/;

// ---------------------------------------------------------------- minimal, safe markdown
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:[A-Z]+-[A-Z0-9-]+)(?:,\s*[A-Z]+-[A-Z0-9-]+)*\]|\b(?:CASE-\d{4}|TSK-\d{5}|INT-\d{2}|OUT-\d{4}|FND-\d{5}|SCH-\d{5})\b)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-paper-deep px-1 font-mono text-xs">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) out.push(<span key={k} className="inline-flex flex-wrap gap-1 align-baseline">{tok.slice(1, -1).split(/,\s*/).map((id) => (ID_RE.test(id) ? <SourceChip key={id} id={id} /> : <span key={id}>{id}</span>))}</span>);
    else out.push(<SourceChip key={k} id={tok} />);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim())); i++; }
      blocks.push(
        <div key={`t${i}`} className="my-2 overflow-x-auto rounded-lg border border-line">
          <table className="table text-sm"><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `th${i}${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${i}${ri}${ci}`)}</td>)}</tr>)}</tbody></table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
      blocks.push(<ul key={`u${i}`} className="my-1.5 space-y-1 pl-1">{items.map((it, j) => <li key={j} className="flex gap-2"><span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-300" /><span>{inline(it, `u${i}${j}`)}</span></li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push(<ol key={`o${i}`} className="my-1.5 space-y-1">{items.map((it, j) => <li key={j} className="flex gap-2"><span className="tnum w-4 shrink-0 text-right font-semibold text-ink-faint">{j + 1}.</span><span>{inline(it, `o${i}${j}`)}</span></li>)}</ol>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(<p key={`h${i}`} className="mb-1 mt-3 text-base font-semibold text-ink first:mt-0">{inline(h[2], `h${i}`)}</p>); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={`p${i}`} className="my-1.5 first:mt-0">{inline(para.join(' '), `p${i}`)}</p>);
  }
  return <>{blocks}</>;
}

// ---------------------------------------------------------------- conversation store
// Conversations live in sessionStorage (gone when the browser session ends), keyed by user so
// two officers sharing a browser never see each other's history.
interface Convo { id: string; title: string; updated: number; msgs: Msg[] }
interface Store { active: string; convos: Convo[] }
const storeKey = (user?: string) => `${STORE}:${user ?? 'anon'}`;
const newConvo = (): Convo => ({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: 'New conversation', updated: Date.now(), msgs: [] });
function loadStore(user?: string): Store {
  try {
    const raw = sessionStorage.getItem(storeKey(user));
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s.convos?.length) return { active: s.active, convos: s.convos.map((c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, streaming: false })) })) };
    }
  } catch { /* ignore */ }
  const c = newConvo();
  return { active: c.id, convos: [c] };
}

// ---------------------------------------------------------------- the panel
export function ChatPanel({ context, starters, compact = false, configured = true, userKey, withHistory = false, scopeLabel, ask }: {
  context?: ChatContext; starters: string[]; compact?: boolean; configured?: boolean; userKey?: string; withHistory?: boolean; scopeLabel?: string;
  /** A question asked from elsewhere on the page (askClaude); sent once per new `n`. */
  ask?: { q: string; n: number };
}) {
  const [store, setStore] = useState<Store | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setStore(loadStore(userKey)); }, [userKey]);
  const active = store?.convos.find((c) => c.id === store.active) ?? store?.convos[0];
  const msgs = active?.msgs ?? [];
  const setMsgs = useCallback((upd: Msg[] | ((xs: Msg[]) => Msg[])) => {
    setStore((st) => {
      if (!st) return st;
      const id = st.active;
      return {
        ...st,
        convos: st.convos.map((c) => {
          if (c.id !== id) return c;
          const next = typeof upd === 'function' ? upd(c.msgs) : upd;
          const firstQ = next.find((m) => m.role === 'user')?.content;
          return { ...c, msgs: next, updated: Date.now(), title: firstQ ? firstQ.slice(0, 70) : 'New conversation' };
        }),
      };
    });
  }, []);
  useEffect(() => {
    if (!store) return;
    try {
      const trimmed: Store = { active: store.active, convos: [...store.convos].sort((a, b) => b.updated - a.updated).slice(0, 20).map((c) => ({ ...c, msgs: c.msgs.slice(-30) })) };
      sessionStorage.setItem(storeKey(userKey), JSON.stringify(trimmed));
    } catch { /* quota */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [store, userKey]);
  const startNew = () => {
    abortRef.current?.abort();
    setStore((st) => {
      if (!st) return st;
      const cur = st.convos.find((c) => c.id === st.active);
      if (cur && cur.msgs.length === 0) return st;
      const c = newConvo();
      return { active: c.id, convos: [c, ...st.convos] };
    });
  };
  const switchTo = (id: string) => { if (busy) return; setStore((st) => (st ? { ...st, active: id } : st)); };
  const remove = (id: string) => {
    if (busy) return;
    setStore((st) => {
      if (!st) return st;
      const rest = st.convos.filter((c) => c.id !== id);
      if (!rest.length) { const c = newConvo(); return { active: c.id, convos: [c] }; }
      return { active: st.active === id ? rest[0].id : st.active, convos: rest };
    });
  };

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((xs) => (xs.length ? [...xs.slice(0, -1), fn(xs[xs.length - 1])] : xs));

  const askedRef = useRef(0);
  const send = useCallback(async (question: string, base?: Msg[]) => {
    const q = question.trim();
    if (!q || busy) return;
    const prior = (base ?? msgs).filter((m) => !m.error && m.content.trim());
    const next: Msg[] = [...prior, { role: 'user', content: q }, { role: 'assistant', content: '', tools: [], streaming: true }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ messages: next.slice(0, -1).map(({ role, content }) => ({ role, content })), context }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        patchLast((m) => ({ ...m, streaming: false, error: { message: j.error ?? `Request failed (${res.status}).`, retryable: res.status === 429 || res.status >= 500 } }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === 'meta') patchLast((m) => ({ ...m, model: e.model }));
          else if (e.type === 'text') patchLast((m) => ({ ...m, content: m.content + e.delta }));
          else if (e.type === 'tool_start') patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { id: e.id, label: e.label, status: 'running' }] }));
          else if (e.type === 'tool_end') patchLast((m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === e.id ? { ...t, status: e.ok ? 'done' : 'failed', records: e.records } : t)) }));
          else if (e.type === 'done') patchLast((m) => ({ ...m, streaming: false, sources: e.sources, unverified: e.citedNotRetrieved, unchecked: e.unsupportedFigures ?? [], followUps: e.followUps, interactionId: e.interactionId }));
          else if (e.type === 'error') patchLast((m) => ({ ...m, streaming: false, error: { message: e.message, retryable: e.retryable } }));
        }
      }
      patchLast((m) => ({ ...m, streaming: false }));
    } catch (err) {
      if ((err as Error).name === 'AbortError') patchLast((m) => ({ ...m, streaming: false, content: m.content || '', error: m.content ? undefined : { message: 'Stopped.', retryable: true } }));
      else patchLast((m) => ({ ...m, streaming: false, error: { message: 'Connection lost before the answer finished.', retryable: true } }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      taRef.current?.focus();
    }
  }, [busy, msgs, context]);

  const retry = () => {
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const idx = msgs.lastIndexOf(lastUser);
    void send(lastUser.content, msgs.slice(0, idx));
  };

  const copy = async (i: number) => {
    try { await navigator.clipboard.writeText(msgs[i].content); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* blocked */ }
  };

  const sorted = store ? [...store.convos].sort((a, b) => b.updated - a.updated) : [];
  const history = withHistory ? (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line pr-3 md:flex" aria-label="Conversation history">
      <button type="button" onClick={startNew} className="btn-quiet btn-sm mb-3 w-full justify-center"><Icon name="plus" size={14} />New conversation</button>
      <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">This session</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {sorted.map((c) => (
          <li key={c.id} className="group relative">
            <button type="button" onClick={() => switchTo(c.id)} aria-current={c.id === active?.id ? 'true' : undefined}
              className={`block w-full rounded-lg px-2 py-1.5 pr-7 text-left ${c.id === active?.id ? 'bg-brand-light/70 text-ink' : 'text-ink-soft hover:bg-paper-sunk hover:text-ink'}`}>
              <span className="block truncate text-sm">{c.title}</span>
              <span className="block text-2xs text-ink-faint">{c.msgs.filter((m) => m.role === 'user').length} question{c.msgs.filter((m) => m.role === 'user').length === 1 ? '' : 's'} · {new Date(c.updated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </button>
            <button type="button" onClick={() => remove(c.id)} aria-label={`Delete conversation ${c.title}`} className="absolute right-1 top-1.5 hidden rounded p-1 text-ink-faint hover:bg-white hover:text-crit group-hover:block"><Icon name="x" size={13} /></button>
          </li>
        ))}
      </ul>
      <p className="mt-3 px-2 text-2xs leading-snug text-ink-faint">Kept only for this browser session, and only for you.</p>
    </aside>
  ) : null;

  useEffect(() => {
    if (!ask || !store || !configured || ask.n === askedRef.current) return;
    askedRef.current = ask.n;
    void send(ask.q);
  }, [ask, store, configured, send]);

  return (
    <div className={`flex min-h-0 gap-4 ${compact ? 'h-full' : 'h-[calc(100vh-280px)] min-h-[480px]'}`}>
    {history}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-sunk/60 px-3 py-2 text-xs text-ink-soft">
        <Icon name="target" size={13} className="text-brand" />
        <span>Context: <span className="font-medium text-ink">{context?.label ?? 'All records in your scope'}</span></span>
        {scopeLabel ? <span className="text-ink-faint">· scope {scopeLabel}</span> : null}
        {withHistory ? <button type="button" onClick={startNew} className="ml-auto text-brand hover:text-brand-dark md:hidden">New</button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4" aria-live="polite">
        {msgs.length === 0 ? (
          <div className="mx-auto max-w-2xl pt-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-light text-brand"><Icon name="sparkles" size={24} /></span>
            <p className="mt-4 font-display text-xl font-semibold text-ink">Ask anything about your cases, schools and outcomes</p>
            <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-ink-soft">
              Answers are built from records you are allowed to see, with the record ids cited. The assistant advises — it cannot approve, assign or close anything.
            </p>
            {!configured ? (
              <p className="mx-auto mt-4 max-w-md rounded-lg border border-warn/30 bg-warn-light px-3 py-2 text-sm text-warn">AI is not connected: no model API key is configured on the server.</p>
            ) : null}
            <div className={`mx-auto mt-6 grid gap-2 text-left ${compact ? '' : 'sm:grid-cols-2'}`}>
              {starters.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} disabled={!configured}
                  className="rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink-soft shadow-card transition-colors hover:border-brand/40 hover:text-ink disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {msgs.map((m, i) => (
              <Fragment key={i}>
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-base leading-relaxed text-white">{m.content}</div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-white"><Icon name="sparkles" size={15} /></span>
                    <div className="min-w-0 flex-1">
                      {m.tools && m.tools.length > 0 ? (
                        <ul className="mb-2 flex flex-wrap gap-1.5">
                          {m.tools.map((t) => (
                            <li key={t.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${t.status === 'failed' ? 'border-crit/30 bg-crit-light text-crit' : 'border-line bg-paper-sunk text-ink-soft'}`}>
                              {t.status === 'running' ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand border-t-transparent" /> : <Icon name={t.status === 'done' ? 'check' : 'alert'} size={12} />}
                              {t.label}{t.status === 'done' && t.records ? ` · ${t.records}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {m.content ? (
                        <div className="text-base leading-relaxed text-ink-soft"><Markdown text={m.content} />{m.streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-middle" /> : null}</div>
                      ) : m.streaming && !(m.tools?.length) ? (
                        <p className="flex items-center gap-2 text-sm text-ink-faint"><span className="flex gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:240ms]" /></span>Thinking…</p>
                      ) : null}
                      {m.error ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-crit/30 bg-crit-light px-3 py-2 text-sm text-crit" role="alert">
                          <Icon name="alert" size={15} />{m.error.message}
                          {m.error.retryable && i === msgs.length - 1 ? <button type="button" onClick={retry} className="btn-quiet btn-sm ml-auto">Retry</button> : null}
                        </div>
                      ) : null}
                      {!m.streaming && !m.error && m.content ? (
                        <div className="mt-2.5 space-y-2">
                          {m.sources && m.sources.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                              <span className="font-medium">Sources:</span>{m.sources.slice(0, 14).map((id) => <SourceChip key={id} id={id} />)}
                            </div>
                          ) : (
                            <p className="text-xs text-ink-faint">No record ids were cited in this answer.</p>
                          )}
                          {m.unchecked && m.unchecked.length > 0 ? (
                            <p className="flex items-center gap-1.5 text-xs text-warn"><Icon name="alert" size={13} />Figures not found in the records Claude read — check before relying on: {m.unchecked.join(', ')}</p>
                          ) : null}
                          {m.unverified && m.unverified.length > 0 ? (
                            <p className="flex items-center gap-1.5 text-xs text-warn"><Icon name="alert" size={13} />Mentioned but not retrieved in this answer — check before relying on: {m.unverified.join(', ')}</p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button type="button" onClick={() => copy(i)} className="btn-ghost btn-sm px-2 text-xs"><Icon name={copied === i ? 'check' : 'copy'} size={13} />{copied === i ? 'Copied' : 'Copy'}</button>
                            {i === msgs.length - 1 ? <button type="button" onClick={retry} disabled={busy} className="btn-ghost btn-sm px-2 text-xs"><Icon name="refresh" size={13} />Retry</button> : null}
                            <SpeakButton text={speakable(m.content)} size="sm" />
                            {m.model ? <span className="text-2xs text-ink-faint">{m.model} · AI-generated, verify before acting</span> : null}
                          </div>
                          {m.interactionId ? <FeedbackThumbs kind="claude_answer" target={m.interactionId} /> : null}
                          {i === msgs.length - 1 && m.followUps && m.followUps.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {m.followUps.map((f) => (
                                <button key={f} type="button" onClick={() => send(f)} className="rounded-full border border-brand/25 bg-white px-3 py-1 text-sm text-brand hover:bg-brand-light">{f}</button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="border-t border-line pt-3">
        <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-white p-2 shadow-card focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
          <textarea
            ref={taRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={configured ? 'Ask a question… (Enter to send, Shift+Enter for a new line)' : 'AI is not connected'}
            disabled={!configured}
            aria-label="Ask Claude"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-base text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <MicButton onText={(t) => setInput((v) => appendDictation(v, t))} disabled={!configured || busy} />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="btn-quiet h-10 px-3" aria-label="Stop generating"><Icon name="stop" size={15} />Stop</button>
          ) : (
            <button type="submit" disabled={!input.trim() || !configured} className="btn-primary h-10 px-3" aria-label="Send"><Icon name="send" size={16} /></button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-faint">
          <span>Scoped to your records · fictional demo data</span>
          {msgs.length > 0 ? <button type="button" onClick={() => { abortRef.current?.abort(); setMsgs([]); }} className="hover:text-ink">Clear conversation</button> : null}
        </div>
      </form>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------- the drawer
function useChatContext(): ChatContext {
  const path = usePathname();
  const sp = useSearchParams();
  const ctx: ChatContext = { path };
  const caseMatch = path.match(/^\/cases\/(CASE-\d{4})/);
  if (caseMatch) { ctx.caseId = caseMatch[1]; ctx.label = `Case ${caseMatch[1]}`; }
  if (path.startsWith('/hotspots')) {
    // The map selection lives in ?sel=; the level follows from the id prefix. The server
    // re-checks that the area is inside the user's scope before using it.
    const sel = sp.get('sel');
    const level = sel ? ({ DST: 'district', BLK: 'block', CLU: 'cluster', SCH: 'school' } as Record<string, string>)[sel.slice(0, 3)] : undefined;
    if (sel && level) { ctx.area = { level, id: sel }; ctx.label = `Selected ${level} ${sel}`; }
    else ctx.label = 'Learning hotspots';
  }
  const rep = path.match(/^\/reports\/(RPT-\d{5})/);
  if (rep) { ctx.reportId = rep[1]; ctx.label = `Report ${rep[1]}`; }
  if (!ctx.label) ctx.label = undefined;
  return ctx;
}

const STARTERS_FOR = (ctx: ChatContext): string[] =>
  ctx.caseId ? ['Explain this case in simple terms', 'What is missing before this case can close?', 'Why was this intervention selected, and what are the alternatives?', 'Have similar cases worked before?']
  : ctx.area ? ['Why is learning falling in this area?', 'Which schools contribute most here?', 'Are there open cases for this area?']
  : ctx.reportId ? ['Summarise this report', 'What decisions does this report call for?']
  : ['What should I prioritise this week?', 'Which cases need my approval?', 'Why are tasks overdue, and what is blocking them?', 'Prepare an agenda for tomorrow’s review meeting'];

export function AssistantDrawer({ configured, userKey, label = 'Ask Claude', hint = 'Ask Claude about this page' }: { configured: boolean; userKey?: string; label?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ q: string; n: number } | undefined>();
  const path = usePathname();
  const ctx = useChatContext();
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q !== 'string' || !q.trim()) return;
      setOpen(true);
      setAsk((prev) => ({ q, n: (prev?.n ?? 0) + 1 }));
    };
    window.addEventListener(ASK_CLAUDE_EVENT, onAsk);
    return () => window.removeEventListener(ASK_CLAUDE_EVENT, onAsk);
  }, []);
  if (path.startsWith('/assistant')) return <Link href="/assistant" className="btn-ghost gap-1.5 px-2.5 text-brand"><Icon name="sparkles" size={17} /><span className="hidden text-sm font-medium xl:inline">{label}</span></Link>;

  return (
    // Closing forgets the asked question, so reopening the drawer does not ask it again.
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAsk(undefined); }}>
      <SheetTrigger asChild>
        <button type="button" className="btn-ghost gap-1.5 px-2.5 text-brand no-print" title={hint}>
          <Icon name="sparkles" size={17} />
          <span className="hidden text-sm font-medium xl:inline">{label}</span>
        </button>
      </SheetTrigger>
      <SheetContent side="right" label="Claude" className="w-full max-w-[520px] bg-ivory">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white"><Icon name="sparkles" size={16} /></span>
            <div><p className="text-base font-semibold text-ink">Claude</p><p className="text-xs text-ink-faint">Reads only the records you can see</p></div>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/assistant" className="btn-ghost btn-sm" title="Open full page"><Icon name="arrow-up-right" size={15} /></Link>
            <SheetClose className="btn-ghost btn-sm" aria-label="Close"><Icon name="x" size={17} /></SheetClose>
          </div>
        </header>
        <div className="min-h-0 flex-1 px-4 pb-3 pt-3">
          <ChatPanel compact context={ctx} starters={STARTERS_FOR(ctx)} configured={configured} userKey={userKey} ask={ask} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
