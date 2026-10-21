import React from 'react';
import {
  Download, ExternalLink, X, RefreshCw, Trash2, ArrowUpRight, ArrowDownLeft, CircleAlert, CheckCircle2, Send,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { queue } from '../lib/upload.js';
import { api, rawUrl, fileUrl } from '../lib/api.js';
import { saveViaBlob, BLOB_SAVE_MAX, fmtBytes, fmtTime, inlineable } from '../lib/files.js';
import Thumb from './Thumb.jsx';

export default function TransferList() {
  const { state } = useStore();
  const { me, transfers, wsStatus } = state;

  const active = transfers.filter((t) => ['waiting', 'uploading', 'failed'].includes(t.status));
  const closed = transfers.filter((t) => t.status === 'done' || t.status === 'canceled');

  if (transfers.length === 0) {
    return (
      <section className="card p-6 text-center" aria-label="Recent transfers">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-raised border border-line grid place-items-center">
          <Send size={20} className="text-soft" />
        </div>
        <p className="font-semibold text-sm mt-3">No transfers yet</p>
        <p className="text-xs text-soft mt-1">Send something — it lands here instantly. Nothing leaves your Wi-Fi.</p>
      </section>
    );
  }

  return (
    <section aria-label="Recent transfers" className="flex flex-col gap-3">
      {active.length > 0 && (
        <div className="card p-2">
          {active.map((t) => <Row key={t.id} item={t} me={me} wsStatus={wsStatus} />)}
        </div>
      )}
      {closed.length > 0 && (
        <div className="card p-2">
          {closed.slice(0, 40).map((t) => <Row key={t.id} item={t} me={me} wsStatus={wsStatus} />)}
          {closed.length > 40 && (
            <p className="text-center text-xs text-soft py-2">Older transfers stay until auto-delete kicks in.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ item, me, wsStatus }) {
  const { toast } = useStore();
  const mine = item.sourceDeviceId === me?.id || item.sourceIsMe;
  const dir = mine ? 'out' : 'in';
  const pct = item.size > 0
    ? Math.min(100, Math.round(((dir === 'out' ? item.sent : item.received) / item.size) * 100))
    : 100;

  const failed = item.status === 'failed';
  const uploading = item.status === 'uploading' || item.status === 'waiting';
  const done = item.status === 'done';

  /** Standalone PWAs (added to the home screen) silently swallow blob anchor
   *  downloads on Android Chrome — use the direct-URL download there. Tiny
   *  files take the blob path; on any blob failure fall back to the URL. */
  const startDownload = () => {
    const url = fileUrl(item.serverId);
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    if (standalone || !(item.size <= BLOB_SAVE_MAX)) {
      window.location.assign(url);
      return;
    }
    saveViaBlob(url, item.filename).catch((e) => {
      toast(e.message, 'bad');
      window.location.assign(url);
    });
  };

  const statusLabel =
    item.status === 'waiting'
      ? 'Waiting…'
      : item.status === 'uploading'
        ? dir === 'out' ? `Sending ${pct}%` : `Receiving ${pct}%`
        : item.status === 'failed'
          ? 'Failed'
          : item.status === 'done'
            ? dir === 'out' ? 'Sent' : 'Received'
            : item.status;

  const openable = done && inlineable(item.kind) && item.serverId;

  return (
    <article className="flex items-center gap-3 px-2 py-2.5 rounded-xl">
      <span className="relative shrink-0">
        <Thumb item={item} me={me} />
        {failed && (
          <span className="absolute -right-1.5 -top-1.5 bg-risk text-bg rounded-full p-0.5 shadow">
            <CircleAlert size={12} />
          </span>
        )}
        {done && (
          <span className="absolute -right-1.5 -top-1.5 bg-good text-bg rounded-full p-0.5 shadow">
            <CheckCircle2 size={12} />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="font-medium text-sm truncate" title={item.filename}>{item.filename}</p>
          <span className="text-xs text-soft shrink-0 tabular-nums">{fmtBytes(item.size)}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-soft mt-0.5">
          <span className="inline-flex items-center gap-1" style={{ color: dir === 'out' ? 'var(--fb-lav)' : 'var(--fb-accent)' }}>
            {dir === 'out' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
            {dir === 'out' ? (item.serverId || uploadPending(item) ? `You → ${counterpartLabel(item, me)}` : 'You') : item.sourceName}
          </span>
          <span>·</span>
          <span>{statusLabel}</span>
          {item.status === 'done' && item.updatedAt ? <span className="hidden sm:inline">· {fmtTime(item.createdAt)}</span> : null}
          {failed && item.error?.transient && wsStatus !== 'online' && <span className="text-warn">· network back online → resumes</span>}
        </div>

        {uploading && (
          <div className="mt-2 flex items-center gap-2">
            <div className="prog flex-1"><span style={{ width: `${pct}%` }} /></div>
            <span className="text-xs tabular-nums text-soft w-9 text-right">{pct}%</span>
          </div>
        )}
        {failed && item.error && (
          <p className="mt-1 text-xs text-risk flex items-center gap-1">
            <CircleAlert size={12} /> {item.error.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {uploading && mine && (
          <RowBtn label="Cancel" onClick={() => queue.cancel(item.id)}>
            <X size={16} />
          </RowBtn>
        )}
        {failed && mine && (
          <RowBtn label="Retry" onClick={() => queue.retry(item.id)}>
            <RefreshCw size={16} />
          </RowBtn>
        )}
        {failed && !mine && (
          <RowBtn label="Remove entry" onClick={() => api.deleteTransfer(item.serverId).catch((e) => toast(e.message, 'bad'))}>
            <Trash2 size={16} />
          </RowBtn>
        )}
        {done && openable && (
          <RowBtn label="Open" href={rawUrl(item.serverId)} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
          </RowBtn>
        )}
        {done && item.serverId && (
          <RowBtn label="Download" onClick={startDownload}>
            <Download size={16} />
          </RowBtn>
        )}
        {done && (
          <RowBtn
            label="Remove from both devices"
            onClick={() => {
              if (mine && item.id && !item.serverId) queue.deleteListed(item.id);
              else api.deleteTransfer(item.serverId).catch((e) => toast(e.message, 'bad'));
            }}
          >
            <Trash2 size={16} />
          </RowBtn>
        )}
      </div>
    </article>
  );
}

function RowBtn({ label, children, href, onClick, ...rest }) {
  const cls = "btn btn-ghost !min-h-8 !px-2 cursor-pointer";
  if (href) {
    return (
      <a className={cls} href={href} title={label} aria-label={label} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} title={label} aria-label={label} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

const uploadPending = (item) => ['waiting', 'uploading'].includes(item.status);
const counterpartLabel = (item, me) =>
  (me && me.kind === 'host' ? 'phone' : 'PC');
