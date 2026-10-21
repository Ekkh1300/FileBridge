import React from 'react';
import {
  Image as ImageIcon,
  FileText,
  Film,
  Music,
  Archive,
  File as FileIcon,
  FileSpreadsheet,
} from 'lucide-react';
import { rawUrl } from '../lib/api.js';
import { inlineable, majorKind } from '../lib/files.js';

/** Thumbnail for an image/video; a colored glyph for everything else. */
export default function Thumb({ item, me }) {
  const kind = item.kind || 'file';
  const mine = item.sourceDeviceId === me?.id;

  const canThumb = inlineable(kind) && kind !== 'pdf' && item.size > 0;
  const src = mine
    ? item.previewUrl || (canThumb && item.serverId ? rawUrl(item.serverId) : null)
    : item.status === 'done' && canThumb && item.serverId
      ? rawUrl(item.serverId)
      : null;

  if (src && (mine || item.status === 'done')) {
    if (kind === 'video') {
      return (
        <span className="block w-12 h-12 rounded-xl bg-raised border border-line overflow-hidden shrink-0">
          <video src={src} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        </span>
      );
    }
    return (
      <span className="block w-12 h-12 rounded-xl bg-raised border border-line overflow-hidden shrink-0">
        <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </span>
    );
  }

  return (
    <span className="grid place-items-center w-12 h-12 rounded-xl bg-raised border border-line shrink-0">
      <KindGlyph kind={kind} />
    </span>
  );
}

function KindGlyph({ kind }) {
  const k = majorKind(kind);
  if (k === 'image') return <ImageIcon size={20} className="text-lav" />;
  if (k === 'pdf') return <FileText size={20} className="text-risk" />;
  if (k === 'video') return <Film size={20} className="text-accent" />;
  if (k === 'audio') return <Music size={20} className="text-lav" />;
  if (k === 'archive') return <Archive size={20} className="text-warn" />;
  if (k === 'doc') return <FileSpreadsheet size={20} className="text-good" />;
  if (k === 'text') return <FileText size={20} className="text-accent" />;
  return <FileIcon size={20} className="text-dim" />;
}
