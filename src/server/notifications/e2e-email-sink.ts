/**
 * Test-only email observability sink.
 *
 * The notifier is fire-and-forget and, without Resend configured, only
 * console.logs — so an e2e test can't tell whether an email was triggered, let
 * alone HOW MANY times (the key assertion for idempotent approvals). This sink
 * appends one JSONL line per would-be email to a file next to the local DB.
 *
 * Guarded on `USE_LOCAL_DB === 'true'` — the same flag the e2e/local server
 * already runs under (see store.ts) and which PRODUCTION never sets. So this is
 * a strict no-op in prod: zero behaviour change, no new env var, no prod import
 * of it beyond the guarded call.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Mirrors store.ts localDbPath so the sink sits alongside `.local-db.json`. */
function sinkPath(): string {
  const dbPath = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  return path.join(path.dirname(dbPath), '.e2e-emails.jsonl');
}

/**
 * Record a would-be email. No-op unless USE_LOCAL_DB=true. Never throws — an
 * observability write must not affect the (already fire-and-forget) notifier.
 */
export function recordE2eEmail(kind: string, meta: Record<string, unknown>): void {
  if (process.env.USE_LOCAL_DB !== 'true') return;
  try {
    const line = JSON.stringify({ kind, at: new Date().toISOString(), ...meta });
    fs.appendFileSync(sinkPath(), `${line}\n`, 'utf8');
  } catch {
    // Observability only — swallow.
  }
}
