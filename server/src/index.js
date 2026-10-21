import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fastifyFactory from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  CHUNK_LIMIT,
  CLIENT_DIST,
  IS_PACKAGED,
  PORT,
  HOST,
  STORAGE_DIR,
  lanUrls,
} from './config.js';
import { parseCookies } from './util.js';
import { setupWS, stopHeartbeat } from './ws.js';
import { startCleanup, stopCleanup } from './cleanup.js';
import authRoutes from './routes/auth.js';
import transferRoutes from './routes/transfers.js';
import messageRoutes from './routes/messages.js';

async function main() {
  // data + storage dirs are created by db.js/config-aware paths

  const app = fastifyFactory({
    logger: process.env.FB_DEBUG ? { level: 'debug' } : false,
    bodyLimit: CHUNK_LIMIT * 2,
  });

  /* cookies → request.cookies (no plugin needed) */
  app.addHook('onRequest', (req, reply, done) => {
    req.cookies = parseCookies(req.headers.cookie || '');
    req._t0 = Date.now();
    done();
  });

  /* bodyLimit is fine at 1MB for JSON; big text bodies are validated in-route */

  /* security headers */
  app.addHook('onSend', (req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const ct = String(reply.getHeader('content-type') || '');
    const url = req.raw.url || '';
    if (ct.startsWith('text/html')) {
      reply.header('X-Frame-Options', 'DENY');
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'"
      );
    } else if (url.startsWith('/files/')) {
      // uploaded files are data, never programs: hard sandbox on everything served.
      // 'allow-downloads' is required or Chrome blocks saving sandboxed responses.
      reply.header(
        'Content-Security-Policy',
        ct === 'application/octet-stream'
          ? "default-src 'none'; sandbox allow-downloads"
          : "default-src 'none'"
      );
    }
    if (url.startsWith('/files/')) {
      const ms = Date.now() - (req._t0 || Date.now());
      console.log(`[files] ${req.method} ${url.split('?')[0]} -> ${reply.statusCode} (${reply.getHeader('content-length') || '-'}B, ${ms}ms total)`);
    }
    done();
  });

  /* raw chunk bodies */
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (req, body, done) => done(null, body)
  );

  app.register(authRoutes);
  app.register(transferRoutes);
  await app.register(messageRoutes);

  await setupWS(app);

  app.setErrorHandler((error, req, reply) => {
    const status = error.statusCode || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.raw.url}`, error?.message || error);
    return reply.code(status).send({
      code: error.code || (status >= 500 ? 'internal_error' : 'bad_request'),
      message: status >= 500 ? 'Something went wrong on the server.' : (error.message || 'Request failed.'),
    });
  });

  /* SPA frontend build (production) */
  let hasClient = false;
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: CLIENT_DIST, index: ['index.html'] });
    hasClient = true;
  } else {
    console.warn('[boot] client build not found — run:  npm run build -w client');
  }

  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url || '';
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    const isApp = !url.startsWith('/api/') && !url.startsWith('/files/') && url !== '/ws';
    if (wantsHtml && isApp) {
      if (hasClient) return reply.sendFile('index.html');
      reply.type('text/html');
      return reply.send(
        '<meta charset="utf-8"><title>FileBridge</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">' +
        '<h1>FileBridge API is running</h1><p>The web client is not built yet.<br/>From the project root run:<br/><code>npm install && npm run build</code></p></body>'
      );
    }
    return reply.code(404).send({ code: 'not_found', message: 'Unknown route.' });
  });

  startCleanup();
  stopHeartbeatOnExit(app);

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n[boot] Port ${PORT} is already in use on this machine.`);
      console.error('       Run on another port:  $env:PORT = "3100"  (PowerShell) then start the server again.\n');
      process.exit(1);
    }
    console.error('[boot] failed to start:', err?.message || err);
    process.exit(1);
  }

  const urls = lanUrls();
  console.log('\n  FileBridge is running');
  console.log(`  --------------------------------`);
  console.log(`  On this PC:  ${urls[urls.length - 1]}`);
  console.log(`  On your phone (same Wi-Fi): ${urls[0]}  or scan the QR shown in the browser.`);
  if (urls.length > 2) {
    console.log('  Other LAN addresses:');
    for (const u of urls.slice(1, -1)) console.log(`    ${u}`);
  }
  console.log(`  Storage: ${STORAGE_DIR}   (auto-cleanup is on)\n`);

  if (IS_PACKAGED) {
    openBrowser(urls[urls.length - 1]);
  }
}

/** Standalone exe: pop the bridge open automatically. */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* browser opening is a convenience, not a requirement */ }
}

function stopHeartbeatOnExit(app) {
  const shutdown = async () => {
    stopHeartbeat();
    stopCleanup();
    try { await app.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('beforeExit', () => stopHeartbeat());
}

main().catch((err) => {
  console.error('[boot] fatal:', err?.stack || err);
  process.exit(1);
});
