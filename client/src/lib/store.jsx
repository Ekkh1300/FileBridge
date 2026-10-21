/**
 * Central store: session identity, devices, transfers, messages, toasts.
 * Wires the upload engine and the WebSocket events into one reducer.
 */
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, ApiError } from './api.js';
import { ws } from './ws.js';
import { queue } from './upload.js';
import { notifyIfHidden } from './notify.js';

const StoreCtx = createContext(null);

const initialState = {
  phase: 'loading',      // loading | landing | studio
  session: null,         // { id, retention }
  me: null,              // my device
  isHost: false,
  devices: [],
  pairing: null,         // { code, expiresAt } for the host
  transfers: [],         // newest first
  messages: [],          // newest first (kind: text | clipboard)
  wsStatus: 'idle',      // idle|connecting|online|reconnecting|unauthorized
  toasts: [],
};

let toastSeq = 0;

function reducer(state, ev) {
  switch (ev.type) {
    case 'boot':
      return {
        ...state,
        phase: 'studio',
        session: ev.session,
        me: ev.me,
        isHost: ev.isHost,
        devices: ev.devices,
        pairing: ev.pairing || null,
      };
    case 'reset':
      return { ...initialState, phase: 'landing', toasts: [] };

    case 'ws-status':
      return { ...state, wsStatus: ev.status };

    case 'devices-set':
      return { ...state, devices: ev.devices };
    case 'device-upsert': {
      const list = state.devices.filter((d) => d.id !== ev.device.id);
      return { ...state, devices: [...list, ev.device] };
    }
    case 'device-online': {
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === ev.id ? { ...d, online: ev.online } : d)),
      };
    }
    case 'device-update':
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === ev.id ? { ...d, name: ev.name } : d)),
        me: state.me?.id === ev.id ? { ...state.me, name: ev.name } : state.me,
      };
    case 'device-remove':
      return { ...state, devices: state.devices.filter((d) => d.id !== ev.id) };

    case 'pairing-set':
      return { ...state, pairing: ev.pairing };
    case 'qr-set':
      return { ...state, qr: ev.qr };

    case 'retention-set':
      return { ...state, session: state.session ? { ...state.session, retention: ev.retention } : state.session };

    case 'transfers-set':
      return { ...state, transfers: ev.transfers };
    case 'transfer-add': {
      if (state.transfers.some((t) => t.id === ev.item.id)) return state;
      return { ...state, transfers: [ev.item, ...state.transfers] };
    }
    case 'transfer-patch': {
      // merge by local id or by serverId
      let found = false;
      const next = state.transfers.map((t) => {
        if (t.id === ev.id || (ev.serverId && t.serverId === ev.serverId)) {
          found = true;
          return { ...t, ...ev.patch };
        }
        return t;
      });
      if (!found && ev.initial) {
        return { ...state, transfers: [{ ...ev.initial }, ...state.transfers] };
      }
      return { ...state, transfers: next };
    }
    case 'transfer-upsert': {
      // server-source item (inbound or mirror)
      const t = ev.transfer;
      const isMine = t.sourceDeviceId === state.me?.id;
      const existing = state.transfers.find((x) => x.serverId === t.id);
      if (existing || isMine) {
        const mapped = existing
          ? { ...existing, status: t.status, received: t.received, kind: t.kind || existing.kind }
          : null;
        if (isMine && !existing) return state; // engine already owns this row
        return { ...state, transfers: state.transfers.map((x) => (x.serverId === t.id ? mapped : x)) };
      }
      return {
        ...state,
        transfers: [
          {
            id: `srv${t.id.slice(0, 8)}`,
            serverId: t.id,
            kind: t.kind,
            filename: t.filename,
            mime: t.mime,
            size: t.size,
            received: t.received,
            sent: t.received,
            status: t.status,
            sourceIsMe: false,
            sourceDeviceId: t.sourceDeviceId,
            sourceName: t.sourceName,
            previewUrl: null,
            createdAt: t.createdAt,
            error: null,
          },
          ...state.transfers,
        ],
      };
    }
    case 'transfer-remove':
      return {
        ...state,
        transfers: state.transfers.filter((t) => t.id !== ev.id && t.serverId !== ev.id),
      };

    case 'messages-set':
      return { ...state, messages: ev.messages };
    case 'message-add': {
      if (state.messages.some((m) => m.id === ev.message.id)) return state;
      return { ...state, messages: [ev.message, ...state.messages] };
    }
    case 'message-remove':
      return { ...state, messages: state.messages.filter((m) => m.id !== ev.id) };
    case 'messages-clear':
      return { ...state, messages: [] };

    case 'toast-add':
      return {
        ...state,
        toasts: [...state.toasts.slice(-4), { ...ev.toast, id: `t${toastSeq++}` }],
      };
    case 'toast-remove':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== ev.id) };

    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const meRef = useRef(null);
  meRef.current = state.me;

  const toast = (text, tone = 'info') => {
    dispatch({ type: 'toast-add', toast: { text, tone } });
  };

  const refreshLists = async () => {
    const [transfers, messages] = await Promise.all([api.transfers(), api.messages()]);
    dispatch({ type: 'transfers-set', transfers: transfers.transfers });
    dispatch({ type: 'messages-set', messages: messages.messages });
  };

  const boot = async () => {
    let session;
    try {
      session = await api.getSession();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        dispatch({ type: 'reset' });
        return;
      }
      dispatch({ type: 'reset' });
      toast(e?.message || 'Could not reach the bridge', 'bad');
      return;
    }
    dispatch({
      type: 'boot',
      session: session.session,
      me: session.me,
      isHost: session.isHost,
      devices: session.devices,
      pairing: session.pairing,
    });
    try {
      await refreshLists();
    } catch { /* non-fatal */ }
    // paired → now the WS is worth opening (and reconnecting to)
    ws.connect();
  };

  /* engine wiring */
  useEffect(() => {
    queue.onAdd = (item) => dispatch({ type: 'transfer-add', item: { ...item } });
    queue.onPatch = (id, { ac, key, fileRef, ...patch }) =>
      dispatch({
        type: 'transfer-patch',
        id,
        serverId: patch.serverId,
        patch,
        initial: {
          id,
          serverId: patch.serverId || null,
          kind: patch.kind || 'file',
          filename: patch.filename,
          mime: patch.mime,
          size: patch.size,
          sent: patch.sent || 0,
          received: patch.received || 0,
          status: patch.status || 'waiting',
          sourceIsMe: true,
          sourceName: 'This device',
          previewUrl: patch.previewUrl || null,
          createdAt: Date.now(),
          error: null,
        },
      });
    queue.onRemove = (id) => dispatch({ type: 'transfer-remove', id });
    queue.onToast = (text, tone) => toast(text, tone);
  }, []);

  /* ws wiring + bootstrap */
  useEffect(() => {
    const offStatus = ws.onStatus((status) => {
      dispatch({ type: 'ws-status', status });
      if (status === 'online') {
        queue.retryTransient();
        api.getSession().then((s) => {
          dispatch({ type: 'devices-set', devices: s.devices });
          dispatch({ type: 'pairing-set', pairing: s.pairing });
        }).catch(() => { /* 401 path handled below */ });
      }
      if (status === 'unauthorized') {
        // only meaningful if we thought we were paired
        api.getSession().catch(() => {
          dispatch({ type: 'reset' });
          toast('Session ended or this device was removed.', 'bad');
        });
      }
    });

    const offEvent = ws.onEvent((ev) => {
      switch (ev.type) {
        case 'session-state': {
          dispatch({ type: 'devices-set', devices: ev.devices });
          if (ev.pairing) dispatch({ type: 'pairing-set', pairing: ev.pairing });
          if (ev.session?.retention) dispatch({ type: 'retention-set', retention: ev.session.retention });
          break;
        }
        case 'device:joined':
          dispatch({ type: 'device-upsert', device: ev.device });
          toast(`${ev.device.name} connected`, 'good');
          break;
        case 'device:presence':
          dispatch({ type: 'device-online', id: ev.id, online: ev.online });
          if (!ev.online) toast('A device went offline — reconnecting…', 'info');
          break;
        case 'device:update':
          dispatch({ type: 'device-update', id: ev.id, name: ev.name });
          break;
        case 'device:left':
          dispatch({ type: 'device-remove', id: ev.id });
          break;
        case 'pairing:new':
          dispatch({ type: 'pairing-set', pairing: { code: ev.code, expiresAt: ev.expiresAt } });
          break;
        case 'transfer:new':
        case 'transfer:update':
          dispatch({ type: 'transfer-upsert', transfer: ev.transfer });
          break;
        case 'transfer:deleted':
          dispatch({ type: 'transfer-remove', id: ev.id });
          queue.deleteListed?.(ev.id);
          break;
        case 'message:new': {
          dispatch({ type: 'message-add', message: ev.message });
          const mine = ev.message.sourceDeviceId === meRef.current?.id;
          if (!mine) {
            if (ev.message.kind === 'clipboard') {
              toast('Clipboard received — tap to copy', 'good');
            } else {
              toast(`Text received from ${ev.message.sourceName || 'device'}`, 'good');
            }
            notifyIfHidden(
              'FileBridge',
              ev.message.kind === 'clipboard'
                ? `Clipboard from ${ev.message.sourceName}`
                : `Text from ${ev.message.sourceName}`
            );
          }
          break;
        }
        case 'message:removed':
          dispatch({ type: 'message-remove', id: ev.id });
          break;
        case 'messages:cleared':
          dispatch({ type: 'messages-clear' });
          break;
        case 'session:retention':
          dispatch({ type: 'retention-set', retention: ev.retention });
          break;
        case 'session:revoked':
          ws.disconnect();
          dispatch({ type: 'reset' });
          toast('Session ended. Files were deleted from storage.', 'info');
          break;
        default:
          break;
      }
    });

    boot();

    return () => { offStatus(); offEvent(); };
  }, []);

  // auto-dismiss toasts
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const timers = state.toasts.map((t) =>
      setTimeout(() => dispatch({ type: 'toast-remove', id: t.id }), 4200)
    );
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);

  const value = useMemo(() => ({ state, dispatch, boot, refreshLists, toast }), [state]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}
