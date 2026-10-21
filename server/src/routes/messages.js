import { MAX_TEXT } from '../config.js';
import * as db from '../db.js';
import { requireDevice } from '../guard.js';
import { limiter } from '../rate.js';
import { cleanText } from '../util.js';
import { emitSessionEvent } from '../ws.js';

export default async function messageRoutes(fastify) {
  fastify.get('/api/messages', { preHandler: requireDevice }, async (req) => {
    const rows = db.listMessages(req.fbd.session.id, 100);
    return { messages: rows.map(db.publicMessage) };
  });

  fastify.post('/api/messages', { preHandler: [requireDevice, limiter('msg', 120)] }, async (req, reply) => {
    const dev = req.fbd;
    const kind = req.body?.kind === 'clipboard' ? 'clipboard' : 'text';
    let body = typeof req.body?.body === 'string' ? req.body.body : '';
    body = cleanText(body);
    if (body.trim().length === 0) {
      return reply.code(400).send({ code: 'empty', message: 'Nothing to send.' });
    }
    if (body.length > MAX_TEXT) {
      return reply.code(413).send({ code: 'too_long', message: `Text is limited to ${MAX_TEXT} characters.` });
    }
    const session = db.getSession(dev.session.id);
    if (!session) {
      return reply.code(401).send({ code: 'session_ended', message: 'Session ended.' });
    }
    db.touchSession(session.id);
    const message = db.createMessage({ session_id: session.id, device: dev, kind, body });
    const pub = db.publicMessage(message);
    emitSessionEvent(session.id, { type: 'message:new', message: pub });
    return { message: pub };
  });

  fastify.delete('/api/messages/:id', { preHandler: requireDevice }, async (req, reply) => {
    const dev = req.fbd;
    const m = db.getMessage(req.params.id);
    if (!m || m.session_id !== dev.session.id) {
      return reply.code(404).send({ code: 'not_found', message: 'Not found.' });
    }
    if (m.device_id !== dev.id && dev.kind !== 'host') {
      return reply.code(403).send({ code: 'forbidden', message: 'Only yours or the host can delete.' });
    }
    db.deleteMessageRow(m.id);
    emitSessionEvent(dev.session.id, { type: 'message:removed', id: m.id });
    return { ok: true };
  });

  fastify.delete('/api/messages', { preHandler: requireDevice }, async (req) => {
    const n = db.clearSessionMessages(req.fbd.session.id);
    emitSessionEvent(req.fbd.session.id, { type: 'messages:cleared' });
    return { cleared: n };
  });
}
