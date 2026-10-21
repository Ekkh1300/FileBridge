import fsp from 'node:fs/promises';
import path from 'node:path';
import { SESSION_IDLE_MS, STORAGE_DIR } from './config.js';
import * as db from './db.js';
import { emitSessionEvent, closeDeviceSockets } from './ws.js';
import { sweepRateBuckets } from './rate.js';

const STALE_UPLOAD_MS = 6 * 3600 * 1000;

let timer = null;
export function startCleanup(intervalMs = 120_000) {
  const run = () => sweep().catch((e) => console.error('[cleanup]', e?.message || e));
  run();
  timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}
export function stopCleanup() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function safeUnlink(p) {
  try { await fsp.unlink(p); } catch { /* already gone */ }
}

async function sweep() {
  const t = Date.now();
  sweepRateBuckets();

  // 1) expired finished transfers
  for (const row of db.expiryDueTransfers(t)) {
    db.deleteTransferRow(row.id);
    await safeUnlink(db.transferPath(row.session_id, row.id));
    emitSessionEvent(row.session_id, { type: 'transfer:deleted', id: row.id });
  }

  // 2) abandoned uploads nobody completed
  for (const row of db.staleUploadTransfers(t - STALE_UPLOAD_MS)) {
    db.deleteTransferRow(row.id);
    await safeUnlink(db.transferPath(row.session_id, row.id));
    emitSessionEvent(row.session_id, { type: 'transfer:deleted', id: row.id });
  }

  // 3) expired pairing codes
  db.deleteExpiredPairings(t);

  // 4) idle sessions → full teardown
  for (const s of db.idleSessions(t - SESSION_IDLE_MS)) {
    console.log(`[cleanup] ending idle session ${s.id.slice(0, 8)}…`);
    await endSessionNow(s.id);
  }

  // 5) orphaned files (crash leftovers)
  await sweepOrphans();
}

/** Remove files that no transfer row references, and empty session dirs. */
async function sweepOrphans() {
  let entries;
  try {
    entries = await fsp.readdir(STORAGE_DIR, { withFileTypes: true });
  } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(STORAGE_DIR, entry.name);
    const known = new Set(db.sessionTransferIds(entry.name));
    const sessionAlive = Boolean(db.getSession(entry.name));
    if (!sessionAlive) {
      if (known.length === 0) {
        await safeRmDir(dir);
        continue;
      }
    }
    let files;
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!known.has(f)) await safeUnlink(path.join(dir, f));
    }
  }
}

async function safeRmDir(dir) {
  try { await fsp.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** End a session immediately: notify, close sockets, delete rows + files. */
export async function endSessionNow(sessionId) {
  emitSessionEvent(sessionId, { type: 'session:revoked' });
  for (const d of db.listDevices(sessionId)) {
    closeDeviceSockets(d.id);
  }
  db.deleteSessionData(sessionId);
  await safeRmDir(path.join(STORAGE_DIR, sessionId));
}
