/**
 * Architectural guard: `d.consultantContracts` may only be written through
 * `src/server/consultant-contracts/service.ts`.
 *
 * Why this exists as a test rather than a type: the store exposes a raw
 * `db.update(d => …)` mutator, so TypeScript cannot stop a future route from
 * reaching straight into the collection and rewriting a SIGNED contract. The
 * immutability rules in `updateContract()` are only worth anything if that
 * gateway is the sole write path, so the invariant is pinned by grepping the
 * source — the one mechanism that actually covers every future caller.
 *
 * If this fails, the fix is to route the write through the service, not to add
 * the offending file to the allowlist.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** The only files allowed to name the collection in a write position. */
const ALLOWED = new Set([
  path.join('src', 'server', 'consultant-contracts', 'service.ts'),
  // Declares the collection and its empty default.
  path.join('src', 'server', 'db', 'store.ts'),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('consultantContracts write isolation', () => {
  it('is never mutated outside the contract service', () => {
    // A write looks like `x.consultantContracts` followed by an assignment, a
    // mutating array method, or a delete — plain reads (`.find`, `.filter`,
    // spread) are legitimate anywhere.
    const writePattern =
      /(?:delete\s+[\w.()!\s]*\.consultantContracts\b)|(?:\.consultantContracts\s*(?:=[^=]|\?\?=)) |(?:\.consultantContracts(?:!|\s*\?\.)?\s*\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\()/;

    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const relative = path.relative(process.cwd(), file);
      if (ALLOWED.has(relative)) continue;
      // Tests are allowed to construct state directly — they exist precisely to
      // prove the gateway holds against records it did not create.
      if (relative.includes(`__tests__${path.sep}`)) continue;

      const source = readFileSync(file, 'utf8');
      if (writePattern.test(source)) offenders.push(relative);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the space-booking contract feature separate', () => {
    // `src/server/contracts/` is the incubator space-booking contract module —
    // a different feature with a colliding name. Neither may reach into the
    // other's collection.
    const consultantService = readFileSync(
      path.join(SRC, 'server', 'consultant-contracts', 'service.ts'),
      'utf8',
    );
    expect(consultantService).not.toMatch(/\bcontractTemplates\b/);

    for (const file of walk(path.join(SRC, 'server', 'contracts'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bconsultantContracts\b/);
    }
  });
});
