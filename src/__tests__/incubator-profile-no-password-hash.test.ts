/**
 * PATCH /api/incubator/profile echoes the manager's user record back — it
 * must never include the password hash.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'mgr-ph', email: 'ph@x.dz', role: 'INCUBATOR' } });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok) };
});

import { db } from '@/server/db/store';

const NOW = '2026-10-17T00:00:00.000Z';

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-ph', name: 'PH', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-ph', email: 'ph@x.dz',
        createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.users = d.users.filter((u) => u.id !== 'mgr-ph');
    d.users.push({
      id: 'mgr-ph', email: 'ph@x.dz', passwordHash: '$argon2id$secret-hash', fullName: 'Manager',
      phone: '+213550000000', city: 'Oran', role: 'INCUBATOR', status: 'ACTIVE',
      phoneVerified: true, emailVerified: true, membershipCode: null, avatarUrl: null,
      locale: 'fr', createdAt: NOW, updatedAt: NOW,
    } as never);
  });
});

describe('PATCH /api/incubator/profile', () => {
  it('returns the updated user without passwordHash', async () => {
    const { PATCH } = await import('@/app/api/incubator/profile/route');
    const res = await PATCH(new NextRequest('http://localhost/api/incubator/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Renamed Manager' }),
    }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('secret-hash');
    const body = JSON.parse(text);
    expect(body.user.fullName).toBe('Renamed Manager');
    expect(body.user.id).toBe('mgr-ph');
    // The stored hash itself is untouched.
    const stored = (await db.read()).users.find((u) => u.id === 'mgr-ph')!;
    expect(stored.passwordHash).toBe('$argon2id$secret-hash');
  });
});
