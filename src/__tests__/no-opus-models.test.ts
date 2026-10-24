/**
 * Cost rule: no feature calls an Opus model. Fails if any server or app code
 * names one (copilot, hiring matcher, cofounder matching, anything new).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('Claude models', () => {
  it('never names an Opus model in src/server or src/app', () => {
    const offenders = [...files(join(process.cwd(), 'src/server')), ...files(join(process.cwd(), 'src/app'))]
      .filter((f) => /claude-opus/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
