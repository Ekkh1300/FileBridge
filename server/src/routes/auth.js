import QRCode from 'qrcode';
import {
  COOKIE_NAME,
  DEFAULT_RETENTION,
  HOST_DEFAULT_NAME,
  MAX_DEVICES,
  MAX_NAME_LEN,
  PAIRING_TTL_MS,
  RETENTIONS,
  guessDefaultName,
  lanUrls,
  looksMobile,
  platformOf,
} from '../config.js';
import * as db from '../db.js';
import { requireDevice } from '../guard.js';
import { limiter } from '../rate.js';
import {
  clearCookie,
  sessionCookie,
  displayCode,
  normalizeCode,
  now,
  sanitizeTextName,
} from '../util.js';
import { emitSessionEvent, closeDeviceSockets, isOnline } from '../ws.js';
import { endSessionNow } from '../cleanup.js';

async function pairingPayload(sessionId, { fresh = false } = {}) {
  const pair = fresh ? null : db.latestValidPairing(sessionId);
  const p = pair || db.createPairing(sessionId, PAIRING_TTL_MS);
  const urls = lanUrls();
  const joinUrl = `${urls[0]}/join/${p.code}`;
  let qr = null;
  try {
    qr = await QRCode.toDataURL(joinUrl, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0c10', light: '#ffffff' },
    });
  } catch { /* QR is optional; code entry still works */ }
  return {
    code: displayCode(p.code),
    token: p.code,
    expiresAt: p.expires_at,
    urls,
    joinUrl,
    qr,
  };
}

const sessionOut = (session) => ({
  id: session.id,
  retention: session.retention,
  createdAt: session.created_at,
});

