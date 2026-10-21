import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { defaultName } from '../lib/device.js';
import { Logo } from '../App.jsx';

/** /join/:token — dropped straight from a scanned QR. */
export default function Join() {
  const { token } = useParams();
  const nav = useNavigate();
  const { boot, toast } = useStore();
  const [state, setState] = useState('pairing'); // pairing|done|error
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const clean = (token || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  useEffect(() => {
    if (!clean || clean.length < 6) {
      setState('error');
      setError('This link is missing its connection code.');
      return;
    }
    let canceled = false;
    (async () => {
      try {
        await api.join(clean, defaultName(navigator.userAgent));
        if (canceled) return;
        toast('Connected to the bridge', 'good');
        await boot();
        nav('/', { replace: true });
      } catch (e) {
        if (canceled) return;
        setState('error');
        setError(
          e instanceof ApiError
            ? e.message
            : 'Pairing failed — is the PC online?'
        );
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean]);

  const retryWithCode = async (ev) => {
    ev.preventDefault();
    const c = (name || '').replace(/[^A-Za-z0-9]/gi, '').toUpperCase();
    if (c.length < 8) {
      setError('The code needs all 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.join(c, defaultName(navigator.userAgent));
      await boot();
      nav('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pairing failed.');
      setBusy(false);
    }
  };

  if (state === 'pairing') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="flex flex-col items-center gap-4 text-center fade-in">
          <div className="relative">
            <Logo size={44} />
            <span className="absolute -right-2 -bottom-2 bg-surface border border-line rounded-full p-1">
              <Link2Pulse />
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Linking to the bridge…</h1>
          <p className="text-dim text-sm leading-relaxed max-w-[34ch]">
            Joining <span className="font-mono tracking-[.25em]">{display(clean)}</span> — keep the PC tab open.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm card p-5 fade-in">
        <div className="flex items-center gap-3 text-risk">
          <AlertCircle size={20} />
          <h1 className="font-bold">Pairing failed</h1>
        </div>
        <p className="mt-2 text-sm text-dim leading-relaxed">{error}</p>

        <form onSubmit={retryWithCode} className="mt-4 flex flex-col gap-3">
          <label className="text-sm text-dim" htmlFor="retry-code">
            Try a new code (shown on the PC after pressing “New QR”)
            <input
              id="retry-code"
              className="input mt-1.5 tracking-[0.35em] font-mono uppercase text-center"
              style={{}}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error ? null : null}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={16} />}
            Connect with code
          </button>
          <Link to="/" className="btn btn-ghost w-full">
            <ArrowLeft size={16} /> Back to start
          </Link>
        </form>
      </div>
    </main>
  );
}

function display(code) {
  if (code.length < 8) return code || '—';
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

function Link2Pulse() {
  return <Loader2 size={12} className="text-accent animate-spin" />;
}
