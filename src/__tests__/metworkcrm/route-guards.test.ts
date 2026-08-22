/**
 * METWORK OS CRM — structural guard coverage.
 *
 * Reads the actual page files and asserts that every route in the CRM tree is
 * guarded, and that admin-only routes use the ADMIN guard specifically.
 *
 * This is deliberately a STATIC check rather than a click-through: it fails the
 * build the moment someone adds an unguarded page or downgrades an admin page's
 * guard, which a manual test would only catch by luck. Dev rules R-19: a
 * UI-only guard is not a guard.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CRM_NAV, navForRole } from '@/components/metworkcrm/nav/nav-config';
import { ADMIN_ONLY_SEGMENTS } from '@/server/metworkcrm/auth/guards';

const APP_DIR = path.join(process.cwd(), 'src/app/metworkcrm');
const API_DIR = path.join(process.cwd(), 'src/app/api/metworkcrm');

/**
 * The only two API routes allowed to run unauthenticated, and why:
 *   login  — must be reachable before a session exists.
 *   logout — clears a cookie; requiring a valid session to sign out would
 *            strand a user holding an expired one.
 * Anything else missing a guard is a bug. This list is asserted to be exact
 * (see "the public allowlist is not stale"), so it cannot quietly grow.
 */
const PUBLIC_API_ROUTES = ['auth/login/route.ts', 'auth/logout/route.ts'];

/** Route files whose EVERY method must use the ADMIN guard (product spec §4.14). */
const ADMIN_ONLY_API_PREFIXES = ['payments/'];

