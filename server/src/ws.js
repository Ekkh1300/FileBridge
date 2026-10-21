import websocket from '@fastify/websocket';
import { displayCode, parseCookies } from './util.js';
import {
  listDevices,
  latestValidPairing,
  publicDevice,
  touchDevice,
  touchSession,
} from './db.js';
import { deviceFromRequest } from './guard.js';

/** deviceId -> Set<ws-socket> (a device can open several tabs). */
const sockets = new Map();
let heartbeat = null;

const ALIVE_CLEAR = Symbol('alive');

export async function setupWS(fastify) {
  await fastify.register(websocket, { options: { maxPayload: 1_048_576 } });

  fastify.get('/ws', { websocket: true }, (connection, request) => {
    // @fastify/websocket v11 passes the raw WebSocket; older versions pass a wrapper.
    const socket = connection && typeof connection.send === 'function' ? connection : connection.socket;

    const device = deviceFromRequest(request);
    if (!device) {
      try { socket.close(4001, 'unauthorized'); } catch { /* ignore */ }
      return;
    }
    if (!device.session) {
      try { socket.close(4002, 'session_closed'); } catch { /* ignore */ }
      return;
    }

    const sid = device.session.id;
    touchDevice(device.id);
    touchSession(sid);

    let set = sockets.get(device.id);
    if (!set) { set = new Set(); sockets.set(device.id, set); }
    set.add(socket);
    socket[ALIVE_CLEAR] = true;
    socket.on('pong', () => { socket[ALIVE_CLEAR] = true; });

    // initial state
    const devices = listDevices(sid).map((d) => publicDevice(d, isOnline(d.id)));
    const pair = device.kind === 'host' ? latestValidPairing(sid) : null;
    safeSend(socket, JSON.stringify({
      type: 'session-state',
      session: { id: sid, retention: device.session.retention },
      me: publicDevice(device, true),
      devices,
      pairing: pair ? { code: displayCode(pair.code), expiresAt: pair.expires_at } : null,
    }));

    // tell the rest a device is online
    emitSessionEvent(sid, { type: 'device:presence', id: device.id, online: true }, device.id);

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg && msg.type === 'ping') {
          safeSend(socket, JSON.stringify({ type: 'pong', t: msg.t ?? Date.now() }));
        }
      } catch { /* ignore malformed frames */ }
    });

    const gone = () => {
      const cur = sockets.get(device.id);
      if (!cur) return;
      cur.delete(socket);
      touchDevice(device.id);
      if (cur.size === 0) {
        sockets.delete(device.id);
        emitSessionEvent(sid, { type: 'device:presence', id: device.id, online: false }, device.id);
      }
    };
    socket.on('close', gone);
    socket.on('error', gone);
  });

  heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const s of set) {
        if (s[ALIVE_CLEAR]) {
          s[ALIVE_CLEAR] = false;
          try { s.ping(); } catch { try { s.terminate(); } catch { /* ignore */ } }
        } else {
          try { s.terminate(); } catch { /* ignore */ }
        }
      }
    }
  }, 15_000);
  if (heartbeat.unref) heartbeat.unref();
}

export function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export const isOnline = (deviceId) => {
  const set = sockets.get(deviceId);
  return Boolean(set && set.size > 0);
};

function safeSend(socket, payload) {
  try {
    if (socket.readyState === 1) socket.send(payload);
  } catch { /* ignore */ }
}

/** Send an event to every active socket of a device. */
export function emitDeviceEvent(deviceId, event) {
  const payload = JSON.stringify(event);
  const set = sockets.get(deviceId);
  if (!set) return;
  for (const s of set) safeSend(s, payload);
}

/** Broadcast an event to every online device in a session (optionally except one). */
export function emitSessionEvent(sessionId, event, exceptDeviceId = null) {
  const payload = JSON.stringify(event);
  for (const d of listDevices(sessionId)) {
    if (exceptDeviceId && d.id === exceptDeviceId) continue;
    const set = sockets.get(d.id);
    if (!set) continue;
    for (const s of set) safeSend(s, payload);
  }
}

/** Hard-close every socket belonging to a device. */
export function closeDeviceSockets(deviceId) {
  const set = sockets.get(deviceId);
  if (!set) return;
  for (const s of set) try { s.terminate(); } catch { /* ignore */ }
  sockets.delete(deviceId);
}
