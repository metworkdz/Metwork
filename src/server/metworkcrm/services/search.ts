/**
 * METWORK OS CRM — global search.
 *
 * v1 per METWORK_OS_DATABASE_SCHEMA.md §8: a single UNION ALL across
 * Organizations, Contacts, Tasks and Interactions, no FTS index — appropriate
 * at internal-CRM volume. Entities that live in the platform's JSON store
 * (StartupListing, MentorRecord) are deliberately NOT in this search; they get
 * their own linking-search screen once Prompt 3 adds `platform-refs.ts`.
 */
import { sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';

export type SearchResultKind = 'ORGANIZATION' | 'CONTACT' | 'TASK' | 'INTERACTION';

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

const GROUP_ORDER: SearchResultKind[] = ['ORGANIZATION', 'CONTACT', 'TASK', 'INTERACTION'];
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
