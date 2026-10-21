import React, { useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, Copy, Check, Monitor, Smartphone, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { fmtCountdown } from '../lib/files.js';
import { copyText } from '../lib/clipboard.js';

/**
 * Host-side pairing panel: QR + manual code + LAN URLs + devices strip.
 * Props: expanded/controlled optional.
 */
export default function PairCard({ defaultOpen = false, compact = false }) {
  const { state, dispatch, toast } = useStore();
  const [open, setOpen] = useState(defaultOpen);
  const [qr, setQr] = useState(null); // full payload {code, expiresAt, urls, joinUrl, qr}
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');

  const isHost = state.isHost;
  const guests = state.devices.filter((d) => d.id !== state.me?.id);
  const renewingRef = useRef(false);

  useEffect(() => {
    if (!open || !isHost) return;
    let alive = true;
    setQr(null);
    setLoading(true);
    api.pairing()
      .then((p) => { if (alive) setQr(p); })
      .catch((e) => { if (alive) toast(e.message || 'Could not create pairing code', 'bad'); })
      .finally(() => { if (alive) setLoading(false); });
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isHost]);

  // separate effect: auto-renew expired QR (once per attempt)
  useEffect(() => {
    if (!open || !isHost || !qr) return;
    if (qr.expiresAt > now) return;
    if (renewingRef.current) return;
    renewingRef.current = true;
    api.renewPairing()
      .then((p) => { setQr(p); })
      .catch(() => { /* keep expired message; button still works */ })
      .finally(() => {
        renewingRef.current = false;
        setNow(Date.now());
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr?.expiresAt, now]);

  useEffect(() => {
    if (state.pairing && isHost && open && qr) {
      // keep countdown fresh from ws pushes
      if (state.pairing.expiresAt && state.pairing.expiresAt !== qr.expiresAt) {
        setQr((q) => ({ ...q, expiresAt: state.pairing.expiresAt }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pairing?.expiresAt]);

  if (!isHost) return null;

  const expired = qr && qr.expiresAt <= now;
  const needInvite = guests.length === 0;

  if (compact && !open) {
    return (
      <button className="btn btn-soft w-fit text-sm" onClick={() => setOpen(true)}>
        <QrCode size={15} /> Show QR to pair another device
      </button>
    );
  }

  if (!open && !needInvite) {
    return (
      <button className="btn btn-soft w-full text-sm" onClick={() => setOpen(true)}>
        <QrCode size={15} /> Invite another device
      </button>
    );
  }

  return (
    <section className="card p-4 fade-in" aria-label="Pair another device">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <QrCode size={16} className="text-accent" />
          {needInvite ? 'Scan this with your phone' : 'Pair another device'}
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost text-xs"
            title="Generate a code"
            disabled={loading}
            onClick={async () => {
              try {
                const p = await api.renewPairing();
                setQr(p);
              } catch (e) {
                toast(e.message || 'Renew failed', 'bad');
              }
            }}
          >
            <RefreshCw size={14} /> New QR
          </button>
          <button className="btn btn-ghost text-xs !px-2" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row items-center gap-4">
        <div
          className="shrink-0 w-40 h-40 rounded-2xl bg-white p-2 grid place-items-center border border-line"
          title="Scan with the phone camera to open the bridge"
        >
          {loading || !qr || !qr.qr ? (
            <Loader2 size={22} className="animate-spin text-dim" />
          ) : (
            <img src={qr.qr} width={140} height={140} alt="Pairing QR code" className="rounded-lg" />
          )}
        </div>

        <div className="min-w-0 flex-1 w-full">
          <p className="text-sm text-dim leading-relaxed">
            Open the phone camera → scan → it opens this bridge and connects.
            No app, no internet needed.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono tracking-[0.3em] text-lg font-bold select-all">
              {qr ? qr.code : '···· ····'}
            </span>
            {!loading && qr && (
              <button
                className="btn btn-ghost !px-2"
                onClick={async () => {
                  const r = await copyText(qr.code);
                  setCopied('code');
                  setTimeout(() => setCopied(''), 1500);
                }}
                aria-label="Copy code"
              >
                {copied === 'code' ? <Check size={15} className="text-good" /> : <Copy size={15} />}
              </button>
            )}
          </div>
          <p className={`text-xs mt-1 ${expired ? 'text-risk' : 'text-soft'}`}>
            {qr ? (expired ? 'Code expired — press “New QR”.' : `Expires in ${fmtCountdown(qr.expiresAt - now)}`) : '…'}
          </p>
        </div>
      </div>

      {/* connected devices */}
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-2 items-center">
        {state.devices.map((d) => (
          <span key={d.id} className="chip">
            {d.kind === 'host' ? <Monitor size={12} /> : <Smartphone size={12} />}
            {d.name}
            {d.online ? <span className="w-1.5 h-1.5 rounded-full bg-good" /> : <span className="w-1.5 h-1.5 rounded-full bg-soft/50" />}
          </span>
        ))}
      </div>
    </section>
  );
}
