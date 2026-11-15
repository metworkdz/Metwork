/**
 * Saving a "File upload" question from the form builder.
 *
 * The builder (one component, two surfaces) posts the same payload to the
 * incubator route and the consultant route. A FILE question has no options and
 * nothing to configure; what must hold is that both routes accept it, on both a
 * program and an event, that it round-trips with its required flag, and that
 * each owner can only put it on their own listing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

const INC = 'inc-ff';
const INC_USER = { id: 'u-inc', email: 'inc@ff.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' };
const MENTOR = 'mentor-ff';
const EVENT = '11111111-1111-4111-8111-111111111111';
const INC_PROGRAM = '22222222-2222-4222-8222-222222222222';
const MENTOR_PROGRAM = '33333333-3333-4333-8333-333333333333';
const FOREIGN_EVENT = '44444444-4444-4444-8444-444444444444';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: INC_USER });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok), requireApiSession: vi.fn(ok) };
});
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'mentor-ff' })),
}));

import { POST as incubatorSave } from '@/app/api/incubator/registration-form/route';
import { POST as consultantSave } from '@/app/api/consultant/registration-form/route';
import { listFormFields } from '@/server/registrations/service';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [{ id: INC, managerId: INC_USER.id, name: 'Hub', status: 'ACTIVE', email: INC_USER.email } as never];
    d.users = [];
    d.registrationFormFields = [];
    d.events = [
      { id: EVENT, incubatorId: INC, title: 'Demo Day', isActive: true },
      { id: FOREIGN_EVENT, incubatorId: 'someone-else', title: 'Other', isActive: true },
    ] as never;
    d.programs = [
      { id: INC_PROGRAM, incubatorId: INC, mentorId: null, title: 'P1', isActive: true, createdAt: NOW, updatedAt: NOW },
      { id: MENTOR_PROGRAM, incubatorId: null, mentorId: MENTOR, title: 'P2', isActive: true, createdAt: NOW, updatedAt: NOW },
    ] as never;
  });
});

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Exactly what the builder sends for a FILE row: no options, no keys.
const fileRow = (over: Record<string, unknown> = {}) => ({
  label: 'Upload your pitch deck', labelKey: null, type: 'FILE', options: null, optionKeys: null,
  required: true, order: 1, showWhen: null, ...over,
});
const textRow = { label: 'Startup name', labelKey: null, type: 'SHORT_TEXT', options: null, optionKeys: null, required: true, order: 0, showWhen: null };

describe('form builder — File upload question', () => {
  it('saves on an event, in order, with its required flag and no options', async () => {
    const res = await incubatorSave(post('/api/incubator/registration-form', {
      entityType: 'EVENT', entityId: EVENT, fields: [textRow, fileRow()],
    }));
    expect(res.status).toBe(200);

    const saved = await listFormFields('EVENT', EVENT);
    expect(saved.map((f) => [f.label, f.type, f.required, f.options])).toEqual([
      ['Startup name', 'SHORT_TEXT', true, null],
      ['Upload your pitch deck', 'FILE', true, null],
    ]);
  });

  it('saves on an incubator program', async () => {
    const res = await incubatorSave(post('/api/incubator/registration-form', {
      entityType: 'PROGRAM', entityId: INC_PROGRAM, fields: [fileRow({ required: false })],
    }));
    expect(res.status).toBe(200);
    expect((await listFormFields('PROGRAM', INC_PROGRAM))[0]).toMatchObject({ type: 'FILE', required: false });
  });

  it('saves on a consultant program through the consultant route', async () => {
    const res = await consultantSave(post('/api/consultant/registration-form', {
      entityId: MENTOR_PROGRAM, fields: [fileRow()],
    }));
    expect(res.status).toBe(200);
    const [f] = await listFormFields('PROGRAM', MENTOR_PROGRAM);
    expect(f).toMatchObject({ type: 'FILE', required: true });
    // Owned by the consultant, so only they (not an incubator) can open its files later.
    const stored = (await db.read()).registrationFormFields[0]!;
    expect(stored.mentorId).toBe(MENTOR);
    expect(stored.incubatorId).toBeNull();
  });

  it("refuses to put a file question on another incubator's event", async () => {
    const res = await incubatorSave(post('/api/incubator/registration-form', {
      entityType: 'EVENT', entityId: FOREIGN_EVENT, fields: [fileRow()],
    }));
    expect(res.status).toBe(403);
    expect((await db.read()).registrationFormFields).toHaveLength(0);
  });

  it("refuses a consultant putting one on an incubator's program", async () => {
    const res = await consultantSave(post('/api/consultant/registration-form', {
      entityId: INC_PROGRAM, fields: [fileRow()],
    }));
    expect(res.status).toBe(403);
  });

  it('rejects an unknown question type', async () => {
    const res = await incubatorSave(post('/api/incubator/registration-form', {
      entityType: 'EVENT', entityId: EVENT, fields: [fileRow({ type: 'VIDEO' })],
    }));
    expect(res.status).toBe(422);
  });
});
