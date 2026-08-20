/**
 * Shared env bootstrap for the METWORK OS CRM CLI scripts.
 *
 * Mirrors the convention of the existing platform scripts: parse `.env.local`
 * by hand rather than pulling in a dotenv dependency. Import this FIRST, before
 * anything that reads `process.env`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(ENV_FILE)) {
  for (const rawLine of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Default to the local SQLite file so a bare `npm run crm:migrate` works with
// no configuration at all.
process.env.METWORKCRM_DATABASE_URL ??= 'file:.crm-local.db';

export const CRM_DATABASE_URL = process.env.METWORKCRM_DATABASE_URL;
