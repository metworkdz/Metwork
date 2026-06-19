/**
 * Recovery for stale JS/CSS chunk loads after a deploy.
 *
 * Long-lived clients — most acutely an iOS home-screen PWA, which iOS
 * *resumes* (frozen WebView) rather than reloads — can keep an in-memory
 * router pinned to an old build id for days. After a new deploy ships and
 * the old `/_next/static/chunks/*` are purged, a soft navigation to a route
 * the user hadn't visited yet requests a now-404 chunk → `ChunkLoadError`.
 *
 * A fresh document fixes it (the served HTML references the current build),
 * so the recovery is a single hard reload. The only real hazard is a reload
 * loop when the chunk is *genuinely* unrecoverable (e.g. truly offline), so
 * every reload is gated behind a short cooldown recorded in sessionStorage:
 * we reload at most once per `RELOAD_COOLDOWN_MS`, after which the error
 * boundary UI is allowed to show instead of looping.
 *
 * Client-only — all helpers are no-ops when `window` is unavailable so they
 * are safe to import from Server Components' error boundaries.
 */

const RELOAD_KEY = 'metwork:chunkReloadAt';
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * True when `error` looks like a failed chunk / dynamic-import load across the
 * browsers we support. Covers webpack's `ChunkLoadError` (Chrome/Firefox),
 * the "Loading chunk N failed" / "Loading CSS chunk" messages, and Safari's
 * native ES-module import failures ("Importing a module script failed",
 * "error loading dynamically imported module").
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const name = (error as { name?: unknown }).name;
  if (name === 'ChunkLoadError') return true;

  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;

  return (
    /Loading chunk [^\s]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /failed to fetch dynamically imported module/i.test(message)
  );
}

/**
 * Trigger a one-time hard reload to pull a fresh document + chunk graph,
 * unless we already reloaded within the cooldown window (loop guard).
 *
 * @returns `true` if a reload was scheduled, `false` if it was suppressed
 *          (no window, or still inside the cooldown) — callers should keep
 *          rendering their fallback UI when this returns `false`.
 */
export function attemptChunkReload(): boolean {
  if (typeof window === 'undefined') return false;

  let lastAttempt = 0;
  try {
    lastAttempt = Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    // Private mode / disabled storage — fall through and reload once. Without
    // a persisted timestamp we can't loop-guard, but a single reload is the
    // safe default and the page either recovers or surfaces the boundary.
  }

  const now = Date.now();
  if (now - lastAttempt < RELOAD_COOLDOWN_MS) return false;

  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* ignore — see note above */
  }

  window.location.reload();
  return true;
}

/**
 * Recover from a chunk-load error if that's what `error` is. Returns `true`
 * when a reload was scheduled so the caller knows recovery is in progress.
 */
export function recoverFromChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  return attemptChunkReload();
}
