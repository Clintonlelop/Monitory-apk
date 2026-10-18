// Minimal in-memory rate limiter (no external dependency).
// Buckets are keyed per process; for multi-instance deployments put a shared
// limiter (e.g. Redis) behind the same interface.

const buckets = new Map(); // key -> { count, resetAt }

export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 30, name = 'limiter', keyFn } = {}) {
  // Periodically drop expired buckets so memory does not grow unbounded.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60 * 1000));
  sweeper.unref?.();

  return function rateLimit(req, res, next) {
    const key = `${name}:${keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || 'unknown')}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    return next();
  };
}

// Small sliding-window guard for a single mutable target (e.g. pairing code
// attempts). Returns true when the action is allowed.
const attemptBuckets = new Map();

export function allowAttempt(key, { max = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  let entry = attemptBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    attemptBuckets.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= max;
}
