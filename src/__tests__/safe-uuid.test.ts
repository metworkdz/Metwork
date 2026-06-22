import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeUUID } from '@/lib/safe-uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('safeUUID', () => {
  it('returns a valid RFC 4122 v4 string', () => {
    expect(safeUUID()).toMatch(V4);
  });

  it('is unique across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => safeUUID()));
    expect(set.size).toBe(1000);
  });

  it('uses native crypto.randomUUID when available', () => {
    const native = '11111111-1111-4111-8111-111111111111';
    const spy = vi.fn(() => native);
    vi.stubGlobal('crypto', { randomUUID: spy, getRandomValues: (a: Uint8Array) => a });
    expect(safeUUID()).toBe(native);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('falls back to getRandomValues when randomUUID is missing (iOS < 15.4)', () => {
    const getRandomValues = vi.fn((a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = (i * 17) & 0xff;
      return a;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const id = safeUUID();
    expect(id).toMatch(V4);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('falls back to Math.random when web-crypto is entirely absent', () => {
    vi.stubGlobal('crypto', undefined);
    expect(safeUUID()).toMatch(V4);
  });
});
