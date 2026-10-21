import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, STORAGE_DIR } from './config.js';
import { uid, now, sha256, newDeviceToken, newPairingCode } from './util.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'filebridge.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  retention      TEXT NOT NULL DEFAULT '7d',
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ended_at       INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'guest',
  platform      TEXT NOT NULL DEFAULT 'Other',
  ua            TEXT NOT NULL DEFAULT '',
  token_hash    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_session ON devices(session_id);

CREATE TABLE IF NOT EXISTS pairings (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pairings_session ON pairings(session_id);

CREATE TABLE IF NOT EXISTS transfers (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  client_key   TEXT NOT NULL DEFAULT '',
  device_id    TEXT NOT NULL,
  device_name  TEXT NOT NULL DEFAULT '',
  device_kind  TEXT NOT NULL DEFAULT 'guest',
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT '',
  sniff_mime   TEXT NOT NULL DEFAULT '',
  sniff_kind   TEXT NOT NULL DEFAULT 'file',
  size         INTEGER NOT NULL,
  received     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'uploading',
  created_at   INTEGER NOT NULL,
  done_at      INTEGER,
  expires_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_transfers_session ON transfers(session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_key ON transfers(device_id, client_key);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  device_name  TEXT NOT NULL DEFAULT '',
  device_kind  TEXT NOT NULL DEFAULT 'guest',
  kind         TEXT NOT NULL DEFAULT 'text',
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`);

/* ------------------------------- sessions ---------------------------------- */

export const createSession = (retention = '7d') => {
  const id = uid();
  db.prepare('INSERT INTO sessions (id, retention, created_at, last_active_at) VALUES (?, ?, ?, ?)')
    .run(id, retention, now(), now());
  return getSession(id);
};
export const getSession = (id) =>
  db.prepare('SELECT * FROM sessions WHERE id = ? AND ended_at IS NULL').get(id);
export const touchSession = (id) =>
  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now(), id);
export const setSessionRetention = (id, retention) =>
  db.prepare('UPDATE sessions SET retention = ? WHERE id = ?').run(retention, id);
export const idleSessions = (before) =>
  db.prepare('SELECT id FROM sessions WHERE last_active_at < ?').all(before);

/* -------------------------------- devices ---------------------------------- */

export function createDevice({ session_id, name, kind = 'guest', platform = 'Other', ua = '' }) {
  const id = uid();
  const token = newDeviceToken();
  const token_hash = sha256(token);
  db.prepare(`INSERT INTO devices (id, session_id, name, kind, platform, ua, token_hash, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, session_id, name, kind, platform, ua, token_hash, now(), now());
  return { id, session_id, name, kind, platform, ua, token, token_hash };
}

export const getDevice = (id) =>
  db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

export const renameDevice = (id, name) =>
  db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id);

export const touchDevice = (id) =>
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now(), id);

export const endDevice = (id) =>
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);

export const countDeviceRows = (session_id) =>
  db.prepare('SELECT COUNT(*) AS n FROM devices WHERE session_id = ?').get(session_id).n;

export const listDevices = (session_id) =>
  db.prepare('SELECT * FROM devices WHERE session_id = ? ORDER BY created_at ASC').all(session_id);

export function deviceFromCookieValue(value) {
  const raw = String(value || '');
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const devId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!devId || !token) return null;
  const device = getDevice(devId);
  if (!device || device.token_hash !== sha256(token)) return null;
  const session = getSession(device.session_id);
  if (!session) return null;
  return { ...device, session };
}

export const publicDevice = (d, online = null) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  platform: d.platform,
  createdAt: d.created_at,
  lastSeenAt: d.last_seen_at,
  ...(online === null ? {} : { online: Boolean(online) }),
});

/* -------------------------------- pairings --------------------------------- */

export function createPairing(session_id, ttlMs) {
  const id = uid();
  const t = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode();
    try {
      db.prepare('INSERT INTO pairings (id, session_id, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, session_id, code, t, t + ttlMs);
      return { id, session_id, code, created_at: t, expires_at: t + ttlMs };
    } catch {
      // code collision (extremely unlikely) → try again
    }
  }
  throw new Error('pairing_insert_failed');
}

