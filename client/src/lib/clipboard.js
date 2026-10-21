/** Clipboard helpers with legacy fallbacks + honest capability reporting. */

export const canReadClipboard = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

export const canWriteClipboard = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);

/** Always requires an HTTPS (secure) context — LAN over plain http blocks it on phones. */
export const isSecureContext = () => typeof window !== 'undefined' && Boolean(window.isSecureContext);

export async function copyText(text) {
  if (canWriteClipboard()) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch { /* fall through to legacy */ }
  }
  try {
    return { ok: legacyCopy(text) };
  } catch {
    return { ok: false };
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
  document.body.appendChild(ta);
  const sel = window.getSelection?.();
  const prevRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  if (prevRange && sel) {
    sel.removeAllRanges();
    sel.addRange(prevRange);
  }
  return ok;
}

/**
 * Read the system clipboard. Often blocked without a permission prompt
 * (esp. on phones and insecure contexts) — callers must have a paste fallback.
 */
export async function readClipboard() {
  if (!canReadClipboard()) return { ok: false, reason: 'unsupported' };
  try {
    const text = await navigator.clipboard.readText();
    if (typeof text !== 'string') return { ok: false, reason: 'denied' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: e?.name === 'NotAllowedError' ? 'denied' : 'error' };
  }
}
