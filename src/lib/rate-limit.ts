/**
 * Simple in-memory rate limiter for OTP send requests.
 *
 * Tracks per-key (phone or IP) request counts with a fixed window.
 * Works for single-process deployments (Next.js Node runtime).
 * For multi-instance deployments, replace the Map with Redis.
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Prune stale entries every 10 minutes to prevent memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 10 * 60_000).unref?.();
}

/**
 * Check rate limit and increment the counter.
 *
 * @param key      Unique identifier (phone number, IP, etc.)
 * @param limit    Maximum allowed requests within the window
 * @param windowMs Window duration in milliseconds
 * @returns true if within limit, false if rate-limited
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}
