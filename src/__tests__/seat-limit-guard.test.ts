/**
 * Guard: nobody compares "people in" against "places" by hand.
 *
 * `taken >= capacity` used to be copied into seven places that can refuse a person
 * and a dozen that draw a counter. With "No limit on registrations" every one of
 * them has to treat a listing with no limit as never full — so a hand-written
 * comparison is a bug waiting for the next feature. They all ask `@/lib/seat-limit`.
 *
 * This fails when a new comparison appears outside that module, which is the cheap
 * moment to send the author there.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** people-in on one side, places on the other, with a comparison between them. */
const PEOPLE = '(?:taken|occupied|attendeeCount|seatsTaken|confirmed)';
const PLACES = '(?:capacity|seatsTotal|seatLimit)';
const COMPARISONS = [
  new RegExp(`\\b${PEOPLE}\\s*(?:>=|>|<=|<)\\s*[\\w.?]*${PLACES}\\b`),
  new RegExp(`\\b[\\w.?]*${PLACES}\\s*(?:>=|>|<=|<)\\s*[\\w.]*${PEOPLE}\\b`),
];

/**
 * Files that may compare, and why.
 *  • seat-limit.ts — the rule itself.
 *  • registrations/service.ts — the waitlist trigger; its `capacity` is already
 *    `seatLimit(...)` and the branch is skipped when that is null.
 *  • space/desk code — "capacity" there is the size of a room, not seats on a listing.
 */
const ALLOWED = [
  'lib/seat-limit.ts',
  'server/registrations/service.ts',
  'server/bookings/availability.ts',
  'server/bookings/space-catalog.ts',
  'server/spaces/availability.ts',
  'lib/space-availability-view.ts',
];

describe('seat comparisons live in one module', () => {
  it('no file outside the rule compares people-in with places by hand', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.includes(rel) || /spaces?|desk|metworkcrm/i.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (COMPARISONS.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `Use hasRoom / isFull / seatsLeft from '@/lib/seat-limit' instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard itself notices a hand-written comparison', () => {
    expect(COMPARISONS.some((re) => re.test('if (taken >= event.capacity) return full;'))).toBe(true);
    expect(COMPARISONS.some((re) => re.test('if (program.seatsTotal <= seatsTaken) {'))).toBe(true);
    expect(COMPARISONS.some((re) => re.test('if (!hasRoom(event, taken)) return full;'))).toBe(false);
  });
});
