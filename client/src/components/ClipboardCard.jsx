import React, { useState } from 'react';
import { ClipboardPaste, ClipboardCopy, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { readClipboard, copyText, canWriteClipboard } from '../lib/clipboard.js';
import { fmtTime } from '../lib/files.js';

/**
 * Clipboard bridge.
 * Reading: often permission-blocked (phones, plain http) → inline paste fallback.
 * Writing: usually fine with a user gesture (copy button).
 */
export default function ClipboardCard() {
  const { state, dispatch, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(null);   // when read is denied
  const [fallbackText, setFallbackText] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);

  const send = async (text, via) => {
    const clean = (text || '').replace(/\s+$/, '');
    if (!clean) return;
    setBusy(true);
    try {
      const { message } = await api.sendText('clipboard', clean);
      dispatch({ type: 'message-add', message });
      toast(via === 'paste' ? 'Pasted text sent' : 'Clipboard sent ✓', 'ok');
      setFallback(null);
      setFallbackText('');
    } catch (e) {
      toast(e?.message || 'Send failed', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const onSendClipboard = async () => {
    setBusy(true);
    const r = await readClipboard();
    setBusy(false);
    if (r.ok) {
      await send(r.text, 'read');
    } else {
      // honest fallback: user pastes manually
      setFallback(true);
      setFallbackText('');
      if (r.reason === 'unsupported') {
        toast('This browser can\'t read the clipboard — paste below instead', 'info');
      }
    }
  };

  const clipMessages = state.messages.filter((m) => m.kind === 'clipboard').slice(0, 8);

  return (
    <section className="card p-4" aria-label="Clipboard">
      <h2 className="font-semibold text-sm flex items-center gap-2">
        <ClipboardPaste size={15} className="text-accent" /> Clipboard
      </h2>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button className="btn btn-primary flex-1 text-sm" disabled={busy} onClick={onSendClipboard}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCopy size={16} />}
          Send my clipboard
        </button>
        <button
          className="btn btn-soft flex-1 text-sm"
          onClick={() => setFallback((v) => !v)}
          title="Paste text into the bridge manually"
        >
          <ClipboardPaste size={16} /> Paste to send
        </button>
      </div>

      {fallback && (
        <div className="mt-3 fade-in">
          <p className="text-xs text-soft flex items-start gap-1.5">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-warn" />
            The browser blocked clipboard reading (common on phones over http) — press and paste below, then send.
          </p>
          <textarea
            className="input mt-2 min-h-[70px]"
            placeholder="Paste here (long-press → Paste)…"
            value={fallbackText}
            onChange={(e) => setFallbackText(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex gap-2 justify-end">
            <button className="btn btn-ghost text-xs" onClick={() => setFallback(false)}>Cancel</button>
            <button
              className="btn btn-primary text-xs"
              disabled={busy || !fallbackText.trim()}
              onClick={() => send(fallbackText, 'paste')}
            >
              <ClipboardCopy size={13} /> Send pasted text
            </button>
          </div>
        </div>
      )}

      {clipMessages.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-line divide-y divide-line">
          {clipMessages.map((m) => (
            <li key={m.id} className="py-2.5 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-soft">
                  <span className="font-medium" style={{ color: m.sourceDeviceId === state.me?.id ? 'var(--fb-accent)' : 'var(--fb-dim)' }}>
                    {m.sourceDeviceId === state.me?.id ? 'You' : m.sourceName}
                  </span>
                  <span>{fmtTime(m.createdAt)}</span>
                </div>
                <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap break-words max-h-20 overflow-hidden">{m.body}</p>
              </div>
              <button
                className="btn btn-soft !min-h-0 px-3 py-1.5 text-xs"
                onClick={async () => {
                  setCopiedKey(m.id);
                  const r = await copyText(m.body);
                  toast(
                    r.ok ? 'On your clipboard ✓' : `Browser blocked it — long-press the text above`,
                    r.ok ? 'ok' : 'bad'
                  );
                  setTimeout(() => setCopiedKey(null), 1800);
                }}
                disabled={!canWriteClipboard() && false}
              >
                {copiedKey === m.id ? <Check size={13} className="text-good" /> : <Copy size={13} />}
                {copiedKey === m.id ? 'Copied' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
