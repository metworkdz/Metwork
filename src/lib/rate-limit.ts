/**
 * Rate limiting — distributed via Upstash Redis with in-memory fallback.
 *
 * Public API:
 *
 *   checkRateLimit(key, limit, windowMs) → boolean (sync, in-memory only)
 *     Legacy / single-process callers. Kept for backward compatibility.
 *     Unsafe on multi-instance Vercel deployments (each function instance
 *     has its own Map).
 *
 *   checkRateLimitDistributed(key, limit, windowMs) → Promise<boolean>
 *     The one you want. Uses Upstash Redis when UPSTASH_REDIS_REST_URL
 *     and UPSTASH_REDIS_REST_TOKEN are configured; falls back to the
 *     in-memory limiter when they aren't (dev / preview deploys).
 *     Returns `true` when the request is within the limit, `false` when
 *     it should be blocked.
 *
 *   getRateLimitMode() → 'redis' | 'memory'
 *     For observability — log this at startup to confirm Redis is wired.
 *
 * Algorithm:
 *   Sliding-window via @upstash/ratelimit. More fair than fixed-window at
 *   window boundaries (a burst at second 59 + a burst at second 61 cannot
 *   double the apparent limit). Slightly more Redis ops per check than
 *   fixed-window (~3 vs 2) — still well within free-tier limits.
 *
 * Fail-open vs fail-closed:
 *   If Redis errors out (network blip, Upstash outage), we fall back to
 *   the in-memory limiter for this single check rather than blocking the
 *   request. This is intentional — a transient Redis failure should not
 *   block legitimate users. Tradeoff: during a Redis outage, rate limits
 *   degrade to per-instance enforcement. Acceptable for the failure mode
 *   we're guarding against (brute force, not DDoS).
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ────────────────────────────────────────────────────────────────────────
// In-memory limiter (sync, legacy)
// ────────────────────────────────────────────────────────────────────────

interface RateEntry {
  count: number;
  resetAt: number;
}

const memStore = new Map<string, RateEntry>();

// Prune stale entries every 10 minutes to prevent memory growth.
// unref so the timer doesn't keep the process alive during tests.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memStore) {
      if (entry.resetAt <= now) memStore.delete(key);
    }
  }, 10 * 60_000).unref?.();
}

/**
 * Sync in-memory rate-limit check. Returns true if within limit.
 *
 * IMPORTANT: Single-process only. Use checkRateLimitDistributed in any
 * code path that runs on Vercel serverless functions.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || entry.resetAt <= now) {
    memStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// Upstash Redis limiter (async, distributed)
// ────────────────────────────────────────────────────────────────────────

/**
 * Singleton Redis client. Lazily instantiated on first call so build-time
 * doesn't crash when the env vars are missing (preview deploys, local dev).
 *
 *   undefined → not yet initialised
 *   null      → env vars missing, stay in memory-fallback mode
 *   Redis     → connected client
 */
let redisClient: Redis | null | undefined = undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      // Visible warning in Vercel runtime logs. Not a hard failure — auth
      // routes will still rate-limit per-instance, which is better than
      // nothing while the operator finishes Upstash setup.
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN ' +
        'not set. Falling back to in-memory rate limiting — protection ' +
        'will leak across Vercel function instances.',
      );
    }
    redisClient = null;
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

/**
 * Per-(limit, window) Ratelimit instance cache. Constructing one per call
 * works but is wasteful — the underlying class compiles a Lua script that
 * we want to reuse across requests.
 */
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const cacheKey = `${limit}:${windowMs}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) return cached;

  // The Ratelimit Duration type is a template string like `${number} ms`.
  // Pass milliseconds directly so we don't lose precision on sub-second windows.
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
    analytics: false,
    prefix: 'metwork-rl',
  });
  limiterCache.set(cacheKey, limiter);
  return limiter;
}

/**
 * Distributed rate-limit check. Returns true if within limit, false if
 * the caller should be blocked.
 *
 * Uses Upstash Redis (sliding window) when configured; falls back to
 * in-memory when env vars are missing or when Redis errors.
 */
export async function checkRateLimitDistributed(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const limiter = getLimiter(limit, windowMs);
  if (!limiter) {
    // No Redis configured — fall back to in-memory.
    return checkRateLimit(key, limit, windowMs);
  }

  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch (err) {
    // Redis outage / network blip. Fail open to in-memory rather than
    // block legitimate users. The in-memory fallback still provides some
    // protection per-instance.
    if (process.env.NODE_ENV !== 'test') {
      console.error('[rate-limit] Redis error, falling back to in-memory:', err);
    }
    return checkRateLimit(key, limit, windowMs);
  }
}

/**
 * For observability — call once at module load or in a health endpoint
 * to confirm Redis is wired correctly.
 */
export function getRateLimitMode(): 'redis' | 'memory' {
  return getRedis() ? 'redis' : 'memory';
}
