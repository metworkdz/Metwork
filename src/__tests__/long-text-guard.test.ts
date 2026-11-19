/**
 * Guard: a long unbroken string (a pasted URL, an email, a handle) must never push
 * a page wider than the phone or run out of its card.
 *
 * It did, in three ways, until these rules existed:
 *   • a grid with no column template is one "auto" column that grows to fit the
 *     widest word, so one registration answer made a 390 px phone page 1,428 px wide;
 *   • a `flex-1` item will not shrink below its content, so a long name in a profile
 *     header stretched the page to 621 px;
 *   • with nothing allowed to break, the text ran out of its box.
 *
 * jsdom has no layout, so this pins the rules themselves. They are zero-specificity
 * (`:where`) on purpose: an explicit `grid-cols-*` / `min-w-*` must still win. The
 * real check is a phone-size crawl with long text in every field.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'styles/globals.css'), 'utf8');
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('long text cannot widen a page', () => {
  it('lets a word that would overflow break, everywhere', () => {
    expect(squash(css)).toMatch(/body \{[^}]*overflow-wrap: break-word/);
  });

  it('pins a column-less grid to its container instead of its widest word', () => {
    expect(squash(css)).toMatch(/:where\(\.grid:not\(\.grid-flow-col\)\) \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('lets a flex-1 item shrink below its content', () => {
    expect(squash(css)).toMatch(/:where\(\.flex-1\) \{ min-width: 0; \}/);
  });

  it('keeps the two layout rules at zero specificity, so explicit utilities win', () => {
    // A rule like `.grid:not(.x)` (0,2,0) would silently beat `.sm\:grid-cols-2` (0,1,0).
    expect(css).not.toMatch(/^\s*\.grid[^{]*\{[^}]*grid-template-columns/m);
    expect(css).not.toMatch(/^\s*\.flex-1\s*\{/m);
  });

  it('wraps what an applicant typed in a registration answer', () => {
    const answer = readFileSync(join(root, 'components/features/registrations/registration-answer.tsx'), 'utf8');
    expect(answer).toContain('[overflow-wrap:anywhere]');
  });
});
