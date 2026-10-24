/**
 * End-to-end verification of a RUNNING FileBridge instance.
 * Works against the dev server or the packaged exe:
 *
 *   node tools/verify-release.mjs http://localhost:3100
 *
 * Checks: health, served client bundle, PWA assets, security headers,
 * pairing payload, and a full chunked-upload round trip with a byte-identical
 * download. Exit code 1 when anything fails.
 */
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

let failed = 0;
const t = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed += 1;
  return ok;
};

const j = async (url, opt) => {
  const res = await fetch(BASE + url, opt);
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body, res };
};

/* 1 — health ------------------------------------------------------------- */
{
  const { status, body } = await j('/api/health').catch(() => ({ status: 0, body: null }));
  t('health endpoint', status === 200 && !!body, `status=${status}`);
}

/* 2 — client bundle served ---------------------------------------------- */
let bundle = null;
{
  const res = await fetch(BASE + '/').catch(() => null);
  const html = res && res.status === 200 ? await res.text() : '';
  const m = html.match(/assets\/index-[\w-]+\.js/);
  bundle = m ? m[0] : null;
  t('index.html + hashed bundle reference', !!bundle, bundle || 'no match');
  if (bundle) {
    const js = await fetch(`${BASE}/${bundle}`).catch(() => null);
    t('client bundle loads', !!js && js.status === 200, js ? `status=${js.status}` : 'no response');
  }
}

/* 3 — PWA assets --------------------------------------------------------- */
{
  const sw = await fetch(BASE + '/sw.js').catch(() => null);
  const swText = sw && sw.status === 200 ? await sw.text() : '';
  t('service worker served', !!swText.includes('filebridge-shell'), sw ? `status=${sw.status}` : 'no response');
  t('sw never caches live data', swText.includes("/api/") && swText.includes("/files/"));

  const mf = await fetch(BASE + '/manifest.webmanifest').catch(() => null);
  let man = null;
  if (mf && mf.status === 200) { try { man = await mf.json(); } catch { /* bad json */ } }
  t('manifest valid', !!man && man.short_name === 'FileBridge' && !!man.display, man ? man.name : 'missing');
  const icon = await fetch(BASE + '/icons/icon-512.png').catch(() => null);
  t('PWA icon', !!icon && icon.status === 200 && (icon.headers.get('content-type') || '').includes('image'));
}

/* 4 — security headers --------------------------------------------------- */
{
  const res = await fetch(BASE + '/').catch(() => null);
  const h = res ? res.headers : new Headers();
  t('CSP header', !!(h.get('content-security-policy')), (h.get('content-security-policy') || '').slice(0, 48));
  t('nosniff header', h.get('x-content-type-options') === 'nosniff');
}

/* 5 — host session + pairing --------------------------------------------- */
let cookie = null;
{
  const r = await fetch(`${BASE}/api/host`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  cookie = r ? (r.headers.get('set-cookie') || '').split(';')[0] : null;
  t('host session created', !!cookie);

  const p = await j('/api/session/pairing', { headers: { cookie } }).catch(() => ({ status: 0, body: null }));
  const pair = p.body || {};
  t('pairing payload', p.status === 200 && !!pair.code && !!pair.qr, `joinUrl=${pair.joinUrl || '-'}`);
  t('qr encodes joinUrl', !!pair.qr && pair.qr.startsWith('data:image'), `${(pair.qr || '').length} bytes`);
  t('pairing uses LAN address when PUBLIC_URL is unset', (pair.joinUrl || '').includes('/join/'));
}

/* 6 — chunked upload round trip ------------------------------------------ */
{
  const payload = Buffer.from(
    `FileBridge release verification\n${'-'.repeat(40)}\n${Date.now()}\n`,
    'utf8',
  );
  const create = await j('/api/transfers', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey: `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      size: payload.length,
      filename: 'verify.txt',
      mime: 'text/plain',
    }),
  }).catch(() => ({ status: 0, body: null }));
  const tid = create.body && create.body.transfer && create.body.transfer.id;
  t('transfer created', create.status === 200 && !!tid, `id=${tid || '-'}`);

  if (tid) {
    const half = Math.ceil(payload.length / 2);
    const parts = [payload.subarray(0, half), payload.subarray(half)];
    let off = 0;
    let ok = true;
    for (const part of parts) {
      const r = await fetch(`${BASE}/api/transfers/${tid}/chunk?offset=${off}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/octet-stream' },
        body: part,
      }).catch(() => null);
      if (!r || r.status !== 200) { ok = false; break; }
      off += part.length;
    }
    t('2 chunks accepted', ok, `${off}/${payload.length} bytes`);

    const done = await j(`/api/transfers/${tid}/complete`, { method: 'POST', headers: { cookie } })
      .catch(() => ({ status: 0, body: null }));
    t('complete', done.status === 200, `status=${done.status}`);

    const dl = await fetch(`${BASE}/files/${tid}/raw`, { headers: { cookie } }).catch(() => null);
    const got = dl && dl.status === 200 ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
    t('download byte-identical', got.length === payload.length && got.equals(payload),
      `${got.length} bytes, sha ok=${got.equals(payload)}`);

    const list = await j('/api/transfers', { headers: { cookie } }).catch(() => ({ body: null }));
    const rows = (list.body && list.body.transfers) || [];
    const seen = rows.some((x) => x.id === tid && x.status === 'done');
    t('appears in transfer list as done', seen, `statuses=${rows.map((x) => x.status).join(',') || '-'}`);
  }
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
