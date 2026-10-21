import React from 'react';
import { Settings, Loader2 } from 'lucide-react';
import { Logo } from '../App.jsx';
import { useStore } from '../lib/store.jsx';

export default function Header({ onSettings }) {
  const { state } = useStore();
  const s = statusOf(state);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/80 border-b border-line">
      <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={22} />
          <span className="font-bold tracking-tight text-[0.95rem]">FileBridge</span>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill status={s} />
          <button
            className="btn btn-ghost !px-2"
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function statusOf(state) {
  if (state.wsStatus === 'online') return 'online';
  if (state.wsStatus === 'reconnecting') return 'reconnecting';
  if (state.wsStatus === 'unauthorized') return 'reconnecting';
  if (state.wsStatus === 'connecting') return 'connecting';
  return 'offline';
}

function StatusPill({ status }) {
  const map = {
    online: { dot: 'bg-good', label: 'Connected', live: false },
    reconnecting: { dot: 'bg-warn', label: 'Reconnecting…', live: true },
    connecting: { dot: 'bg-warn', label: 'Connecting…', live: true },
    offline: { dot: 'bg-risk', label: 'Offline', live: false },
  };
  const m = map[status] || map.offline;
  return (
    <span className="chip" role="status">
      <span className={`w-2 h-2 rounded-full ${m.dot} ${m.live ? 'up-down-steps' : ''}`} />
      <span className={status !== 'online' ? 'flex items-center gap-1' : ''}>
        {m.label}
        {m.live && <Loader2 size={11} className="animate-spin opacity-60" />}
      </span>
    </span>
  );
}