/** Collect every `route.ts` under a directory, keyed by its path relative to API_DIR. */
function apiRouteFiles(): { rel: string; source: string }[] {
  const out: { rel: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') {
        out.push({
          rel: path.relative(API_DIR, full).split(path.sep).join('/'),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(API_DIR);
  return out;
}

/**
 * Strip comments before matching. Without this, a file that merely *mentions*
 * a guard in prose passes — `payments/route.ts`'s header comment says
 * "`requireCrmApiAdmin`, not `requireCrmApiUser`", which a naive substring
 * check reads as two different guards being used.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Split a route file into its individual exported HTTP handlers, so each is
 * checked on its own. A per-FILE check would pass a file whose GET is guarded
 * and whose newly-added DELETE is not.
 */
function handlersOf(source: string): { method: string; body: string }[] {
  const code = stripComments(source);
  const re = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/g;
  const starts: { method: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) starts.push({ method: m[1]!, index: m.index });
  return starts.map((s, i) => ({
    method: s.method,
    body: code.slice(s.index, starts[i + 1]?.index ?? code.length),
  }));
}

/** Every page.tsx under the guarded `(app)` group. */
function appGroupPages(): { route: string; file: string; source: string }[] {
  const groupDir = path.join(APP_DIR, '(app)');
  const out: { route: string; file: string; source: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') {
        const rel = path.relative(groupDir, path.dirname(full));
        out.push({
          route: rel === '' ? '/metworkcrm' : `/metworkcrm/${rel}`,
          file: path.relative(process.cwd(), full),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(groupDir);
  return out;
}

describe('CRM route guards', () => {
  const pages = appGroupPages();

  it('finds a page for every nav entry (nothing 404s)', () => {
    const routes = new Set(pages.map((p) => p.route));
    const navHrefs = CRM_NAV.flatMap((s) => s.items.map((i) => i.href));
    const missing = navHrefs.filter((h) => !routes.has(h));
    expect(missing).toEqual([]);
  });

  it('guards every page in the authenticated tree', () => {
    const unguarded = pages
      .filter((p) => !/requireCrmUser|requireCrmAdmin/.test(p.source))
      .map((p) => p.file);
    expect(unguarded).toEqual([]);
  });

  it('uses the ADMIN guard on every admin-only route', () => {
    const wrong = pages
      .filter((p) => ADMIN_ONLY_SEGMENTS.some((seg) => p.route === `/metworkcrm/${seg}`))
      .filter((p) => !p.source.includes('requireCrmAdmin'))
      .map((p) => p.file);
    expect(wrong).toEqual([]);
  });

  it('covers each admin-only segment with exactly one page', () => {
    for (const seg of ADMIN_ONLY_SEGMENTS) {
      const match = pages.filter((p) => p.route === `/metworkcrm/${seg}`);
      expect(match, `expected a page for /metworkcrm/${seg}`).toHaveLength(1);
    }
  });

  it('hides admin-only items from the TEAM_MEMBER sidebar', () => {
    const memberHrefs = navForRole('TEAM_MEMBER').flatMap((s) => s.items.map((i) => i.href));
    for (const seg of ADMIN_ONLY_SEGMENTS) {
      expect(memberHrefs).not.toContain(`/metworkcrm/${seg}`);
    }
    // …and still shows the ordinary ones.
    expect(memberHrefs).toContain('/metworkcrm');
    expect(memberHrefs).toContain('/metworkcrm/contacts');
  });

  it('shows every item to ADMIN', () => {
    const adminHrefs = navForRole('ADMIN').flatMap((s) => s.items.map((i) => i.href));
    const allHrefs = CRM_NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(adminHrefs.sort()).toEqual(allHrefs.sort());
  });

  it('drops any section left empty after filtering', () => {
    for (const section of navForRole('TEAM_MEMBER')) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  /**
   * The Prompt-8 audit gap: the suite walked the API directory only to check
   * runtime pinning, so nothing stopped a future prompt from shipping an
   * unguarded `/api/metworkcrm/**` route green. Coverage was correct by
   * inspection but unprotected against regression.
   */
  describe('API auth coverage', () => {
    const routes = apiRouteFiles();

    it('discovers the whole API surface (guards against a silently empty scan)', () => {
      expect(routes.length).toBeGreaterThanOrEqual(40);
      expect(routes.some((r) => r.rel === 'organizations/route.ts')).toBe(true);
    });

    it('guards every exported HTTP method on every non-public route', () => {
      const unguarded: string[] = [];
      for (const route of routes) {
        if (PUBLIC_API_ROUTES.includes(route.rel)) continue;
        for (const handler of handlersOf(route.source)) {
          if (!/requireCrmApi(User|Admin)\s*\(/.test(handler.body)) {
            unguarded.push(`${route.rel}#${handler.method}`);
          }
        }
      }
      expect(unguarded).toEqual([]);
    });

    it('exports at least one handler per route file (a file with none would pass vacuously)', () => {
      const empty = routes.filter((r) => handlersOf(r.source).length === 0).map((r) => r.rel);
      expect(empty).toEqual([]);
    });

    it('keeps the public allowlist exact — every entry exists and is genuinely unguarded', () => {
      for (const rel of PUBLIC_API_ROUTES) {
        const route = routes.find((r) => r.rel === rel);
        expect(route, `${rel} is allowlisted as public but does not exist`).toBeDefined();
        const guarded = handlersOf(route!.source).filter((h) =>
          /requireCrmApi(User|Admin)\s*\(/.test(h.body),
        );
        // If one of these ever gains a guard, the allowlist is wrong, not the route.
        expect(guarded.map((h) => h.method), `${rel} is now guarded — drop it from the allowlist`).toEqual([]);
      }
    });

    it('uses the ADMIN guard on every method of an admin-only API route', () => {
      const wrong: string[] = [];
      for (const route of routes) {
        if (!ADMIN_ONLY_API_PREFIXES.some((p) => route.rel.startsWith(p))) continue;
        for (const handler of handlersOf(route.source)) {
          if (!/requireCrmApiAdmin\s*\(/.test(handler.body)) wrong.push(`${route.rel}#${handler.method}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    it('finds the admin-only API routes it claims to check', () => {
      for (const prefix of ADMIN_ONLY_API_PREFIXES) {
        expect(routes.some((r) => r.rel.startsWith(prefix)), `no route under ${prefix}`).toBe(true);
      }
    });
  });

  it('pins every CRM route handler to the Node runtime (SQLite cannot run on Edge)', () => {
    const apiDir = path.join(process.cwd(), 'src/app/api/metworkcrm');
    const handlers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'route.ts') handlers.push(full);
      }
    };
    walk(apiDir);
    walk(APP_DIR); // picks up /metworkcrm/logout/route.ts

    expect(handlers.length).toBeGreaterThan(0);
    const notNode = handlers
      .filter((f) => !/runtime\s*=\s*'nodejs'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(process.cwd(), f));
    expect(notNode).toEqual([]);
  });
});
