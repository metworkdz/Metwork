/**
 * Owner-scoped registration service — one implementation, two populations.
 *
 * The form builder and registrant list are shared between incubators and
 * consultants (no fork), so the scope argument IS the security boundary. These
 * tests assert it holds in both directions through the real service.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type ProgramRecord } from '@/server/db/store';
import {
  replaceFormFields,
  listFormFields,
  deleteFormField,
  listRegistrations,
  cancelRegistration,
  createRegistration,
  buildRegistrationsCsv,
  incubatorScope,
  mentorScope,
} from '@/server/registrations/service';

const INC = 'inc-scope-1';
const MENTOR = 'mentor-scope-1';
const INC_PROGRAM = '11111111-1111-4111-8111-111111111111';
const MENTOR_PROGRAM = '22222222-2222-4222-8222-222222222222';

function program(id: string, owner: 'INC' | 'MENTOR'): ProgramRecord {
  const now = new Date().toISOString();
  return {
    id,
    incubatorId: owner === 'INC' ? INC : null,
    incubatorName: owner === 'INC' ? 'Hub' : '',
    mentorId: owner === 'MENTOR' ? MENTOR : null,
    mentorName: owner === 'MENTOR' ? 'Amina B.' : null,
    title: `Program ${id.slice(0, 4)}`,
    description: 'x'.repeat(20),
    type: 'WORKSHOP',
    city: 'Alger',
    imageUrl: null,
    price: 0,
    seatsTotal: 10,
    deadline: new Date(Date.now() + 864e5).toISOString(),
    startDate: new Date(Date.now() + 1728e5).toISOString(),
    endDate: new Date(Date.now() + 2592e5).toISOString(),
    acceptedPaymentMethods: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(async () => {
  await db.update((d) => {
    d.programs = [program(INC_PROGRAM, 'INC'), program(MENTOR_PROGRAM, 'MENTOR')];
    d.registrationFormFields = [];
    d.registrations = [];
    d.clients = [];
    d.incubators = [
      { id: INC, managerId: 'user-1', name: 'Hub', status: 'ACTIVE', archivedAt: null } as never,
    ];
    d.mentors = [
      { id: MENTOR, fullName: 'Amina B.', approvalStatus: 'APPROVED', source: 'SELF' } as never,
    ];
  });
});

const FIELD = [{ label: 'Company', type: 'SHORT_TEXT' as const, options: null, required: false, order: 0 }];

describe('form fields are stamped with the acting owner', () => {
  it('a consultant-owned field carries mentorId and no incubatorId', async () => {
    const [f] = await replaceFormFields('PROGRAM', MENTOR_PROGRAM, mentorScope(MENTOR), FIELD);
    expect(f!.mentorId).toBe(MENTOR);
    expect(f!.incubatorId).toBeNull();
  });

  it('an incubator-owned field carries incubatorId and no mentorId', async () => {
    const [f] = await replaceFormFields('PROGRAM', INC_PROGRAM, incubatorScope(INC), FIELD);
    expect(f!.incubatorId).toBe(INC);
    expect(f!.mentorId).toBeNull();
  });
});

describe('cross-population isolation on delete', () => {
  it('an incubator cannot delete a consultant-owned field', async () => {
    const [f] = await replaceFormFields('PROGRAM', MENTOR_PROGRAM, mentorScope(MENTOR), FIELD);
    expect(await deleteFormField(f!.id, incubatorScope(INC))).toBe(false);
    expect(await listFormFields('PROGRAM', MENTOR_PROGRAM)).toHaveLength(1);
  });

  it('a consultant cannot delete an incubator-owned field', async () => {
    const [f] = await replaceFormFields('PROGRAM', INC_PROGRAM, incubatorScope(INC), FIELD);
    expect(await deleteFormField(f!.id, mentorScope(MENTOR))).toBe(false);
  });

  it('each owner can delete its own', async () => {
    const [f] = await replaceFormFields('PROGRAM', MENTOR_PROGRAM, mentorScope(MENTOR), FIELD);
    expect(await deleteFormField(f!.id, mentorScope(MENTOR))).toBe(true);
  });
});

describe('registrations are scoped by the program owner', () => {
  async function register(entityId: string, email: string) {
    return createRegistration({
      entityType: 'PROGRAM', entityId, userId: null,
      fullName: 'Reg Person', email, phone: '+213555000111', answers: [],
    });
  }

  it('a consultant program registration is stamped to the consultant', async () => {
    const { registration } = await register(MENTOR_PROGRAM, 'a@test.dz');
    expect(registration.mentorId).toBe(MENTOR);
    expect(registration.incubatorId).toBeNull();
  });

  it('each owner sees only its own registrants', async () => {
    await register(MENTOR_PROGRAM, 'a@test.dz');
    await register(INC_PROGRAM, 'b@test.dz');

    const mine = await listRegistrations('PROGRAM', MENTOR_PROGRAM, mentorScope(MENTOR));
    expect(mine.map((r) => r.email)).toEqual(['a@test.dz']);

    // The incubator scope must not reach the consultant's program.
    expect(await listRegistrations('PROGRAM', MENTOR_PROGRAM, incubatorScope(INC))).toHaveLength(0);
    expect(await listRegistrations('PROGRAM', INC_PROGRAM, incubatorScope(INC))).toHaveLength(1);
  });

  it('an incubator cannot cancel a consultant program registration', async () => {
    const { registration } = await register(MENTOR_PROGRAM, 'a@test.dz');
    expect(await cancelRegistration(registration.id, incubatorScope(INC))).toBeNull();
    expect(await cancelRegistration(registration.id, mentorScope(MENTOR))).not.toBeNull();
  });

  it('CSV export is scoped too', async () => {
    await register(MENTOR_PROGRAM, 'a@test.dz');
    const mine = await buildRegistrationsCsv('PROGRAM', MENTOR_PROGRAM, mentorScope(MENTOR));
    expect(mine).toContain('a@test.dz');
    const theirs = await buildRegistrationsCsv('PROGRAM', MENTOR_PROGRAM, incubatorScope(INC));
    expect(theirs).not.toContain('a@test.dz');
  });

  it('does not create a CRM client for a consultant program (incubator-side concept)', async () => {
    await register(MENTOR_PROGRAM, 'a@test.dz');
    const data = await db.read();
    expect(data.clients ?? []).toHaveLength(0);

    await register(INC_PROGRAM, 'b@test.dz');
    const after = await db.read();
    expect((after.clients ?? []).map((c) => c.email)).toEqual(['b@test.dz']);
  });
});
