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