export default async function authRoutes(fastify) {
  fastify.get('/api/health', async () => ({
    ok: true,
    name: 'FileBridge',
    time: now(),
    node: process.version,
  }));

  /* ------------------------------- host a session ------------------------------ */

  fastify.post('/api/host', { preHandler: limiter('auth', 20) }, async (req, reply) => {
    const ua = req.headers['user-agent'] || '';
    const name = sanitizeTextName(req.body?.name || HOST_DEFAULT_NAME, MAX_NAME_LEN);
    const session = db.createSession(DEFAULT_RETENTION);
    const device = db.createDevice({
      session_id: session.id,
      name,
      kind: 'host',
      platform: platformOf(ua),
      ua: ua.slice(0, 180),
    });
    const pairing = await pairingPayload(session.id, { fresh: true });
    reply.header('set-cookie', sessionCookie(`${device.id}.${device.token}`));
    return {
      session: sessionOut(session),
      device: db.publicDevice(device, true),
      isHost: true,
      pairing,
    };
  });

  /* --------------------------------- join a session ----------------------------- */

  fastify.post('/api/join', { preHandler: limiter('auth', 30) }, async (req, reply) => {
    const ua = req.headers['user-agent'] || '';
    const code = normalizeCode(req.body?.code);
    if (code.length < 6) {
      return reply.code(400).send({ code: 'invalid_code', message: 'That connection code looks incomplete.' });
    }
    const pair = db.findValidPairing(code);
    if (!pair) {
      return reply.code(404).send({ code: 'pairing_expired', message: 'Code expired or wrong. Generate a new QR on the PC.' });
    }
    const session = db.getSession(pair.session_id);
    if (!session) {
      return reply.code(404).send({ code: 'session_ended', message: 'That session has ended.' });
    }
    if (db.countDeviceRows(session.id) >= MAX_DEVICES) {
      return reply.code(429).send({ code: 'session_full', message: 'This session has too many devices.' });
    }
    const name = sanitizeTextName(req.body?.name || guessDefaultName(ua), MAX_NAME_LEN);
    const device = db.createDevice({
      session_id: session.id,
      name,
      kind: 'guest',
      platform: platformOf(ua),
      ua: ua.slice(0, 180),
    });
    db.markPairingUsed(pair.id);
    touchDeviceSet(session.id);
    reply.header('set-cookie', sessionCookie(`${device.id}.${device.token}`));
    emitSessionEvent(session.id, { type: 'device:joined', device: { ...devicePublic(device), online: true } }, device.id);
    return {
      session: sessionOut(session),
      device: db.publicDevice(device, true),
      isHost: false,
    };
  });

  /* --------------------------------- session view ------------------------------ */

  fastify.get('/api/session', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const session = db.getSession(dev.session_id);
    if (!session) {
      reply.header('set-cookie', clearCookie());
      return reply.code(401).send({ code: 'session_ended', message: 'Session ended or not paired.' });
    }
    db.touchDevice(dev.id);
    const devices = db.listDevices(session.id).map((d) => db.publicDevice(d, isOnline(d.id)));
    const pair = dev.kind === 'host' ? db.latestValidPairing(session.id) : null;
    return {
      session: sessionOut(session),
      me: db.publicDevice(dev, true),
      devices,
      isHost: dev.kind === 'host',
      pairing: pair ? { code: displayCode(pair.code), expiresAt: pair.expires_at } : null,
    };
  });

  /* ------------------------------- pairing upkeep ------------------------------ */

  fastify.get('/api/session/pairing', { preHandler: requireDevice }, async (req, reply) => {
    if (req.fbd.kind !== 'host') return reply.code(403).send({ code: 'forbidden', message: 'Only the host device can show the QR.' });
    const payload = await pairingPayload(req.fbd.session.id);
    emitSessionEvent(req.fbd.session.id, { type: 'pairing:new', ...payload }, req.fbd.id);
    return payload;
  });

  fastify.post('/api/session/pairing/renew', { preHandler: requireDevice }, async (req, reply) => {
    if (req.fbd.kind !== 'host') return reply.code(403).send({ code: 'forbidden', message: 'Only the host device can renew pairing.' });
    const payload = await pairingPayload(req.fbd.session.id, { fresh: true });
    emitSessionEvent(req.fbd.session.id, { type: 'pairing:new', ...payload });
    return payload;
  });

  /* --------------------------------- retention -------------------------------- */

  fastify.post('/api/session/retention', { preHandler: requireDevice }, async (req, reply) => {
    const retention = String(req.body?.retention || '');
    if (!(retention in RETENTIONS)) {
      return reply.code(400).send({ code: 'invalid_retention', message: 'Unknown retention value.' });
    }
    db.setSessionRetention(req.fbd.session.id, retention);
    db.applyRetention(req.fbd.session.id, RETENTIONS[retention]);
    emitSessionEvent(req.fbd.session.id, { type: 'session:retention', retention });
    return { retention };
  });

  /* ---------------------------------- teardown -------------------------------- */

  fastify.post('/api/session/end', { preHandler: requireDevice }, async (req, reply) => {
    if (req.fbd.kind !== 'host') return reply.code(403).send({ code: 'forbidden', message: 'Only the host can end the session.' });
    await endSessionNow(req.fbd.session.id);
    reply.header('set-cookie', clearCookie());
    return { ok: true };
  });

  /* --------------------------------- devices ---------------------------------- */

  fastify.patch('/api/device', { preHandler: requireDevice }, async (req) => {
    const name = sanitizeTextName(req.body?.name || req.fbd.name, MAX_NAME_LEN);
    db.renameDevice(req.fbd.id, name);
    emitSessionEvent(req.fbd.session.id, { type: 'device:update', id: req.fbd.id, name });
    return { device: db.publicDevice({ ...req.fbd, name }, true) };
  });

  fastify.post('/api/device/leave', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    if (dev.kind === 'host') {
      return reply.code(400).send({ code: 'host_cannot_leave', message: 'Host ends the session instead.' });
    }
    db.endDevice(dev.id);
    reply.header('set-cookie', clearCookie());
    emitSessionEvent(dev.session.id, { type: 'device:left', id: dev.id });
    closeDeviceSockets(dev.id);
    return { ok: true };
  });

  fastify.post('/api/device/revoke', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const deviceId = String(req.body?.deviceId || '');
    const target = db.getDevice(deviceId);
    if (!target || target.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Device not in this session.' });
    }
    if (target.kind === 'host') {
      return reply.code(400).send({ code: 'cannot_revoke_host', message: 'Host ends the session instead.' });
    }
    if (target.id !== dev.id && dev.kind !== 'host') {
      return reply.code(403).send({ code: 'forbidden', message: 'Only the host can remove other devices.' });
    }
    db.endDevice(target.id);
    emitSessionEvent(dev.session.id, { type: 'device:left', id: target.id });
    closeDeviceSockets(target.id);
    return { ok: true };
  });
}

/* Keep touch + shape helpers local */
function touchDeviceSet(sessionId) {
  // session activity marker on join
  db.touchSession(sessionId);
}
function devicePublic(d) {
  return db.publicDevice(d, isOnline(d.id));
}
