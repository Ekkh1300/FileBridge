import React, { useRef } from 'react';
import { Upload, ImageIcon, FileText, Folder, ClipboardPaste } from 'lucide-react';
import { queue } from '../lib/upload.js';
import { useStore } from '../lib/store.jsx';

/**
 * The hero drop area. Click = picker; drag&drop handled at window level
 * (so any drop position transfers). Ctrl+V paste is handled by Studio.
 */
export default function DropZone({ connected }) {
  const fileRef = useRef(null);
  const imgRef = useRef(null);
  const pdfRef = useRef(null);
  const { state } = useStore();

  return (
    <section
      className="card border-dashed p-5 sm:p-6 text-center cursor-pointer hover:border-accent/60 transition-colors"
      onClick={() => fileRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop or choose files to send"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileRef.current?.click();
        }
      }}
    >
      <div className="pointer-events-none select-none py-2">
        <div className={`mx-auto w-14 h-14 rounded-2xl bg-accent-soft border border-line grid place-items-center ${state.wsStatus !== 'online' ? 'opacity-60' : ''}`}>
          <Upload size={24} className="text-accent" />
        </div>
        <h2 className="mt-3 font-bold tracking-tight">Drop files here</h2>
        <p className="text-sm text-dim mt-1">
          they fly straight to the other device — up to 2 GB each
        </p>
        <p className="text-xs text-soft mt-3">or just press Ctrl&nbsp;+&nbsp;V anywhere in this tab</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 max-w-sm mx-auto" onClick={(e) => e.stopPropagation()}>
        <PickButton icon={ImageIcon} label="Photo" accept="image/*" onPick={openRef(imgRef)} />
        <PickButton icon={FileText} label="PDF" accept="application/pdf,.pdf" onPick={openRef(pdfRef)} />
        <PickButton icon={Folder} label="File" accept="" onPick={openRef(fileRef)} />
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { consume(e); }}
      />
      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { consume(e); }}
      />
      <input
        ref={pdfRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => { consume(e); }}
      />
      <ClipboardPaste size={0} className="hidden" aria-hidden />
    </section>
  );
}

const openRef = (ref) => (e) => {
  e.stopPropagation();
  ref.current?.click();
};

function PickButton({ icon: Icon, label, accept, onPick, onClick }) {
  return (
    <button type="button" className={pickBtn} onClick={onClick || onPick} aria-label={`Send ${label}`}>
      <Icon size={18} className="text-accent shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

const pickBtn =
  'flex items-center justify-center gap-2 rounded-xl border border-line bg-raised hover:border-accent/50 hover:text-ink text-dim transition-colors text-sm font-medium min-h-[2.9rem] px-2';

function consume(e) {
  if (!e.target.files?.length) return;
  queue.add(e.target.files);
  e.target.value = '';
}
