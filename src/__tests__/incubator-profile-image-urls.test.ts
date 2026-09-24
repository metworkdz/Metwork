/**
 * The incubator profile refuses a logo or stamp the PDF fetcher would refuse.
 *
 * Those two URLs are fetched server-side for every invoice, receipt and
 * contract. Accepting any `.url()` let a host point the server at an internal
 * address; refusing it only at render time would silently drop the image from
 * every document. So the save itself is refused, with a French message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' } });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok) };
});

import { db } from '@/server/db/store';

const OURS = 'dguqgjkuh';
const LOGO = `https://res.cloudinary.com/${OURS}/image/upload/v1/metwork/spaces/logo.png`;
const NOW = '2026-09-01T00:00:00.000Z';

const patch = async (body: Record<string, unknown>) => {
  const { PATCH } = await import('@/app/api/incubator/profile/route');
  return PATCH(new NextRequest('http://localhost/api/incubator/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
};

beforeEach(async () => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-a', name: 'A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz',
        logoUrl: LOGO, stampUrl: null, createdAt: NOW, updatedAt: NOW } as never,
    ];
  });
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('logo and stamp URLs', () => {
  it.each([
    ['logoUrl', 'http://169.254.169.254/latest/meta-data/'],
    ['logoUrl', 'https://attacker.test/logo.png'],
    ['stampUrl', 'https://res.cloudinary.com/someone-else/image/upload/stamp.png'],
    ['stampUrl', `http://res.cloudinary.com/${OURS}/image/upload/stamp.png`],
  ])('refuses %s = %s, in French, and stores nothing', async (field, url) => {
    const res = await patch({ [field]: url });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fieldErrors[field][0]).toMatch(/^Image refusée/);

    const inc = (await db.read()).incubators[0]!;
    expect(inc.logoUrl).toBe(LOGO);
    expect(inc.stampUrl).toBeNull();
  });

  it('accepts an image on our Cloudinary account', async () => {
    const stamp = LOGO.replace('logo', 'stamp');
    const res = await patch({ stampUrl: stamp });
    expect(res.status).toBe(200);
    expect((await db.read()).incubators[0]!.stampUrl).toBe(stamp);
  });

  it('still lets a host clear the image', async () => {
    const res = await patch({ logoUrl: null });
    expect(res.status).toBe(200);
    expect((await db.read()).incubators[0]!.logoUrl).toBeNull();
  });
});
