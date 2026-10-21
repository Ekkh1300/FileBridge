import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Monitor, Smartphone, Link2, Loader2, AlertCircle, Wifi } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { looksMobile, defaultName } from '../lib/device.js';
import { Logo } from '../App.jsx';

export default function Landing() {
  const nav = useNavigate();
  const { boot, toast } = useStore();
  const mobile = useMemo(() => looksMobile(navigator.userAgent), []);
  const [name, setName] = useState(defaultName(navigator.userAgent));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(mobile ? 'join' : 'host');

  const doHost = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.host(name || undefined);
      await boot();
      nav('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start a session.');
      setBusy(false);
    }
  };

  const doJoin = async (ev) => {
    ev?.preventDefault?.();
    const c = code.replace(/\s|-/g, '').toUpperCase();
    if (c.length < 8) {
      setError('Enter the full 8-character code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.join(c, (name || '').trim() || undefined);
      await boot();
      nav('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pairing failed.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-5 pb-24 pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center text-center gap-3 mt-6 mb-10 fade-in">
          <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-lg">
            <Logo size={40} />
          </div>
          <h1 className="text-[2rem] font-bold tracking-tight mt-1">FileBridge</h1>
          <p className="text-dim leading-relaxed max-w-[30ch]">
            Send photos, PDFs, files, text and your clipboard between your phone and PC — directly over your Wi-Fi.
          </p>
        </header>

        {/* mode switch */}
        <div
          className="flex gap-1 p-1 rounded-2xl bg-surface border border-line mb-5"
          role="tablist"
          aria-label="Choose this device's role"
        >
          <ModeButton id="host" active={mode === 'host'} onClick={() => setMode('host')} icon={Monitor} label="This is my PC" />
          <ModeButton id="join" active={mode === 'join'} onClick={() => setMode('join')} icon={Smartphone} label="Join a session" />
        </div>

        <section className="card p-5 fade-in" aria-live="polite">
          <form
            onSubmit={mode === 'host' ? (e) => { e.preventDefault(); doHost(); } : (e) => doJoin(e)}
            className="flex flex-col gap-4"
          >
            <label className="block">
              <span className="text-sm font-medium text-ink">Device name</span>
              <input
                className="input mt-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder={mode === 'host' ? 'My PC' : 'My Phone'}
                autoComplete="off"
              />
            </label>

            {mode === 'join' && (
              <label className="block">
                <span className="text-sm font-medium text-ink">Connection code</span>
                <input
                  className="input mt-1.5 tracking-[0.35em] font-mono uppercase text-center"
                  value={code}
                  onChange={(e) => setCode(e.target.value.slice(0, 10))}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD-EFGH"
                  aria-describedby="code-help"
                />
                <span id="code-help" className="text-xs text-soft mt-1.5 block">
                  Shown on the PC, next to the QR code.
                </span>
              </label>
            )}

            {error && (
              <p className="flex items-start gap-2 text-sm text-risk bg-risk/10 border border-risk/25 rounded-xl p-3">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
              {busy ? 'Linking…' : mode === 'host' ? 'Start on this computer' : 'Connect'}
            </button>
          </form>
        </section>

        <footer className="mt-6 text-center text-xs text-soft leading-relaxed">
          <p className="flex items-center justify-center gap-1.5">
            <Wifi size={13} /> Both devices must be on the same Wi-Fi / router.
          </p>
          <p className="mt-2">
            On the PC, press <span className="text-dim font-medium">Start</span>, then scan the QR with your phone camera.
          </p>
        </footer>
      </div>
    </main>
  );
}

function ModeButton({ id, active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors min-h-[2.9rem] ${
        active ? 'bg-raised text-ink shadow-sm border border-line' : 'text-dim hover:text-ink'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}
