/**
 * Contract test for GET /api/mentors/directory — the lightweight,
 * locale-resolved mentor listing shared by the public /mentors page and
 * the dashboard consultations page (both derive the same view in-process
 * via `resolveMentorCard`; this route is the independently-fetchable
 * version of that same contract).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { db, type MentorRecord, type MentorCategoryRecord } from '@/server/db/store';

function seedMentor(over: Partial<MentorRecord> = {}): Promise<unknown> {
  return db.update((d) => {
    d.mentors = [
      ...(d.mentors ?? []),
      {
        id: 'm1',
        fullName: 'Amina Test',
        position: 'Growth Advisor',
        imageUrl: 'https://example.com/amina.jpg',
        bio: null,
        linkedinUrl: null,
        consultationFee: 4000,
        createdAt: '2026-01-01T00:00:00Z',
        ...over,
      } as MentorRecord,
    ];
  });
}

function seedCategories(cats: Partial<MentorCategoryRecord>[]): Promise<unknown> {
  return db.update((d) => {
    d.mentorCategories = cats.map((c, i) => ({
      id: `cat-${i}`,
      label: { fr: `Cat ${i} FR`, en: `Cat ${i} EN`, ar: `Cat ${i} AR` },
      active: true,
      sortOrder: i,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...c,
    })) as MentorCategoryRecord[];
    d.meta = { ...(d.meta ?? {}), mentorCategoriesSeeded: true };
  });
}

beforeEach(async () => {
  await db.update((d) => {
    d.mentors = [];
    d.mentorCategories = [];
  });
});

describe('GET /api/mentors/directory', () => {
  it('returns 200 with no auth (works for unauthenticated requests)', async () => {
    await seedMentor();
    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory'));
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; total: number };
    expect(body.total).toBe(1);
  });

  it('resolves categoryIds to labels in the requested locale, active only', async () => {
    await seedCategories([
      { id: 'cat-0', active: true },
      { id: 'cat-1', active: false }, // deactivated — must be dropped
    ]);
    await seedMentor({ categoryIds: ['cat-0', 'cat-1'] });

    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory?locale=fr'));
    const body = await res.json() as { items: Array<{ categories: { id: string; label: string }[] }> };

    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.categories).toEqual([{ id: 'cat-0', label: 'Cat 0 FR' }]);
  });

  it('defaults to the app default locale when ?locale= is missing or invalid', async () => {
    await seedCategories([{ id: 'cat-0', active: true }]);
    await seedMentor({ categoryIds: ['cat-0'] });

    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory?locale=xx'));
    const body = await res.json() as { items: Array<{ categories: { label: string }[] }> };
    // defaultLocale is 'en' — falls back rather than 500ing on a bad param.
    expect(body.items[0]!.categories[0]!.label).toBe('Cat 0 EN');
  });

  it('filters by ?category= (comma-separated, OR semantics)', async () => {
    await seedCategories([{ id: 'cat-0', active: true }, { id: 'cat-1', active: true }]);
    await seedMentor({ id: 'm1', fullName: 'Has cat-0', categoryIds: ['cat-0'] });
    await seedMentor({ id: 'm2', fullName: 'Has cat-1', categoryIds: ['cat-1'] });
    await seedMentor({ id: 'm3', fullName: 'Has neither', categoryIds: [] });

    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory?category=cat-0'));
    const body = await res.json() as { items: Array<{ name: string }> };

    expect(body.items.map((i) => i.name)).toEqual(['Has cat-0']);
  });

  it('excludes unlisted mentors (self-signup, unpublished) — same gate as GET /api/mentors', async () => {
    await seedMentor({ id: 'm1', fullName: 'Listed' });
    await seedMentor({ id: 'm2', fullName: 'Unlisted self-signup', source: 'SELF', publiclyListed: false });

    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory'));
    const body = await res.json() as { items: Array<{ name: string }> };

    expect(body.items.map((i) => i.name)).toEqual(['Listed']);
  });

  it('shape includes price/currency/isPriced and photoUrl', async () => {
    await seedMentor({ consultationFee: 5000 });
    const { GET } = await import('@/app/api/mentors/directory/route');
    const res = await GET(new NextRequest('http://localhost/api/mentors/directory'));
    const body = await res.json() as { items: Array<Record<string, unknown>> };

    expect(body.items[0]).toMatchObject({
      id: 'm1',
      name: 'Amina Test',
      photoUrl: 'https://example.com/amina.jpg',
      shortBio: 'Growth Advisor',
      price: 5000,
      currency: 'DZD',
      isPriced: true,
    });
  });
});
