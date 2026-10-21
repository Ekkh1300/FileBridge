/**
 * WebSocket singleton with auto-reconnect + exponential backoff.
 * Events are plain JSON {type, ...}.
 */

const WS_CLOSE = { UNAUTH: 4001, SESSION_END: 4002 };

const eventListeners = new Set();
const statusListeners = new Set();

let sock = null;
let closedByUs = true;
let attempt = 0;
let reconnectTimer = null;
let pingTimer = null;

function emit(listeners, payload) {
  for (const fn of listeners) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

function setStatus(status) {
  emit(statusListeners, status);
}

function clearTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function open() {
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    sock = new WebSocket(`${proto}//${location.host}/ws`);
  } catch {
    scheduleRetry();
    return;
  }

  sock.onopen = () => {
    attempt = 0;
    setStatus('online');
    pingTimer = setInterval(() => {
      try { if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* ignore */ }
    }, 20_000);
  };

  sock.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data);
      if (ev?.type) emit(eventListeners, ev);
    } catch { /* ignore malformed frames */ }
  };

  sock.onclose = (e) => {
    clearTimers();
    sock = null;
    if (e.code === WS_CLOSE.UNAUTH || e.code === WS_CLOSE.SESSION_END) {
      setStatus('unauthorized');
      return; // session ended / revoked — stop reconnecting; store resets
    }
    setStatus('reconnecting');
    if (!closedByUs) scheduleRetry();
  };

  sock.onerror = () => { /* onclose follows */ };
}

function scheduleRetry() {
  if (closedByUs) return;
  const delay = Math.min(15_000, 800 * 2 ** Math.min(attempt, 5));
  attempt += 1;
  reconnectTimer = setTimeout(open, delay);
}

export const ws = {
  get status() { return sock?.readyState === WebSocket.OPEN ? 'online' : 'offline'; },
  onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); },
  onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
  connect() {
    closedByUs = false;
    attempt = 0;
    clearTimers();
    open();
  },
  disconnect() {
    closedByUs = true;
    clearTimers();
    try { sock?.close(3000, bye); } catch { /* ignore */ }
    function bye() {} // eslint-disable-line
    sock = null;
  },
};
