import React, { useEffect, useState } from 'react';
import { Smartphone, Monitor, Loader2 } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { queue } from '../lib/upload.js';
import Header from '../components/Header.jsx';
import PairCard from '../components/PairCard.jsx';
import DropZone from '../components/DropZone.jsx';
import TextCard from '../components/TextCard.jsx';
import ClipboardCard from '../components/ClipboardCard.jsx';
import TransferList from '../components/TransferList.jsx';
import SettingsModal from '../components/SettingsModal.jsx';

export default function Studio() {
  const { state } = useStore();
  const [settings, setSettings] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [pastFiles, setPastFiles] = useState(false);

  /* window-level drag & drop + paste */
  useEffect(() => {
    const hasFiles = (e) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth((d) => d + 1);
    };
    const onOver = (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        if (e.dataTransfer.dropEffect) e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onLeave = () => setDragDepth((d) => Math.max(0, d - 1));
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      const files = e.dataTransfer.files;
      if (files?.length) queue.add(files);
    };
    const onPaste = (e) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        queue.add(files);
        setPastFiles(true);
        setTimeout(() => setPastFiles(false), 2600);
      }
      // plain-text paste is left to the focused input (text composer)
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const guests = state.devices.filter((d) => d.id !== state.me?.id);
  const someoneOnline = guests.some((d) => d.online);

  return (
    <div className="min-h-screen">
      <Header onSettings={() => setSettings(true)} />
      <main className="max-w-xl mx-auto px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 flex flex-col gap-3.5">

        {/* counterpart strip */}
        <div className="flex items-center justify-center gap-2 text-sm">
          {state.me?.kind === 'host'
            ? <Monitor size={15} className="text-accent" />
            : <Smartphone size={15} className="text-lav" />}
          <span className="font-semibold">{state.me?.name}</span>
          <span className="text-soft">↔</span>
          {guests.length === 0 ? (
            <span className="text-soft italic">waiting for a device…</span>
          ) : (
            guests.map((d) => (
              <span key={d.id} className="chip !gap-1.5">
                {d.kind === 'host' ? <Monitor size={13} /> : <Smartphone size={13} />}
                <span className={d.online ? 'font-medium' : 'text-soft line-through opacity-70'}>{d.name}</span>
              </span>
            ))
          )}
        </div>

        {state.isHost && (
          <PairCard defaultOpen={guests.length === 0} />
        )}
        {!state.isHost && guests.length === 0 && (
          <p className="text-center text-xs text-soft">The PC must keep its tab open — it is the bridge.</p>
        )}

        <DropZone connected={someoneOnline} />
        <TextCard />
        <ClipboardCard />
        <TransferList />

        <footer className="text-center text-[0.7rem] text-soft pt-2 leading-relaxed">
          Local transfer only · files live on the host until auto-delete · nothing touches the internet
        </footer>
      </main>

      {settings && <SettingsModal onClose={() => setSettings(false)} />}

      {dragDepth > 0 && (
        <div className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm grid place-items-center pointer-events-none" role="presentation">
          <div className="border-2 border-dashed border-accent rounded-3xl px-10 py-8 text-center bg-surface/90 shadow-2xl">
            <p className="text-lg font-bold">Drop to send</p>
            <p className="text-sm text-dim mt-1">goes straight to {guests.length > 0 ? 'the paired device' : '…'}</p>
          </div>
        </div>
      )}
      {pastFiles && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 chip bg-surface !shadow-lg">
          <Loader2 size={12} className="animate-spin text-accent" /> Pasted files queued…
        </div>
      )}
    </div>
  );
}
