export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || `Request failed (${status})`);
    this.status = status;
    this.code = data?.code || '';
    this.data = data;
  }
}

async function request(method, path, body) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  getSession: () => request('GET', '/api/session'),
  host: (name) => request('POST', '/api/host', { name }),
  join: (code, name) => request('POST', '/api/join', { code, name }),

  pairing: () => request('GET', '/api/session/pairing'),
  renewPairing: () => request('POST', '/api/session/pairing/renew'),
  setRetention: (retention) => request('POST', '/api/session/retention', { retention }),
  endSession: () => request('POST', '/api/session/end'),
  updateDevice: (name) => request('PATCH', '/api/device', { name }),
  leave: () => request('POST', '/api/device/leave'),
  revoke: (deviceId) => request('POST', '/api/device/revoke', { deviceId }),

  transfers: () => request('GET', '/api/transfers'),
  messages: () => request('GET', '/api/messages'),
  sendText: (kind, body) => request('POST', '/api/messages', { kind, body }),
  deleteMessage: (id) => request('DELETE', `/api/messages/${id}`),
  clearMessages: () => request('DELETE', '/api/messages'),

  initUpload: (payload) => request('POST', '/api/transfers', payload),
  completeUpload: (id) => request('POST', `/api/transfers/${id}/complete`),
  cancelTransfer: (id) => request('POST', `/api/transfers/${id}/cancel`),
  deleteTransfer: (id) => request('POST', `/api/transfers/${id}/delete`),

  /** raw binary chunk upload; returns parsed json or throws */
  chunk: async (id, offset, blob, signal) => {
    let res;
    try {
      res = await fetch(`/api/transfers/${id}/chunk?offset=${offset}`, {
        method: 'POST',
        body: blob,
        headers: { 'content-type': 'application/octet-stream' },
        signal,
        credentials: 'same-origin',
      });
    } catch (e) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      throw new TypeError('network'); // normalize to a network error for retry
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new ApiError(res.status, data);
      err.network = res.status >= 500;
      throw err;
    }
    return data;
  },
};

export const rawUrl = (id) => `/files/${id}/raw`;
export const fileUrl = (id) => `/files/${id}/download`;
