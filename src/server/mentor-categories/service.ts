/**
 * Mentor categories — the ONE canonical module for the admin-managed
 * category taxonomy. No category name is hardcoded anywhere else: every
 * consumer (admin picker, public directory filter, dashboard filter) reads
 * through `listMentorCategories` / `listActiveMentorCategories`.
 *
 * The 8 starter rows below exist only as one-time bootstrap data — after
 * `ensureMentorCategoriesSeeded` writes them, they are plain DB records like
 * any admin-created category: renamable, reorderable, deactivatable. The
 * seeder never runs again once `meta.mentorCategoriesSeeded` is set.
 *
 * Deactivation, not deletion: there is deliberately no delete function.
 * `active: false` drops a category out of "assign a new category" pickers
 * and public/dashboard filters while it stays intact on any mentor record
 * that already carries it.
 */
import { randomUUID } from 'node:crypto';
import { db, type MentorCategoryRecord } from '@/server/db/store';
import type { CreateMentorCategoryInput, PatchMentorCategoryInput } from './schemas';

/* ─────────────────────── Seed data (one-time bootstrap only) ─────────────────────── */

const starterCategories: { label: MentorCategoryRecord['label']; sortOrder: number }[] = [
  { sortOrder: 0, label: { en: 'Legal & Compliance', fr: 'Juridique & Conformité', ar: 'القانون والامتثال' } },
  { sortOrder: 1, label: { en: 'Finance & Fundraising', fr: 'Finance & Levée de fonds', ar: 'المالية وجمع التمويل' } },
  { sortOrder: 2, label: { en: 'Marketing & Growth', fr: 'Marketing & Croissance', ar: 'التسويق والنمو' } },
  { sortOrder: 3, label: { en: 'Product & Tech', fr: 'Produit & Tech', ar: 'المنتج والتكنولوجيا' } },
  { sortOrder: 4, label: { en: 'Operations & Strategy', fr: 'Opérations & Stratégie', ar: 'العمليات والاستراتيجية' } },
  { sortOrder: 5, label: { en: 'HR & Team', fr: 'RH & Équipe', ar: 'الموارد البشرية والفريق' } },
  { sortOrder: 6, label: { en: 'Sales & BD', fr: 'Ventes & Développement commercial', ar: 'المبيعات وتطوير الأعمال' } },
  { sortOrder: 7, label: { en: 'Design & Branding', fr: 'Design & Image de marque', ar: 'التصميم والهوية التجارية' } },
];

/**
 * Idempotent, safe to call on every read (mirrors `backfillMentorSlugs` /
 * `ensurePromoCodesSeeded`). Runs in every environment — unlike the promo-code
 * example seed, these are real starter data the admin is expected to use.
 */
export async function ensureMentorCategoriesSeeded(): Promise<void> {
  const data = await db.read();
  if (data.meta?.mentorCategoriesSeeded) return;

  await db.update((d) => {
    if (d.meta?.mentorCategoriesSeeded) return;
    if (!d.meta) d.meta = {};
    if (!Array.isArray(d.mentorCategories)) d.mentorCategories = [];
    if (d.mentorCategories.length === 0) {
      const now = new Date().toISOString();
      d.mentorCategories.push(
        ...starterCategories.map((c) => ({
          id: randomUUID(),
          label: c.label,
          sortOrder: c.sortOrder,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    d.meta.mentorCategoriesSeeded = true;
  });
}

/* ─────────────────────── Reads ─────────────────────── */

function sortCategories(categories: MentorCategoryRecord[]): MentorCategoryRecord[] {
  return [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.en.localeCompare(b.label.en),
  );
}

/** All categories (active and inactive), sorted for the admin manager. */
export async function listMentorCategories(): Promise<MentorCategoryRecord[]> {
  await ensureMentorCategoriesSeeded();
  const data = await db.read();
  return sortCategories(data.mentorCategories ?? []);
}

/**
 * The only list source for "assign a new category" pickers and public/
 * dashboard category filters — inactive categories never appear here.
 */
export async function listActiveMentorCategories(): Promise<MentorCategoryRecord[]> {
  return (await listMentorCategories()).filter((c) => c.active);
}

/* ─────────────────────── Admin: category CRUD ─────────────────────── */

export async function createMentorCategory(
  input: CreateMentorCategoryInput,
): Promise<MentorCategoryRecord> {
  const now = new Date().toISOString();
  const record: MentorCategoryRecord = {
    id: randomUUID(),
    label: {
      fr: input.label.fr.trim(),
      en: input.label.en.trim(),
      ar: input.label.ar.trim(),
    },
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.update((d) => {
    if (!Array.isArray(d.mentorCategories)) d.mentorCategories = [];
    d.mentorCategories.push(record);
  });
  return record;
}

/** Rename / reorder / (de)activate a category. Returns null when not found. Never deletes. */
export async function updateMentorCategory(
  id: string,
  input: PatchMentorCategoryInput,
): Promise<MentorCategoryRecord | null> {
  return db.update((d) => {
    const category = (d.mentorCategories ?? []).find((c) => c.id === id);
    if (!category) return null;
    if (input.label !== undefined) {
      category.label = {
        fr: input.label.fr.trim(),
        en: input.label.en.trim(),
        ar: input.label.ar.trim(),
      };
    }
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    if (input.active !== undefined) category.active = input.active;
    category.updatedAt = new Date().toISOString();
    return { ...category };
  });
}
