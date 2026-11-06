/**
 * Vitest global setup.
 *
 * Installs a Supabase client mock so the real store.ts can read/write
 * against an in-memory JSON blob instead of hitting the network. The
 * critical-section semantics of db.update (queue, structuredClone, etc.)
 * stay intact — only persistence is mocked.
 *
 * The mock is installed BEFORE any source code imports run because Vitest
 * processes setup files first.
 */

import { vi, beforeEach } from 'vitest';
import { __resetCacheForTests } from '@/server/db/store';

// ────────────────────────────────────────────────────────────────────────
// Required env vars — set BEFORE the env validator imports anything.
// store.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set
// or it throws at construction time. Fake values are fine because the
// client itself is mocked below.
// ────────────────────────────────────────────────────────────────────────
// NODE_ENV is typed read-only by @types/node; cast to a writable view to default it.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';
process.env.SUPABASE_URL ??= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key-with-enough-chars';
process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters-long-padding';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_API_URL ??= 'http://localhost:3000/api';
process.env.API_INTERNAL_URL ??= 'http://localhost:3000/api';

// ────────────────────────────────────────────────────────────────────────
// In-memory Supabase mock state — shared across all tests in the suite.
// Reset before each test via the beforeEach below.
// ────────────────────────────────────────────────────────────────────────
interface MockState {
  /** The JSON blob normally stored in app_state.data */
  blob: Record<string, unknown> | null;
  /** Every SELECT made, by its column list ('data' = the whole document). */
  reads: string[];
  writes: number;
}

const mockState: MockState = { blob: null, reads: [], writes: 0 };

/**
 * TEST-ONLY: replace the stored row behind the store's back — what another
 * serverless instance writing to Supabase looks like to this one.
 */
export function writeMockBlobAsAnotherInstance(mutate: (blob: Record<string, unknown>) => void): void {
  const blob = structuredClone(mockState.blob ?? {});
  mutate(blob);
  blob._rev = (typeof blob._rev === 'number' ? blob._rev : 0) + 1;
  mockState.blob = blob;
}

/** TEST-ONLY: change the stored row WITHOUT moving its revision (a manual SQL edit). */
export function writeMockBlobWithoutRevision(mutate: (blob: Record<string, unknown>) => void): void {
  const blob = structuredClone(mockState.blob ?? {});
  mutate(blob);
  mockState.blob = blob;
}

/** TEST-ONLY: the SELECTs made so far ('data' = the whole document), emptied on read. */
export function takeMockReads(): string[] {
  return mockState.reads.splice(0);
}

/** TEST-ONLY: how many times the document has been written. */
export function mockWriteCount(): number {
  return mockState.writes;
}

/** Reset the mock store to a known starting point before each test. */
export function resetMockDb(): void {
  mockState.blob = null;
  mockState.reads = [];
  mockState.writes = 0;
}

beforeEach(() => {
  resetMockDb();
  // Reset the store's in-process cache so the next read fetches the
  // (now-empty) mock blob instead of returning the previous test's data.
  __resetCacheForTests();
});

// ────────────────────────────────────────────────────────────────────────
// Mock @supabase/supabase-js — minimal shape, just enough for store.ts.
// store.ts only uses:
//   supabase.from('app_state').select('data').eq('id', 1).single()
//   supabase.from('app_state').select('rev:data->>_rev').eq('id', 1).single()
//   supabase.from('app_state').select('bookings:data->bookings,…').eq('id', 1).single()
//   supabase.from('app_state').upsert({ id: 1, data: blob }, { onConflict: 'id' })
//   supabase.from('app_state').update({ data }).eq('id', 1).eq|is(<rev>).select('id')
// ────────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => {
  const createClient = () => ({
    from(_table: string) {
      return {
        select(cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async single() {
                  if (mockState.blob === null) {
                    // Mimic PGRST116 "no rows" so store.ts knows to seed.
                    return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
                  }
                  mockState.reads.push(cols);
                  if (cols !== 'data') {
                    // Aliased JSON paths, as PostgREST answers them: `->>` is text, `->` keeps the value.
                    const row: Record<string, unknown> = {};
                    for (const part of cols.split(',')) {
                      const m = /^(\w+):data(->>|->)(\w+)$/.exec(part)!;
                      const v = mockState.blob[m[3]!];
                      row[m[1]!] = v === undefined ? null : m[2] === '->>' ? String(v) : structuredClone(v);
                    }
                    return { data: row, error: null };
                  }
                  // A copy, like a real round trip: the store must never share objects with the row.
                  return { data: { data: structuredClone(mockState.blob) }, error: null };
                },
              };
            },
          };
        },
        async upsert(row: { id: number; data: Record<string, unknown> }) {
          mockState.blob = structuredClone(row.data);
          return { error: null };
        },
        // The conditional write: .update({data}).eq('id',1).is('data->_rev',null)
        // or .eq('data->>_rev','N'), then .select('id'). Matches only while the
        // stored revision is the one the writer loaded.
        update(patch: { data: Record<string, unknown> }) {
          let expected: string | null | undefined;
          const chain = {
            eq(col: string, val: unknown) {
              if (col === 'data->>_rev') expected = String(val);
              return chain;
            },
            is(col: string, val: null) {
              if (col === 'data->_rev') expected = val;
              return chain;
            },
            async select(_cols: string) {
              const raw = mockState.blob?._rev;
              const current = raw === undefined || raw === null ? null : String(raw);
              if (mockState.blob === null || current !== expected) return { data: [], error: null };
              mockState.blob = structuredClone(patch.data);
              mockState.writes += 1;
              return { data: [{ id: 1 }], error: null };
            },
          };
          return chain;
        },
      };
    },
  });
  return { createClient };
});

// ────────────────────────────────────────────────────────────────────────
// Force store.ts to invalidate its in-process cache between tests so
// mutations from one test don't bleed into another. We can't reach into
// the module's `cache` variable, but we can re-import it via vi.resetModules
// in a beforeEach if needed. For now, tests should call resetMockDb()
// explicitly and use `vi.resetModules()` between cases that share state.
// ────────────────────────────────────────────────────────────────────────

// vi.resetModules() was tempting but doesn't help: test files import db and
// other modules at the top, BEFORE beforeEach runs. Those bindings are already
// resolved. Forcing a re-import would only affect lazy imports. __resetCacheForTests
// above gives us what we actually need — fresh state without re-importing.
