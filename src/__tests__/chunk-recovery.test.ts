/**
 * Unit tests for the post-deploy stale-chunk recovery helper.
 *
 * The node test environment has no DOM, so we install a minimal `window`
 * stub (sessionStorage + location.reload) before each test and tear it down
 * after, exercising the same code paths the browser would.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isChunkLoadError,
  attemptChunkReload,
  recoverFromChunkError,
} from '@/lib/chunk-recovery';

function installWindow() {
  const store = new Map<string, string>();
  const reload = vi.fn();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { reload },
  };
  return { store, reload };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it('matches webpack ChunkLoadError by name', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true);
  });

  it('matches the "Loading chunk N failed" message', () => {
    expect(isChunkLoadError(new Error('Loading chunk 49 failed.'))).toBe(true);
  });

  it('matches CSS chunk and Safari module-import failures', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 5 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(
      isChunkLoadError(new Error('error loading dynamically imported module: /_next/x.js')),
    ).toBe(true);
  });

  it('does not match unrelated errors or empty input', () => {
    expect(isChunkLoadError(new Error('Something went wrong'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('attemptChunkReload', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  it('is a no-op without a window (SSR safety)', () => {
    // No window installed in this test.
    expect(attemptChunkReload()).toBe(false);
  });

  it('reloads once and records the attempt', () => {
    const { reload, store } = installWindow();
    expect(attemptChunkReload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get('metwork:chunkReloadAt')).toBe('1000000');
  });

  it('suppresses a second reload inside the cooldown window (loop guard)', () => {
    const { reload } = installWindow();
    expect(attemptChunkReload()).toBe(true);
    expect(attemptChunkReload()).toBe(false); // same instant — within 10s
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows another reload once the cooldown has elapsed', () => {
    const { reload } = installWindow();
    expect(attemptChunkReload()).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 10_001);
    expect(attemptChunkReload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('recoverFromChunkError', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
  });

  it('reloads for a chunk error', () => {
    const { reload } = installWindow();
    expect(recoverFromChunkError({ name: 'ChunkLoadError' })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a non-chunk error', () => {
    const { reload } = installWindow();
    expect(recoverFromChunkError(new Error('boom'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
