/**
 * METWORK OS CRM — environment validation.
 *
 * Deliberately SEPARATE from `@/lib/env.ts`. The CRM build is allowed to touch
 * exactly two platform files (`src/middleware.ts`, `next.config.mjs` — see
 * METWORK_OS_DEVELOPMENT_RULES.md R-4/R-30); adding keys to the platform's env
 * schema would make it a third. Keeping CRM config here means a
 * misconfiguration of the CRM can never fail the platform's startup validation,
 * and vice versa.
 *
 * SERVER-ONLY. Never import from a client component.
 */
import { z } from 'zod';

const schema = z.object({
  /**
   * `file:…`      → local SQLite via better-sqlite3 (dev / test)
   * `libsql://…`  → Turso via @libsql/client (production)
   * `https://…`   → Turso over plain HTTP (production, proxied)
   */
  METWORKCRM_DATABASE_URL: z.string().min(1).default('file:.crm-local.db'),
  /** Required for Turso only. Ignored by the file driver. */
  METWORKCRM_DATABASE_AUTH_TOKEN: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function crmEnv(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse({
    METWORKCRM_DATABASE_URL: process.env.METWORKCRM_DATABASE_URL,
    METWORKCRM_DATABASE_AUTH_TOKEN: process.env.METWORKCRM_DATABASE_AUTH_TOKEN,
  });
  if (!parsed.success) {
    throw new Error(
      `[metworkcrm] Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Which driver the current URL selects. Exported for diagnostics/tests. */
export function crmDriverKind(url = crmEnv().METWORKCRM_DATABASE_URL): 'libsql' | 'file' {
  return url.startsWith('libsql://') || url.startsWith('https://') ? 'libsql' : 'file';
}

/** TEST-ONLY: drop the memoized env so a test can swap the database URL. */
export function __resetCrmEnvForTests(): void {
  cached = null;
}
