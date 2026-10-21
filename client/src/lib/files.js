/** Formatting + file-type helpers. */

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 900) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function fmtTime(ts) {
  const d = Date.now() - (ts || 0);
  if (d < 45_000) return 'just now';
  const m = Math.round(d / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const day = new Date(ts);
  return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtCountdown(ms) {
  if (ms <= 0) return 'expired';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/* -------------------------------- file kinds -------------------------------- */

export const kindOf = (mime = '', name = '') => {
  const m = (mime || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) {
    if (ext === 'heic' || ext === 'heif' || m.includes('heic') || m.includes('heif')) return 'image-unsupported';
    return 'image';
  }
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (m.includes('zip') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (m.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml'].includes(ext)) return 'text';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'doc';
  return 'file';
};

/** Can the browser render it inline? (<img>/<audio>/<video> or the built-in PDF viewer) */
export const inlineable = (kind) => ['image', 'pdf', 'video', 'audio'].includes(kind);

export const majorKind = (kind) =>
  kind === 'image-unsupported' ? 'image' : kind;

export function guessMime(name = '') {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/plain', csv: 'text/plain', json: 'application/json', log: 'text/plain',
    zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    txts: 'text/plain',
  };
  return map[ext] || '';
}

/** Above this size use the plain URL download (no whole file in RAM). */
export const BLOB_SAVE_MAX = 32 * 1024 * 1024;

/**
 * Download without navigating: fetch the file as a Blob and save it from the page
 * itself. Navigation downloads (plain href) get flagged/blocked harder by Chrome
 * on plain-HTTP LAN pages; blob saves from the page are treated like page data.
 */
export async function saveViaBlob(url, filename, onStage = null) {
  const t0 = performance.now();
  const say = (e, m) => { onStage?.({ elapsed: (performance.now() - t0) / 1000, ...e }, m); };
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
    console.log(`[download] fetch ${url} -> HTTP ${res.status} after ${(performance.now() - t0).toFixed(0)}ms`);
    say({ stage: 'headers' });
  } catch (e) {
    console.warn('[download] fetch failed:', e?.message);
    throw new Error(`network: ${e.message}`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.message || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  let blob;
  try {
    blob = await res.blob();
    console.log(`[download] blob ready: ${blob.size} bytes (${blob.type}) after ${(performance.now() - t0).toFixed(0)}ms total`);
    say({ stage: 'blob' });
  } catch (e) {
    console.warn('[download] blob read failed:', e?.message);
    throw e;
  }
  try {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'file';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    console.log(`[download] anchor clicked: "${a.download}" (${blob.size} B, ${(performance.now() - t0).toFixed(0)}ms total)`);
    say({ stage: 'saved' });
  } catch (e) {
    console.warn('[download] anchor click failed:', e?.message);
    throw e;
  }
}
