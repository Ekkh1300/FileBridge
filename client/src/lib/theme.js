const KEY = 'fb-theme';

export const THEMES = ['dark', 'light'];

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  root.classList.toggle('theme-dark', mode !== 'light');
  root.classList.toggle('theme-light', mode === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'light' ? '#edf0f6' : '#0a0c11');
}

export function setTheme(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  applyTheme(mode);
}