export const latestValidPairing = (session_id, at = now()) =>
  db.prepare('SELECT * FROM pairings WHERE session_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
    .get(session_id, at);

export const findValidPairing = (code, at = now()) =>
  db.prepare('SELECT * FROM pairings WHERE code = ? AND expires_at > ? LIMIT 1').get(code, at);

export const markPairingUsed = (id) =>
  db.prepare('UPDATE pairings SET used_at = ? WHERE id = ?').run(now(), id);

export const deleteExpiredPairings = (at) =>
  db.prepare('DELETE FROM pairings WHERE expires_at <= ?').run(at).changes;

/* ------------------------------- transfers --------------------------------- */

export const transferPath = (session_id, id) => path.join(STORAGE_DIR, session_id, id);

export function createTransfer({ session_id, client_key, device, filename, mime, size }) {
  const id = uid();
  const t = now();
  try {
    db.prepare(`INSERT INTO transfers
      (id, session_id, client_key, device_id, device_name, device_kind, filename, mime, size, received, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'uploading', ?)`)
      .run(id, session_id, client_key, device.id, device.name, device.kind, filename, mime, size, t);
  } catch (err) {
    const existing = findResumableTransfer(device.id, client_key);
    if (existing) return existing;
    throw err;
  }
  return getTransfer(id);
}

export const getTransfer = (id) =>
  db.prepare('SELECT * FROM transfers WHERE id = ?').get(id);

export const findResumableTransfer = (device_id, client_key) =>
  db.prepare(`SELECT * FROM transfers WHERE device_id = ? AND client_key = ?
              AND status IN ('uploading','failed') LIMIT 1`).get(device_id, client_key);

export const setTransferReceived = (id, received) =>
  db.prepare('UPDATE transfers SET received = MAX(received, ?) WHERE id = ?').run(received, id);

export const reopenTransfer = (id) =>
  db.prepare("UPDATE transfers SET status = 'uploading' WHERE id = ?").run(id);

export const setTransferSniff = (id, sniff_mime, sniff_kind) =>
  db.prepare('UPDATE transfers SET sniff_mime = ?, sniff_kind = ? WHERE id = ?')
    .run(sniff_mime, sniff_kind, id);

export const completeTransfer = (id, done_at, expires_at) =>
  db.prepare("UPDATE transfers SET status = 'done', done_at = ? , expires_at = ? WHERE id = ?")
    .run(done_at, expires_at, id);

export const failTransfer = (id) =>
  db.prepare("UPDATE transfers SET status = 'failed' WHERE id = ?").run(id);

export const deleteTransferRow = (id) =>
  db.prepare('DELETE FROM transfers WHERE id = ?').run(id).changes;

export const listTransfers = (session_id, limit = 100) =>
  db.prepare('SELECT * FROM transfers WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(session_id, limit);

/** Rows whose retention expired; also abandoned stale uploads. */
export const expiryDueTransfers = (at) =>
  db.prepare('SELECT * FROM transfers WHERE expires_at IS NOT NULL AND expires_at <= ?').all(at);
export const staleUploadTransfers = (createdBefore) =>
  db.prepare("SELECT * FROM transfers WHERE status = 'uploading' AND created_at < ?").all(createdBefore);

/** (Re)apply a retention policy to finished transfers of a session. */
export function applyRetention(session_id, retentionMs) {
  if (retentionMs === null) {
    db.prepare('UPDATE transfers SET expires_at = NULL WHERE session_id = ? AND status = ?')
      .run(session_id, 'done');
    return;
  }
  db.prepare(`UPDATE transfers SET expires_at = CASE
      WHEN done_at IS NOT NULL THEN done_at + ?1
      ELSE created_at + ?1 END
    WHERE session_id = ?2 AND status = 'done'`)
    .run(retentionMs, session_id);
}

export const sessionTransferIds = (session_id) =>
  db.prepare('SELECT id FROM transfers WHERE session_id = ?').all(session_id).map((r) => r.id);
export const deleteSessionTransfers = (session_id) =>
  db.prepare('DELETE FROM transfers WHERE session_id = ?').run(session_id).changes;

export const publicTransfer = (r) => ({
  id: r.id,
  // the id doubles as the server-side identity the client keys downloads on —
  // the initial HTTP list (transfers-set) must carry it too, not only WS events
  serverId: r.id,
  filename: r.filename,
  mime: r.mime || r.sniff_mime || '',
  kind: r.sniff_kind || 'file',
  size: r.size,
  received: r.received,
  status: r.status,
  sourceDeviceId: r.device_id,
  sourceName: r.device_name,
  sourceKind: r.device_kind,
  createdAt: r.created_at,
  doneAt: r.done_at,
  expiresAt: r.expires_at,
});

/* -------------------------------- messages --------------------------------- */

export function createMessage({ session_id, device, kind, body }) {
  const id = uid();
  db.prepare(`INSERT INTO messages (id, session_id, device_id, device_name, device_kind, kind, body, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, session_id, device.id, device.name, device.kind, kind, body, now());
  return getMessage(id);
}
export const getMessage = (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
export const deleteMessageRow = (id) =>
  db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes;
export const clearSessionMessages = (session_id) =>
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(session_id).changes;
export const listMessages = (session_id, limit = 100) =>
  db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(session_id, limit);

export const publicMessage = (m) => ({
  id: m.id,
  kind: m.kind,
  body: m.body,
  sourceDeviceId: m.device_id,
  sourceName: m.device_name,
  sourceKind: m.device_kind,
  createdAt: m.created_at,
});

/* --------------------------- full session teardown -------------------------- */

export function deleteSessionData(session_id) {
  db.prepare('DELETE FROM pairings WHERE session_id = ?').run(session_id);
  db.prepare('DELETE FROM transfers WHERE session_id = ?').run(session_id);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(session_id);
  db.prepare('DELETE FROM devices WHERE session_id = ?').run(session_id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(session_id);
}
