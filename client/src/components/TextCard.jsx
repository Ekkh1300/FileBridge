import React, { useRef, useState } from 'react';
import { Send, Copy, Trash2, Type } from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { copyText } from '../lib/clipboard.js';
import { fmtTime } from '../lib/files.js';

const MAX = 100_000;

/** Quick text sending, with a small history. */
export default function TextCard() {
  const { state, dispatch, toast } = useStore();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);

  const send = async () => {
    const text = value.trim();
    if (!text || busy) return;
    if (text.length > MAX) {
      toast(`Text is limited to ${MAX.toLocaleString()} characters`, 'bad');
      return;
    }
    setBusy(true);
    try {
      const { message } = await api.sendText('text', text);
      dispatch({ type: 'message-add', message });
      setValue('');
    } catch (e) {
      toast(e?.message || 'Send failed', 'bad');
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const texts = state.messages.filter((m) => m.kind === 'text').slice(0, 20);

  return (
    <section className="card p-4" aria-label="Send text">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Type size={15} className="text-accent" /> Quick text
        </h2>
        {texts.length > 0 && state.isHost && (
          <button
            className="btn btn-ghost text-xs"
            onClick={() => api.clearMessages().catch((e) => toast(e.message, 'bad'))}
          >
            <Trash2 size={13} /> Clear all
          </button>
        )}
      </div>

      <textarea
        ref={taRef}
        className="input mt-3 min-h-[86px] resize-y"
        placeholder="Type or paste text here…  (Ctrl+Enter sends)"
        dir="auto"
        value={value}
        maxLength={MAX}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
        aria-label="Text to send"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-soft tabular-nums">
          {value.length > 0 && `${value.length.toLocaleString()} chars · `}
          {MAX.toLocaleString()} max
        </span>
        <button
          className="btn btn-primary h-10 px-4 text-sm"
          disabled={busy || !value.trim()}
          onClick={send}
        >
          <Send size={16} /> {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {texts.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-line divide-y divide-line">
          {texts.map((m) => (
            <li key={m.id} className="py-2.5 group">
              <div className="flex items-center gap-2 text-xs text-soft">
                <span className="font-medium" style={{ color: m.sourceDeviceId === state.me?.id ? 'var(--fb-accent)' : 'var(--fb-dim)' }}>
                  {m.sourceDeviceId === state.me?.id ? 'You' : m.sourceName}
                </span>
                <span>{fmtTime(m.createdAt)}</span>
                <span className="ml-auto flex items-center gap-0.5">
                  <IconBtn
                    label="Copy"
                    onClick={async () => {
                      const r = await copyText(m.body);
                      toast(r.ok ? 'Copied to clipboard' : 'Copy blocked — select the text instead', r.ok ? 'ok' : 'bad');
                    }}
                    icon={<Copy size={13} />}
                  />
                  <IconBtn
                    label="Reuse in the input box"
                    onClick={() => {
                      setValue(m.body);
                      taRef.current?.focus();
                    }}
                    icon={<Send size={13} />}
                  />
                  <IconBtn
                    label="Delete"
                    onClick={() => api.deleteMessage(m.id).catch(() => toast('Delete failed', 'bad'))}
                    icon={<Trash2 size={13} />}
                  />
                </span>
              </div>
              <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap break-words max-h-32 overflow-hidden">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconBtn({ label, onClick, icon }) {
  return (
    <button
      type="button"
      className="btn btn-ghost !min-h-0 !px-1.5 !py-1 cursor-pointer"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
