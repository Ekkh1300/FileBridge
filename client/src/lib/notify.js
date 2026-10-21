/** Desktop notifications — capability-limited, purely optional. */

export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () =>
  notificationsSupported() ? Notification.permission : 'unsupported';

export async function requestNotifications() {
  if (!notificationsSupported()) return false;
  try {
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch {
    return false;
  }
}

/** Only fire while the tab is hidden, so it never double-notifies. */
export function notifyIfHidden(title, body) {
  if (!notificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    new Notification(title, { body, silent: false });
  } catch { /* ignore */ }
}
