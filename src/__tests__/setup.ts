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
process.env.NODE_ENV ??= 'test';
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
}

const mockState: MockState = { blob: null };

/** Reset the mock store to a known starting point before each test. */
export function resetMockDb(): void {
  mockState.blob = null;
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
//   supabase.from('app_state').upsert({ id: 1, data: blob }, { onConflict: 'id' })
// ────────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => {
  const createClient = () => ({
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async single() {
                  if (mockState.blob === null) {
                    // Mimic PGRST116 "no rows" so store.ts knows to seed.
                    return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
                  }
                  return { data: { data: mockState.blob }, error: null };
                },
              };
            },
          };
        },
        async upsert(row: { id: number; data: Record<string, unknown> }) {
          mockState.blob = row.data;
          return { error: null };
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
