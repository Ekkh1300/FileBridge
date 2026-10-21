import React, { useState } from 'react';
import { Settings2, Sun, Moon, Bell, BellOff, Smartphone, Monitor, LogOut, ShieldOff, X, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { getTheme, setTheme, THEMES } from '../lib/theme.js';
import { notificationPermission, requestNotifications } from '../lib/notify.js';
import { RETENTION_LABELS } from '../lib/labels.js';

export default function SettingsModal({ onClose }) {
  const { state, dispatch, boot, toast } = useStore();
  const [name, setName] = useState(state.me?.name || '');
  const [savingName, setSavingName] = useState(false);

  const close = (e) => {
    if (e?.target === e?.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto toast-in">
        <div className="flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <Settings2 size={17} className="text-accent" /> Settings
          </h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        {/* device name */}
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="set-name">This device's name</label>
          <div className="mt-1.5 flex gap-2">
            <input id="set-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn btn-primary text-sm shrink-0"
              disabled={savingName || name.trim() === state.me?.name}
              onClick={async () => {
                setSavingName(true);
                try {
                  await api.updateDevice(name.trim() || state.me?.name);
                  dispatch({ type: 'device-update', id: state.me.id, name: name.trim() });
                  toast('Device renamed', 'ok');
                } catch (e) {
                  toast(e.message, 'bad');
                } finally {
                  setSavingName(false);
                }
              }}
            >
              Save
            </button>
          </div>
        </div>

        {/* retention */}
        <div className="mt-5">
          <label className="text-sm font-medium" htmlFor="set-ret">
            Auto-delete received files
            <span className="block text-xs text-soft mt-0.5 font-normal">Stored only on the host PC until then.</span>
          </label>
          <select
            id="set-ret"
            className="input mt-1.5"
            value={state.session?.retention || '7d'}
            onChange={(e) => api.setRetention(e.target.value).catch((err) => toast(err.message, 'bad'))}
          >
            {Object.entries(RETENTION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>

        {/* appearance */}
        <div className="mt-5">
          <span className="text-sm font-medium">Appearance</span>
          <div className="mt-1.5 flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t}
                className={`btn flex-1 text-sm ${getTheme() === t ? 'btn-soft border-accent/60' : 'btn-ghost border border-line'}`}
                onClick={() => setTheme(t)}
              >
                {t === 'dark' ? <Moon size={15} /> : <Sun size={15} />} {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>

        {/* notifications */}
        <div className="mt-5">
          <span className="text-sm font-medium">Desktop notifications</span>
          <p className="text-xs text-soft mt-0.5">Only when this tab is in the background. Needs a secure context (https/localhost).</p>
          <button
            className="btn btn-soft w-full mt-1.5 text-sm"
            onClick={async () => {
              const ok = await requestNotifications();
              toast(ok ? 'Notifications on' : 'The browser refused notifications here', ok ? 'ok' : 'info');
            }}
          >
            <Bell size={15} /> Permit
            <BellOff size={13} className="opacity-50" aria-hidden />
          </button>
        </div>

        {/* devices */}
        <div className="mt-5">
          <span className="text-sm font-medium">Devices in this session</span>
          <ul className="mt-1.5 divide-y divide-line border border-line rounded-xl overflow-hidden">
            {state.devices.map((d) => {
              const mine = d.id === state.me?.id;
              return (
                <li key={d.id} className="flex items-center gap-2 px-3 py-2.5">
                  {d.kind === 'host' ? <Monitor size={15} className="text-accent" /> : <Smartphone size={15} className="text-lav" />}
                  <span className="text-sm truncate">{d.name}{mine && <span className="text-soft"> (this device)</span>}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${d.online ? 'bg-good' : 'bg-soft/40'}`} title={d.online ? 'online' : 'offline'} />
                  <span className="ml-auto flex gap-1">
                    {mine && d.kind === 'guest' && (
                      <button
                        className="btn btn-ghost !min-h-8 text-xs"
                        title="Leave this session"
                        onClick={async () => {
                          try {
                            await api.leave();
                          } catch (e) {
                            toast(e.message, 'bad');
                          }
                          dispatch({ type: 'reset' });
                          location.href = '/';
                        }}
                      >
                        <LogOut size={13} /> Leave
                      </button>
                    )}
                    {!mine && state.me?.kind === 'host' && d.kind !== 'host' && (
                      <button
                        className="btn btn-danger !min-h-8 text-xs"
                        title="Remove this device from the session"
                        onClick={async () => {
                          try {
                            await api.revoke(d.id);
                            toast(`${d.name} removed`, 'info');
                          } catch (e) {
                            toast(e.message, 'bad');
                          }
                        }}
                      >
                        <ShieldOff size={13} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* session end */}
        {state.isHost && (
          <button
            className="btn btn-danger w-full mt-5 text-sm border border-line"
            onClick={async () => {
              if (!confirm('End the session for every device? Received files are deleted now.')) return;
              try {
                await api.endSession();
                dispatch({ type: 'reset' });
                toast('Session ended', 'info');
              } catch (e) {
                toast(e.message, 'bad');
              }
            }}
          >
            <Trash2 size={15} /> End session for everyone
          </button>
        )}

        <p className="mt-4 text-xs text-soft leading-relaxed border-t border-line pt-3">
          Pairing tokens expire in 10 minutes. Sessions end after 24&nbsp;h idle. Files stay only on the host
          computer and are never executed — Save from the browser sandbox. On <code>http://</code> LAN addresses
          some browser features (clipboard read, notifications, PWA install) are limited — use the fallbacks shown in the UI.
        </p>
      </div>
    </div>
  );
}
