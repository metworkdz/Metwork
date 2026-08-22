/**
 * METWORK OS CRM — global search.
 *
 * Per METWORK_OS_DATABASE_SCHEMA.md §8: a single UNION ALL, no FTS index —
 * appropriate at internal-CRM volume. Startups/Experts search on
 * `COALESCE(display_name_cache, name)` because a platform-linked record can
 * have `name IS NULL` (schema doc §7.4) — every UI-created record in this
 * pass is CRM_ONLY though, so `name` is always populated in practice.
 */
import { sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';

/**
 * Payments is deliberately NOT searchable here — product spec §4.14 isolates
 * it as a fully role-gated module (TEAM_MEMBER gets 403 on the route AND the
 * API); a search result leaking a payment's existence through the shared
 * search bar would undercut that isolation even without showing the amount.
 */
export type SearchResultKind =
  | 'ORGANIZATION' | 'CONTACT' | 'TASK' | 'INTERACTION'
  | 'OPPORTUNITY' | 'STARTUP' | 'EXPERT' | 'PARTNERSHIP'
  | 'OI_PROJECT' | 'PROGRAM' | 'SPACE_BOOKING' | 'DOCUMENT';

export interface SearchResultRow {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string | null;
}

export interface SearchResultGroup {
  kind: SearchResultKind;
  items: SearchResultRow[];
}

const GROUP_ORDER: SearchResultKind[] = [
  'ORGANIZATION', 'CONTACT', 'OPPORTUNITY', 'STARTUP', 'EXPERT', 'PARTNERSHIP',
  'OI_PROJECT', 'PROGRAM', 'SPACE_BOOKING', 'DOCUMENT', 'TASK', 'INTERACTION',
];
const PER_KIND_LIMIT = 8;

/** Escape SQLite LIKE wildcards so a literal `%`/`_` in the query isn't treated as one. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function globalSearch(rawQuery: string): Promise<SearchResultGroup[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const term = likeTerm(q);
  const db = getCrmDb();

  const rows = await db.all<{ kind: SearchResultKind; id: string; title: string; subtitle: string | null }>(sql`
    SELECT * FROM (
      SELECT 'ORGANIZATION' AS kind, id, name AS title, city AS subtitle, updated_at AS sort_key
      FROM crm_organizations
      WHERE name LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'CONTACT' AS kind, id, full_name AS title, email AS subtitle, updated_at AS sort_key
      FROM crm_contacts
      WHERE full_name LIKE ${term} ESCAPE '\\' COLLATE NOCASE OR email LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'OPPORTUNITY' AS kind, id, title AS title, stage AS subtitle, updated_at AS sort_key
      FROM crm_opportunities
      WHERE title LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'STARTUP' AS kind, id, COALESCE(display_name_cache, name) AS title, sector AS subtitle, updated_at AS sort_key
      FROM crm_startups
      WHERE COALESCE(display_name_cache, name) LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'EXPERT' AS kind, id, COALESCE(display_name_cache, name) AS title, city AS subtitle, updated_at AS sort_key
      FROM crm_experts
      WHERE COALESCE(display_name_cache, name) LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'PARTNERSHIP' AS kind, id, name AS title, stage AS subtitle, updated_at AS sort_key
      FROM crm_partnerships
      WHERE name LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'OI_PROJECT' AS kind, id, title AS title, stage AS subtitle, updated_at AS sort_key
      FROM crm_oi_projects
      WHERE title LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'PROGRAM' AS kind, id, title AS title, stage AS subtitle, updated_at AS sort_key
      FROM crm_programs
      WHERE title LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'SPACE_BOOKING' AS kind, id, space_label AS title, reference AS subtitle, updated_at AS sort_key
      FROM crm_space_bookings
      WHERE space_label LIKE ${term} ESCAPE '\\' COLLATE NOCASE OR reference LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'DOCUMENT' AS kind, id, title AS title, type AS subtitle, updated_at AS sort_key
      FROM crm_documents
      WHERE title LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'TASK' AS kind, id, title AS title, status AS subtitle, updated_at AS sort_key
      FROM crm_tasks
      WHERE title LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'INTERACTION' AS kind, id, subject AS title, type AS subtitle, updated_at AS sort_key
      FROM crm_interactions
      WHERE subject LIKE ${term} ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC LIMIT ${PER_KIND_LIMIT}
    )
  `);

  const byKind = new Map<SearchResultKind, SearchResultRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push({ kind: row.kind, id: row.id, title: row.title, subtitle: row.subtitle });
    byKind.set(row.kind, list);
  }

  return GROUP_ORDER.filter((k) => (byKind.get(k) ?? []).length > 0).map((kind) => ({
    kind,
    items: byKind.get(kind)!,
  }));
}
