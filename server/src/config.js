import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const int = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};
const bytes = (v, d) => int(v, d);

/** True when running from a compiled standalone executable (pkg). */
export const IS_PACKAGED = Boolean(process.pkg);

/** Where the program itself lives (next to the .exe when packaged). */
const EXE_DIR = IS_PACKAGED ? path.dirname(process.execPath) : process.cwd();

/**
 * Where real files (database + received files) live.
 *  - dev:        <repo>/server/{storage,data}
 *  - portable:   next to the exe, in one tidy "FileBridge Data" folder
 *  - installed:  the exe folder may be read-only (Program Files), so fall back
 *                to %LOCALAPPDATA%\FileBridge
 */
function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const DATA_BASE = !IS_PACKAGED
  ? EXE_DIR
  : (isWritable(EXE_DIR)
    ? path.join(EXE_DIR, 'FileBridge Data')
    : path.join(process.env.LOCALAPPDATA || os.homedir(), 'FileBridge'));

export const PORT = int(process.env.PORT, 3000);
export const HOST = process.env.HOST || '0.0.0.0';

/**
 * Public base URL of this bridge — set it when the app is reached through a
 * reverse proxy or a VPN (e.g. Tailscale Serve → https://host.tailnet.ts.net).
 * The pairing QR then points to that address instead of the raw LAN IP.
 */
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
export const STORAGE_DIR = process.env.STORAGE_DIR || path.join(DATA_BASE, 'storage');
export const DATA_DIR = process.env.DATA_DIR || path.join(DATA_BASE, 'data');
/** Printed at boot so the user knows where the files live. */
export const DATA_ROOT_DIR = DATA_BASE;

/** Idle TTL for a whole session. */
export const SESSION_IDLE_MS = bytes(process.env.SESSION_IDLE_H, 24) * 3600 * 1000;
/** Pairing code lifetime. */
export const PAIRING_TTL_MS = int(process.env.PAIRING_TTL_M, 10) * 60 * 1000;

export const DEFAULT_RETENTION = '7d';
export const RETENTIONS = {
  '1h': 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  never: null, // keep until session ends
};

export const MAX_FILE_SIZE = bytes(process.env.MAX_FILE_SIZE, 2 * 1024 * 1024 * 1024); // 2 GB
export const CHUNK_LIMIT = bytes(process.env.CHUNK_LIMIT, 4 * 1024 * 1024); // per request
export const MAX_DEVICES = int(process.env.MAX_DEVICES, 8);
export const MAX_TEXT = 100_000;
export const MAX_NAME_LEN = 40;

export const COOKIE_NAME = 'fb_tok';
export const COOKIE_MAX_AGE = 7 * 24 * 3600;

/** Default host device name: the machine's hostname. */
export const HOST_DEFAULT_NAME = (os.hostname() || 'My PC').slice(0, MAX_NAME_LEN);

export function guessDefaultName(ua = '') {
  if (/Windows/i.test(ua)) return `PC · ${os.hostname()}`.slice(0, MAX_NAME_LEN);
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone'.slice(0, MAX_NAME_LEN);
  if (/Android/i.test(ua)) return 'Android'.slice(0, MAX_NAME_LEN);
  if (/Mobi/i.test(ua)) return 'My Phone';
  if (/Mac/i.test(ua)) return 'My Mac';
  if (/Linux/i.test(ua)) return 'My Linux';
  return 'My Device';
}

export function platformOf(ua = '') {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

/** True when the request looks like a phone/tablet. */
export function looksMobile(ua = '') {
  return /iPhone|iPad|iPod|Android.*Mobi?le|Mobile/i.test(ua);
}

/** All LAN URLs where clients can reach this server. Best guess first. */
export function lanUrls(port = PORT) {
  const out = [];
  const nets = os.networkInterfaces();
  const cands = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      let score = 0;
      if (/^192\.168\./.test(net.address)) score = 4;
      else if (/^10\./.test(net.address)) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(net.address)) score = 2;
      else score = 1;
      if (/^169\.254\./.test(net.address)) score = 0;
      cands.push({ addr: net.address, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    const url = `http://${c.addr}:${port}`;
    if (!out.includes(url)) out.push(url);
  }
  if (!out.includes(`http://localhost:${port}`)) out.push(`http://localhost:${port}`);
  return out;
}

/**
 * Where the built SPA lives.
 *  - dev:        <root>/client/dist (server runs with cwd = server/)
 *  - packaged:   inside the exe's bundled snapshot; assets are stored
 *                relative to the bundle entry, so the snapshot dir of
 *                build/app.cjs is <snapshot>/build → one level up: /client/dist
 */
const SNAPSHOT_DIR = process.pkg?.defaultEntrypoint
  ? path.dirname(process.pkg.defaultEntrypoint)
  : '';

export const CLIENT_DIST = IS_PACKAGED
  ? path.join(SNAPSHOT_DIR, '..', 'client', 'dist')
  : path.resolve(process.cwd(), '..', 'client', 'dist');
