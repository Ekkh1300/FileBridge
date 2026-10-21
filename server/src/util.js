import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newPairingCode() {
  const b = crypto.randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return raw; // stored raw; displayed with a dash
}
export const displayCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
/** Accepts "abcd-efgh", "abcd efgh", "abcdefgH" → normalized token. */
export const normalizeCode = (input) =>
  String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export const newDeviceToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------------------------------- cookies --------------------------------- */

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge = 0 } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge > 0) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (maxAge <= 0) parts.push('Max-Age=0');
  return parts.join('; ');
}

export const sessionCookie = (value) => serializeCookie('fb_tok', value, { maxAge: 7 * 24 * 3600 });
export const clearCookie = () => serializeCookie('fb_tok', '', { maxAge: 0 });

/* --------------------------------- filenames -------------------------------- */

/** Strictly defensive for filesystem; keeps the readable original for display. */
export function sanitizeFilename(input) {
  let name = String(input ?? '').split(/[\\/]+/).pop() || '';
  name = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '');
  if (!name || name === '.' || name === '..') return 'file';
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).slice(0, 12) : '';
    name = name.slice(0, Math.max(10, 120 - ext.length)) + ext;
  }
  return name;
}

export function sanitizeTextName(input, max = 40) {
  let name = String(input ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '')
    .replace(/[\\/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || 'Device').slice(0, max);
}

export function sanitizeClientKey(input) {
  return String(input ?? '').replace(/[^\w:.|@-]/g, '').slice(0, 180);
}

/* ------------------------------- mime sniffing ------------------------------ */

const startsWith = (b, offset, s) =>
  b.length >= offset + s.length &&
  b.subarray(offset, offset + s.length).toString('latin1') === s;

/**
 * Detect the real type from magic bytes. Returns { mime, kind }.
 * kind ∈ image|video|audio|pdf|archive|text|file
 */
export function sniffMime(b) {
  if (!Buffer.isBuffer(b) || b.length === 0) return { mime: 'application/octet-stream', kind: 'file' };
  if (b[0] === 0xff && b[1] === 0xd8) return { mime: 'image/jpeg', kind: 'image' };
  if (startsWith(b, 0, '\x89PNG')) return { mime: 'image/png', kind: 'image' };
  if (startsWith(b, 0, 'GIF8')) return { mime: 'image/gif', kind: 'image' };
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return { mime: 'image/webp', kind: 'image' };
  if (startsWith(b, 0, 'BM')) return { mime: 'image/bmp', kind: 'image' };
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { mime: 'image/x-icon', kind: 'image' };
  if (startsWith(b, 0, '%PDF')) return { mime: 'application/pdf', kind: 'pdf' };
  if (startsWith(b, 4, 'ftyp')) return { mime: 'video/mp4', kind: 'video' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', kind: 'video' };
  if (startsWith(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', kind: 'audio' };
  if (startsWith(b, 0, 'OggS')) return { mime: 'audio/ogg', kind: 'audio' };
  if (startsWith(b, 0, 'fLaC')) return { mime: 'audio/flac', kind: 'audio' };
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WAVE')) return { mime: 'audio/wav', kind: 'audio' };
  if (startsWith(b, 0, 'PK\u0003\u0004')) return { mime: 'application/zip', kind: 'archive' };
  if (startsWith(b, 0, 'Rar!')) return { mime: 'application/vnd.rar', kind: 'archive' };
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return { mime: 'application/x-7z-compressed', kind: 'archive' };

  // text heuristic (utf8 without NULs / heavy control chars)
  const slice = b.subarray(0, Math.min(b.length, 8192));
  let ctrl = 0;
  for (const c of slice) {
    if (c === 0) return { mime: 'application/octet-stream', kind: 'file' };
    // eslint-disable-next-line no-control-regex
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) ctrl++;
  }
  if (ctrl / slice.length < 0.03) return { mime: 'text/plain', kind: 'text' };
  return { mime: 'application/octet-stream', kind: 'file' };
}

/** Declared mime from the browser; hardened before storage. */
export function sanitizeMime(input) {
  const m = String(input ?? '').toLowerCase().trim();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(m)) return '';
  if (/html|svg|xml|script|javascript|ecma/i.test(m)) return '';
  return m;
}

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', csv: 'text/plain', json: 'application/json', log: 'text/plain',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
};
export function guessMimeFromName(name = '') {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_MIME[ext] || '';
}

/**
 * How the /files/:id endpoints may serve a row.
 * Only types we positively identified on the bytes themselves may render inline.
 */
export function serveRule(row) {
  const kind = row.sniff_kind || 'file';
  const sniff = row.sniff_mime || 'application/octet-stream';
  if (kind === 'image' && /^image\/(png|jpeg|gif|webp|bmp|x-icon)$/.test(sniff)) {
    return { inline: true, type: sniff };
  }
  if (kind === 'pdf' && sniff === 'application/pdf') return { inline: true, type: 'application/pdf' };
  if (kind === 'video' && /^video\/(mp4|webm)$/.test(sniff)) return { inline: true, type: sniff };
  if (kind === 'audio' && /^audio\/(mpeg|ogg|flac|wav)$/.test(sniff)) return { inline: true, type: sniff };
  return { inline: false, type: 'application/octet-stream' };
}

/** RFC 5987 safe Content-Disposition builder. */
export function contentDisposition(type, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  const utf8 = encodeURIComponent(filename).replace(/'/g, '%27');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Strip control chars but keep newlines/tabs for text bodies. */
export function cleanText(input) {
  return String(input ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '');
}
