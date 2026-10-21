/**
 * FileBridge smoke test — simulates two devices (two cookie jars) on one session.
 * Run:  node test/smoke.mjs   (server must be running on :3000)
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.FB_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, extra = '') => { fail++; console.error(`  ✗ ${name} ${extra}`); };
function assert(cond, name, extra = '') { cond ? ok(name) : bad(name, extra); }

const jar = () => {
  const state = { cookie: '' };
  return {
    state,
    get cookie() { return state.cookie; },
    async raw(pathname, { method = 'GET', body, headers = {} } = {}) {
      return await fetch(`${BASE}${pathname}`, {
        method,
        headers: { ...(state.cookie ? { cookie: state.cookie } : {}), ...headers },
        body,
      });
    },
    async call(pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
      const res = await fetch(`${BASE}${pathname}`, {
        method,
        headers: { ...(state.cookie ? { cookie: state.cookie } : {}), ...headers },
        body,
      });
      const setc = res.headers.get('set-cookie');
      if (setc) state.cookie = setc.split(';')[0];
      if (raw) return res;
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data };
    },
  };
};

const wsOpen = (cookie) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:3000/ws`, { headers: { cookie } });
  const events = [];
  ws.on('message', (raw) => { try { events.push(JSON.parse(String(raw))); } catch {} });
  ws.on('open', () => resolve({ ws, events }));
  ws.on('error', reject);
  setTimeout(() => reject(new Error('ws timeout')), 5000);
});
const waitFor = (events, type, timeout = 8000) => new Promise((resolve, reject) => {
  const found = events.find((e) => e.type === type);
  if (found) return resolve(found);
  const timer = setInterval(() => {
    const f = events.find((e) => e.type === type);
    if (f) { clearInterval(timer); resolve(f); }
  }, 50);
  setTimeout(() => { clearInterval(timer); reject(new Error(`timeout waiting ${type} — got: ${events.map(e => e.type).join(',')}`)); }, timeout);
});

async function main() {
  console.log('FileBridge smoke test\n');

  const health = await jar().call('/api/health');
  assert(health.status === 200 && health.data.ok, 'health');

  const pc = jar();
  const phone = jar();
  const host = await pc.call('/api/host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Smoke PC' }) });
  assert(host.status === 200 && host.data.pairing?.code, 'host creates session', JSON.stringify(host.data));
  assert(host.data.device.kind === 'host', 'host device kind');

  const code = host.data.pairing.token;
  assert(code && code.length === 8, 'pairing code 8 chars');

  const joined = await phone.call('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.toLowerCase() }) });
  assert(joined.status === 200 && joined.data.device.kind === 'guest', 'phone joins via code (case-insensitive)');

  const joinedAgain = await jar().call('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'XXXX-XXXX' }) });
  assert(joinedAgain.status !== 200, 'bad code rejected');

  const sess = await pc.call('/api/session');
  assert(sess.status === 200 && sess.data.devices.length === 2, 'session lists 2 devices');
  assert(sess.data.devices.every((d) => typeof d.online === 'boolean'), 'devices carry online flag');

  /* unauthorized access */
  const anon = jar();
  const anonSess = await anon.call('/api/session');
  assert(anonSess.status === 401, 'session requires cookie');
  const anonFiles = await anon.call(`/files/${'x'.repeat(36)}/raw`);
  assert(anonFiles.status === 401, 'files require cookie');

  /* websockets */
  const wsPC = await wsOpen(pc.cookie);
  const wsPhone = await wsOpen(phone.cookie);
  const stPC = await waitFor(wsPC.events, 'session-state');
  assert(stPC.devices.length === 2 && stPC.me.kind === 'host', 'ws session-state (PC)');
  const presence = await waitFor(wsPC.events, 'device:presence', 4000);
  assert(presence.online === true, 'PC saw phone come online');

  /* text message phone → PC */
  const sent = await phone.call('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', body: 'hello from phone \u0000<script>alert(1)</script>' }) });
  assert(sent.status === 200, 'phone sends text');
  const received = await waitFor(wsPC.events, 'message:new');
  assert(received.message.body.includes('hello from phone'), 'PC received text via WS realtime');
  assert(!received.message.body.includes('\u0000'), 'NUL control char stripped from text');

  /* file upload phone → PC (chunked) */
  const bytes = crypto.randomBytes(700 * 1024);
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const img = Buffer.concat([pngHead, bytes]);
  const clientKey = `smoke-${img.length}.png:visit1`;
  const init = await phone.call('/api/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey, filename: 'photo.png', mime: 'image/png', size: img.length }) });
  assert(init.status === 200 && init.data.transfer.id, 'init upload');
  const tid = init.data.transfer.id;
  const chunkLimit = init.data.chunkLimit;
  const chunks = Math.ceil(img.length / chunkLimit);
  for (let i = 0; i < chunks; i++) {
    const off = i * chunkLimit;
    const slice = img.subarray(off, Math.min(img.length, off + chunkLimit));
    const up = await phone.raw(`/api/transfers/${tid}/chunk?offset=${off}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: slice });
    if (!up.ok) bad(`chunk ${i} upload`, String(up.status));
  }
  ok(`${chunks} chunk(s) uploaded`);
  const doneResp = await phone.call(`/api/transfers/${tid}/complete`, { method: 'POST' });
  assert(doneResp.status === 200 && doneResp.data.transfer.status === 'done', 'complete → done');
  assert(doneResp.data.transfer.kind === 'image', 'sniff detected image kind');

  const upd = await waitFor(wsPC.events, 'transfer:update', 4000);
  assert(upd.transfer && upd.transfer.status === 'done' && upd.transfer.kind === 'image', 'PC saw transfer:update done (realtime)');
  assert(!upd.transfer.filename.includes('..'), 'filename sanitized');

  /* download byte-identical from PC side */
  const dl = await pc.raw(`/files/${tid}/download`);
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  assert(dl.status === 200 && dlBuf.length === img.length && dlBuf.equals(img), 'download byte-identical');

  const raw = await pc.raw(`/files/${tid}/raw`);
  const rawCt = raw.headers.get('content-type') || '';
  assert(raw.status === 200 && rawCt.startsWith('image/png'), 'raw serving inline with sniffed type');

  /* cross-session isolation */
  const stranger = jar();
  const hs = await stranger.call('/api/host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert(hs.status === 200, 'second session hosted');
  const cross = await stranger.raw(`/files/${tid}/raw`);
  assert(cross.status === 404, 'other session cannot access the file', `got ${cross.status}`);

  /* path traversal filename */
  const evil = await stranger.call('/api/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey: 'evil-key-01', filename: '..\\..\\..\\Windows\\system.ini', mime: '', size: 900 }) });
  assert(evil.status === 200 && !evil.data.transfer.filename.includes('..') && !evil.data.transfer.filename.includes('\\'), 'path traversal filename sanitized');

  /* foreign device cannot chunk others' transfer */
  const foreignChunk = await pc.call(`/api/transfers/${tid}/chunk?offset=0`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1]) });
  assert(foreignChunk.status === 403, 'chunk restricted to sender');

  /* guest cannot end host session */
  const guestEnd = await phone.call('/api/session/end', { method: 'POST' });
  assert(guestEnd.status === 403, 'guest cannot end session');

  /* guest can send clipboard kind */
  const clip = await phone.call('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'clipboard', body: 'clipboard payload π' }) });
  assert(clip.status === 200 && clip.data.message.kind === 'clipboard', 'clipboard message sent');

  /* host revokes the phone */
  const revoke = await pc.call('/api/device/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: joined.data.device.id }) });
  assert(revoke.status === 200, 'host revokes phone');
  const afterRevoke = await phone.call('/api/session');
  assert(afterRevoke.status === 401, 'revoked device loses access');

  /* owner deletes their own upload */
  const del = await pc.call(`/api/transfers/${tid}/delete`, { method: 'POST' });
  assert(del.status === 200, 'delete transfer');
  const dl404 = await pc.raw(`/files/${tid}/download`);
  assert(dl404.status === 404, 'file gone after delete');

  /* big file resume check: init, half upload, drop, re-init → received preserved */
  const bigKey = 'big-resume-test.bin:key1';
  const bigSize = 5 * 1024 * 1024;
  const bigInit = await pc.call('/api/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey: bigKey, filename: 'big.bin', mime: '', size: bigSize }) });
  const bigId = bigInit.data.transfer.id;
  await pc.raw(`/api/transfers/${bigId}/chunk?offset=0`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: crypto.randomBytes(2 * 1024) });
  const reInit = await pc.call('/api/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey: bigKey, filename: 'big.bin', mime: '', size: bigSize }) });
  assert(reInit.data.received === 2 * 1024 && reInit.data.transfer.id === bigId, 'resume keeps received offset');
  await pc.call(`/api/transfers/${bigId}/delete`, { method: 'POST' });

  /* host ends session → storage wiped */
  await pc.call('/api/session/end', { method: 'POST' });
  const afterEnd = await pc.call('/api/session');
  assert(afterEnd.status === 401, 'session end invalidates cookie');
  const strangerDel = await stranger.call('/api/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"clientKey":"stranger-check-1","filename":"a.txt","size":10}' });
  assert(strangerDel.status === 200, 'other session unaffected');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
