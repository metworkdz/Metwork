/**
 * Supabase credentials for standalone `npx tsx scripts/…` runs.
 *
 * A bare tsx script does NOT get Next.js's automatic `.env.local` loading, and
 * `store.ts` falls back to a placeholder Supabase URL when the vars are absent.
 * A script that forgets this does not fail obviously — it "connects" to
 * `placeholder.supabase.co`, and depending on the operation either throws a
 * bare `fetch failed` or reports an empty database, which reads as "nothing to
 * do". A maintenance script that appears to succeed while never having reached
 * production is the worst possible failure mode, so this module exists to make
 * the connection explicit and to refuse a placeholder outright.
 *
 * Call `loadScriptEnv()` BEFORE importing anything that touches `store.ts` —
 * the store reads these vars at construction time.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ScriptTarget {
  /** 'local' = the JSON file backend; 'supabase' = the real store. */
  kind: 'local' | 'supabase';
  /** Host shown to the operator so they can see WHICH database this is. */
  label: string;
}

/** Parse a dotenv-style file into a plain map. Comments and blanks ignored. */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Populate `process.env` for a maintenance script and report what it will talk
 * to. Exits with a message rather than proceeding against a placeholder.
 *
 * `USE_LOCAL_DB=true` short-circuits to the local JSON file, for testing a
 * script before pointing it at production.
 */
export function loadScriptEnv(): ScriptTarget {
  // Defaults the env validator needs; only used in local mode.
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV ??= 'development';
  env.AUTH_SECRET ??= 'local-script-secret-at-least-32-characters-long-padding';
  env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
  env.NEXT_PUBLIC_API_URL ??= 'http://localhost:3000/api';
  env.API_INTERNAL_URL ??= 'http://localhost:3000/api';

  if (process.env.USE_LOCAL_DB === 'true') {
    env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
    env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-not-used-in-local-mode';
    return { kind: 'local', label: process.env.LOCAL_DB_PATH ?? '.local-db.json' };
  }

  const envFile = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envFile)) {
    console.error(
      `✘ ${envFile} not found — no Supabase credentials.\n` +
        '  Run from the repo root, or pass USE_LOCAL_DB=true to work on the local JSON store.',
    );
    process.exit(1);
  }

  const fromFile = parseEnvFile(envFile);
  const url = process.env.SUPABASE_URL ?? fromFile.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromFile.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('✘ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
    process.exit(1);
  }
  if (url.includes('placeholder')) {
    console.error(
      '✘ SUPABASE_URL is still a placeholder — refusing to run.\n' +
        '  This is the failure that makes a script look like it succeeded against production.',
    );
    process.exit(1);
  }

  env.SUPABASE_URL = url;
  env.SUPABASE_SERVICE_ROLE_KEY = key;
  return { kind: 'supabase', label: url.replace(/^https:\/\//, '') };
}
