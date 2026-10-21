import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CHUNK_LIMIT, MAX_FILE_SIZE, RETENTIONS } from '../config.js';
import * as db from '../db.js';
import { requireDevice } from '../guard.js';
import { limiter } from '../rate.js';
import {
  sniffMime,
  sanitizeClientKey,
  sanitizeFilename,
  sanitizeMime,
  guessMimeFromName,
  serveRule,
  contentDisposition,
} from '../util.js';
import { emitSessionEvent } from '../ws.js';

/** track last progress broadcast per transfer to avoid flooding */
const lastEmit = new Map(); // transferId -> { t, received }

function maybeEmitProgress(row, received) {
  if (received >= row.size) return; // completion event covers this
  const prev = lastEmit.get(row.id);
  const t = Date.now();
  if (!prev || (t - prev.t >= 350 && prev.received !== received)) {
    lastEmit.set(row.id, { t, received });
    if (lastEmit.size > 800) {
      const oldest = [...lastEmit.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 400);
      for (const [k] of oldest) lastEmit.delete(k);
    }
    emitSessionEvent(row.session_id, {
      type: 'transfer:update',
      transfer: db.publicTransfer({ ...row, received }),
    });
  }
}

export default async function transferRoutes(fastify) {
  /* --------------------------------- list ------------------------------------ */

  fastify.get('/api/transfers', { preHandler: requireDevice }, async (req) => {
    const rows = db.listTransfers(req.fbd.session.id, 100);
    return { transfers: rows.map(db.publicTransfer) };
  });

  /* --------------------------------- init ------------------------------------ */

  fastify.post('/api/transfers', { preHandler: [requireDevice, limiter('api', 240)] }, async (req, reply) => {
    const dev = req.fbd;
    const body = req.body || {};
    const client_key = sanitizeClientKey(body.clientKey);
    if (client_key.length < 8) {
      return reply.code(400).send({ code: 'invalid_key', message: 'clientKey missing.' });
    }
    const size = Math.floor(Number(body.size));
    if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_SIZE) {
      return reply.code(400).send({ code: 'invalid_size', message: `Size must be between 0 and ${MAX_FILE_SIZE} bytes.` });
    }
    const session = db.getSession(dev.session.id);
    if (!session) {
      return reply.code(401).send({ code: 'session_ended', message: 'Session ended.' });
    }
    const filename = sanitizeFilename(body.filename);
    const mime = sanitizeMime(body.mime) || guessMimeFromName(filename);

    let row = db.findResumableTransfer(dev.id, client_key);
    if (row) {
      // resume: same (device, clientKey) still open
      db.reopenTransfer(row.id);
      row = db.getTransfer(row.id);
      emitSessionEvent(session.id, { type: 'transfer:update', transfer: db.publicTransfer(row) });
    } else {
      row = db.createTransfer({
        session_id: session.id,
        client_key,
        device: dev,
        filename,
        mime,
        size,
      });
      // most fresh keys are unique; a colliding key would have returned above.
      const filePath = db.transferPath(session.id, row.id);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
      emitSessionEvent(session.id, { type: 'transfer:new', transfer: db.publicTransfer(row) });
    }
    db.touchSession(session.id);
    return { transfer: db.publicTransfer(row), received: row.received, chunkLimit: CHUNK_LIMIT };
  });

  /* --------------------------------- chunk ----------------------------------- */

  fastify.post('/api/transfers/:id/chunk', {
    preHandler: [requireDevice, limiter('chunk', 4000)],
    bodyLimit: CHUNK_LIMIT + 2 * 1024,
  }, async (req, reply) => {
    const dev = req.fbd;
    const row = db.getTransfer(req.params.id);
    if (!row || row.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Transfer not found.' });
    }
    if (row.device_id !== dev.id) {
      return reply.code(403).send({ code: 'forbidden', message: 'Only the sender can upload chunks.' });
    }
    if (row.status !== 'uploading') {
      return reply.code(409).send({ code: 'not_uploading', message: `Transfer is ${row.status}.` });
    }
    const offset = Math.floor(Number(req.query.offset));
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!Number.isFinite(offset) || offset < 0 || offset > row.size) {
      return reply.code(400).send({ code: 'invalid_offset', message: 'Bad offset.' });
    }
    if (!body || body.length === 0 || body.length > CHUNK_LIMIT) {
      return reply.code(400).send({ code: 'invalid_chunk', message: `Chunk must be 1..${CHUNK_LIMIT} bytes.` });
    }
    if (offset + body.length > row.size) {
      return reply.code(400).send({ code: 'chunk_overflow', message: 'Chunk exceeds declared file size.' });
    }

    const filePath = db.transferPath(row.session_id, row.id);
    try {
      let fh;
      try {
        fh = await fsp.open(filePath, 'r+');
      } catch (e) {
        if (e.code === 'ENOENT') {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          await fsp.writeFile(filePath, '');
          fh = await fsp.open(filePath, 'r+');
        } else {
          throw e;
        }
      }
      try {
        await fh.write(body, 0, body.length, offset);
      } finally {
        await fh.close();
      }
    } catch (err) {
      req.log?.error?.(err);
      return reply.code(500).send({ code: 'write_failed', message: 'Could not write chunk.' });
    }

    db.setTransferReceived(row.id, offset + body.length);
    const updated = db.getTransfer(row.id);
    maybeEmitProgress(updated, updated.received);
    return { received: updated.received };
  });

  /* -------------------------------- complete ---------------------------------- */

  fastify.post('/api/transfers/:id/complete', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const row = db.getTransfer(req.params.id);
    if (!row || row.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Transfer not found.' });
    }
    if (row.device_id !== dev.id) {
      return reply.code(403).send({ code: 'forbidden', message: 'Not your transfer.' });
    }
    if (row.status === 'done') {
      return { transfer: db.publicTransfer(row) };
    }
    if (row.status !== 'uploading') {
      return reply.code(409).send({ code: 'not_uploading', message: `Transfer is ${row.status}.` });
    }
    if (row.received !== row.size) {
      return reply.code(409).send({ code: 'incomplete', message: `Received ${row.received}/${row.size} bytes.`, received: row.received });
    }

    // sniff first bytes for a trustworthy kind/mime
    let head = Buffer.alloc(0);
    try {
      const fh = await fsp.open(db.transferPath(row.session_id, row.id), 'r');
      try {
        const buf = Buffer.alloc(Math.min(256 * 1024, row.size));
        await fh.read(buf, 0, buf.length, 0);
        head = buf;
      } finally {
        await fh.close();
      }
    } catch { /* keep empty head */ }
    const sniff = sniffMime(head);
    db.setTransferSniff(row.id, sniff.mime, sniff.kind);

    const t = Date.now();
    const retentionMs = RETENTIONS[db.getSession(row.session_id)?.retention ?? '7d'];
    const expires = retentionMs === null ? null : t + retentionMs;
    db.completeTransfer(row.id, t, expires);
    lastEmit.delete(row.id);

    const fresh = db.getTransfer(row.id);
    emitSessionEvent(row.session_id, { type: 'transfer:update', transfer: db.publicTransfer(fresh) });
    return { transfer: db.publicTransfer(fresh) };
  });

  /* --------------------------------- cancel / delete --------------------------- */

  fastify.post('/api/transfers/:id/cancel', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const row = db.getTransfer(req.params.id);
    if (!row || row.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Transfer not found.' });
    }
    const isOwner = row.device_id === dev.id;
    if (!isOwner && dev.kind !== 'host') {
      return reply.code(403).send({ code: 'forbidden', message: 'Only the sender or the host can cancel.' });
    }
    db.deleteTransferRow(row.id);
    await fsp.rm(db.transferPath(row.session_id, row.id), { force: true });
    lastEmit.delete(row.id);
    emitSessionEvent(row.session_id, { type: 'transfer:deleted', id: row.id });
    return { ok: true };
  });

  fastify.post('/api/transfers/:id/delete', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const row = db.getTransfer(req.params.id);
    if (!row || row.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Transfer not found.' });
    }
    db.deleteTransferRow(row.id);
    await fsp.rm(db.transferPath(row.session_id, row.id), { force: true });
    lastEmit.delete(row.id);
    emitSessionEvent(row.session_id, { type: 'transfer:deleted', id: row.id });
    return { ok: true };
  });

  /* --------------------------------- file serving ------------------------------ */

  async function serveFile(req, reply, mode /* 'raw' | 'download' */) {
    const dev = req.fbd;
    const row = db.getTransfer(req.params.id);
    if (!row || row.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Not found in this session.' });
    }
    const filePath = db.transferPath(row.session_id, row.id);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return reply.code(410).send({ code: 'file_gone', message: 'File no longer available.' });
    }
    const rule = serveRule(row);
    const inline = mode === 'raw' && rule.inline;
    const type = inline ? rule.type : 'application/octet-stream';
    reply.header('content-type', type);
    reply.header('content-length', String(Math.min(stat.size, row.size)));
    if (inline) {
      reply.header('content-disposition', contentDisposition('inline', fileDisplayName(row)));
      reply.header('cache-control', 'private, max-age=3600');
    } else {
      reply.header('content-disposition', contentDisposition('attachment', fileDisplayName(row)));
      reply.header('cache-control', 'private, no-store');
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => reply.destroy?.());
    return reply.send(stream);
  }

  fastify.get('/files/:id/raw', { preHandler: requireDevice }, (req, reply) => serveFile(req, reply, 'raw'));
  fastify.get('/files/:id/download', { preHandler: requireDevice }, (req, reply) => serveFile(req, reply, 'download'));
}

function fileDisplayName(row) {
  return row.filename || 'file';
}
