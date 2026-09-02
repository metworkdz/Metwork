/**
 * Every notification sender must be awaitable, and every route must await it.
 *
 * This is a STATIC guard, deliberately, because the failure it catches is
 * invisible at runtime in dev: a fire-and-forget send completes fine on a
 * long-lived local server and is silently dropped on Vercel, which freezes the
 * lambda the moment the response is returned. That cost us the contract-ready
 * mail, the password-reset mail, and — worst — the signup OTP itself, each of
 * which looked perfectly healthy locally.
 *
 * Rather than test 26 senders through 12 routes, assert the two invariants that
 * make the bug impossible:
 *   1. no sender declares a `void` return, so a caller CAN await it;
 *   2. no route statement calls one without awaiting.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const MOCK = path.join(ROOT, 'src/server/notifications/mock.ts');
const API = path.join(ROOT, 'src/app/api');

/** Every .ts file under src/app/api. */
function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

describe('notification senders are awaitable', () => {
  it('no exported sender returns void', () => {
    const src = fs.readFileSync(MOCK, 'utf8');
    const offenders: string[] = [];

    // The return type sits between the parameter list's CLOSING paren and the
    // body's opening brace — and cannot be found by scanning to the first `{`,
    // because parameter object types (`opts: { a: string }`) contain their own.
    // So match parens properly.
    const decl = /export (?:async )?function (send[A-Za-z]+)\(/g;
    for (let m = decl.exec(src); m; m = decl.exec(src)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
      }
      const brace = src.indexOf('{', i - 1);
      const returnType = src.slice(i - 1, brace).replace(/[)\s:]/g, '');
      // `void` means a caller cannot wait for it, so the send dies with the lambda.
      if (returnType === 'void') offenders.push(m[1]!);
    }

    expect(offenders, `these senders cannot be awaited: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('routes await their sends', () => {
  it('no route calls a sender as a bare, unawaited statement', () => {
    const offenders: string[] = [];
    for (const file of routeFiles(API)) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // A statement-position call: indentation, then send…( — with no
        // `await`, no `void`, and not part of a larger expression.
        if (!/^\s+send[A-Za-z]+\(/.test(line)) return;
        // Inside a Promise.all([...]) / .push(...) the await is on the wrapper,
        // which the previous lines carry.
        const before = src.split('\n').slice(Math.max(0, i - 4), i).join(' ');
        if (/await\s+Promise\.all\(\[|\.push\($|\.push\(\s*$/.test(before)) return;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, `unawaited sends:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
