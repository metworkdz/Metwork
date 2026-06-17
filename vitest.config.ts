import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for Metwork integration tests.
 *
 * Why Vitest over Jest:
 *   - Native ESM (Jest still requires babel transforms for ESM packages
 *     like @upstash/ratelimit and zod)
 *   - 3–5x faster cold start, which matters when you run a single test
 *     during TDD
 *   - Same expect()/describe()/it() surface as Jest, so existing knowledge
 *     carries over
 *
 * Test layout: src/__tests__/**.test.ts
 *   - Co-located with source so it's clear which module a test belongs to
 *   - Use *.test.ts (not *.spec.ts) per the codebase's existing convention
 *     in eslint.config.mjs
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    // Setup file runs ONCE before any tests — used to install module mocks
    // (notably the Supabase client) before any real code imports it.
    setupFiles: ['./src/__tests__/setup.ts'],
    // Tests touch shared module state (the in-memory DB fixture) — run them
    // serially in one fork to avoid flaky interleaving. Vitest 4 removed
    // `poolOptions.forks.singleFork`; `fileParallelism: false` is the
    // replacement — it forces maxWorkers to 1, so all files run sequentially.
    pool: 'forks',
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
