/** Device-role helpers based on the browser's user agent. */

export function looksMobile(ua) {
  return /iPhone|iPad|iPod|Android.*Mobile|Android.*Tablet|Mobile/i.test(ua);
}

export function defaultName(ua) {
  if (/Windows/i.test(ua)) return 'My PC';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'My iPhone';
  if (/Android/i.test(ua)) return 'My Android';
  if (/Mobi/i.test(ua)) return 'My Phone';
  if (/Mac/i.test(ua)) return 'My MacBook';
  if (/Linux/i.test(ua)) return 'My PC';
  return 'My Device';
}

export const kindIconName = (kind, platform) => {
  if (kind === 'host') return 'monitor';
  if (platform === 'iOS' || platform === 'Android') return 'smartphone';
  return 'monitor';
};
