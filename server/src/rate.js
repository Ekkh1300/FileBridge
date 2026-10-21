/** Tiny in-memory sliding-window rate limiter, keyed by IP + class. */
const buckets = new Map(); // key -> { count, reset }

export function limiter(cls, max, windowMs = 60_000) {
  buckets.set(`__class:${cls}`, { max, windowMs });
  return async function rateCheck(request, reply) {
    const key = `${cls}:${request.ip}`;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= t) {
      b = { count: 0, reset: t + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      reply.header('retry-after', Math.max(1, Math.ceil((b.reset - t) / 1000)));
      return reply.code(429).send({
        code: 'rate_limited',
        message: 'Too many requests. Please slow down.',
      });
    }
  };
}

export function sweepRateBuckets() {
  const t = Date.now();
  for (const [key, b] of buckets) {
    if (key.startsWith('__class:')) continue;
    if (b.reset < t - 30_000) buckets.delete(key);
  }
}
