/**
 * The consultant portal is drawn in the dashboard's design system.
 *
 * Every screen a signed-in consultant sees now reads the same semantic tokens
 * the incubator dashboard reads — `bg-card`, `text-muted-foreground`,
 * `border-border`, `bg-primary` — instead of the hardcoded hex it used to
 * carry. That is the whole point of the change, and it is exactly the kind of
 * thing that decays one hurried `style={{ color: '#5A615E' }}` at a time.
 *
 * So this reads the source. A literal colour on a dashboard-surface file fails
 * the suite with the line that introduced it.
 *
 * Two deliberate exemptions:
 *   • The DARK auth screens (PIN unlock, email OTP, phone verify and their
 *     helpers) are a separate, deliberately near-black surface. They keep their
 *     literals and are not part of this rule.
 *   • `shared.tsx` still DEFINES the CP_* constants those auth screens use.
 *     The definitions are allowed; what is not allowed is a light-surface
 *     component consuming them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = 'src/components/features/consultant/portal';
const SHELL = 'src/components/features/consultant/consultant-portal.tsx';

/** The near-black auth flow — its own surface, its own palette. */
const AUTH_SCREENS = new Set([
  'email-otp-signin.tsx',
  'pin-unlock.tsx',
  'phone-verify.tsx',
  'otp-code-input.tsx',
  'country-code-select.tsx',
  'signature-pad.tsx',
  'language-switcher.tsx',
  'shared.tsx',
]);

/** Files that render the signed-in dashboard. */
function dashboardSurfaceFiles(): string[] {
  const inPortal = readdirSync(PORTAL)
    .filter((f) => f.endsWith('.tsx') && !AUTH_SCREENS.has(f))
    .map((f) => join(PORTAL, f));
  return [...inPortal, SHELL];
}

/** A `#rgb` / `#rrggbb` literal, ignoring anything inside a line comment. */
const HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/;

function offendingLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => {
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return false;
      return HEX.test(line);
    })
    .map(({ line, n }) => `${file}:${n}  ${line.slice(0, 96)}`);
}

describe('the consultant dashboard uses the shared design tokens', () => {
  const files = dashboardSurfaceFiles();

  it('finds the portal files it is meant to be guarding', () => {
    // A rename that silently emptied this list would make every assertion
    // below pass while checking nothing.
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.some((f) => f.endsWith('programs-section.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('consultant-portal.tsx'))).toBe(true);
  });

  it('ships no literal hex colours on any signed-in screen', () => {
    const offenders = files.flatMap(offendingLines);
    expect(offenders, `Use a token (bg-card, text-muted-foreground, border-border, bg-primary) instead:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('consumes none of the dark auth screens\' CP_* colour constants', () => {
    const consumers = files.filter((f) => /\bCP_(GREEN|LIGHT|BLACK)/.test(readFileSync(f, 'utf8')));
    expect(consumers, `These render the light dashboard and must not use the auth palette:\n${consumers.join('\n')}`)
      .toEqual([]);
  });

  it('pins the light palette so the portal never follows a dark app theme', () => {
    // The user asked for the portal to stay light. `.portal-light` re-declares
    // the light tokens, and `.dark .portal-light` is what makes that survive a
    // dark ancestor — without the second selector the lock silently does
    // nothing the moment a theme toggle ships.
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toContain('.portal-light');
    expect(css).toContain('.dark .portal-light');

    const shell = readFileSync(SHELL, 'utf8');
    expect(shell).toContain('portal-light');
  });
});
