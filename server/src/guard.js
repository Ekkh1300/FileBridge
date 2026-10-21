import { COOKIE_NAME } from './config.js';
import { deviceFromCookieValue } from './db.js';
import { parseCookies } from './util.js';

/** Reads the pair cookie and resolves the active device (checks both device + session). */
export function deviceFromRequest(request) {
  const raw = request.cookies ? request.cookies[COOKIE_NAME] : parseCookies(request.headers.cookie || '')[COOKIE_NAME];
  return raw ? deviceFromCookieValue(raw) : null;
}

/** preHandler for every authenticated route. */
export async function requireDevice(request, reply) {
  const device = deviceFromRequest(request);
  if (!device) {
    return reply.code(401).send({ code: 'unauthorized', message: 'Not paired. Show the QR on the other device.' });
  }
  request.fbd = device; // authenticated device (incl. its session row)
  return undefined;
}
