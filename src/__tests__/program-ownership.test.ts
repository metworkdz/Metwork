/**
 * Canonical program-ownership gate — consultant-owned vs incubator-owned.
 *
 * The two owning populations authenticate through completely separate systems
 * (consultants have no `UserRecord`), so these branches are the security
 * boundary for every program write. Pure module — no store mocking needed.
 */
import { describe, it, expect } from 'vitest';
import {
  getProgramOwner,
  isMentorOwnedProgram,
  canEditProgram,
  canDeleteProgram,
  isProgramPubliclyReachable,
  isProgramPubliclyListed,
  programHostName,
  type ProgramActor,
} from '@/server/programs/ownership';

const INCUBATORS = [
  { id: 'inc-1', managerId: 'user-1', status: 'ACTIVE' as const, archivedAt: null },
  { id: 'inc-2', managerId: 'user-2', status: 'ACTIVE' as const, archivedAt: null },
];

const incProgram = { incubatorId: 'inc-1', mentorId: null, isActive: true, incubatorName: 'Hub One' };
const mentorProgram = { incubatorId: null, mentorId: 'mentor-1', isActive: true, incubatorName: '', mentorName: 'Amina B.' };

const owningUser: ProgramActor = { kind: 'USER', userId: 'user-1', isAdmin: false };
const otherUser: ProgramActor = { kind: 'USER', userId: 'user-2', isAdmin: false };
const admin: ProgramActor = { kind: 'USER', userId: 'admin-1', isAdmin: true };
const owningMentor: ProgramActor = { kind: 'MENTOR', mentorId: 'mentor-1' };
const otherMentor: ProgramActor = { kind: 'MENTOR', mentorId: 'mentor-2' };

describe('owner resolution', () => {
  it('resolves each population', () => {
    expect(getProgramOwner(incProgram)).toEqual({ kind: 'INCUBATOR', incubatorId: 'inc-1', mentorId: null });
    expect(getProgramOwner(mentorProgram)).toEqual({ kind: 'MENTOR', mentorId: 'mentor-1', incubatorId: null });
    expect(isMentorOwnedProgram(mentorProgram)).toBe(true);
    expect(isMentorOwnedProgram(incProgram)).toBe(false);
  });

  it('never authorizes an unowned row', () => {
    const orphan = { incubatorId: null, mentorId: null };
    expect(getProgramOwner(orphan)).toBeNull();
    expect(canEditProgram(orphan, owningUser, INCUBATORS)).toBe('FORBIDDEN');
    expect(canDeleteProgram(orphan, owningMentor, INCUBATORS)).toBe('FORBIDDEN');
  });

  it('prefers mentorId so a consultant row can never take the incubator path', () => {
    const both = { incubatorId: 'inc-1', mentorId: 'mentor-1' };
    expect(getProgramOwner(both)?.kind).toBe('MENTOR');
    // user-1 manages inc-1, but the row is consultant-owned → still denied.
    expect(canEditProgram(both, owningUser, INCUBATORS)).toBe('FORBIDDEN');
  });
});

describe('cross-population isolation', () => {
  it('a consultant cannot touch an incubator program', () => {
    expect(canEditProgram(incProgram, owningMentor, INCUBATORS)).toBe('FORBIDDEN');
    expect(canDeleteProgram(incProgram, owningMentor, INCUBATORS)).toBe('FORBIDDEN');
  });

  it('a platform user cannot touch a consultant program', () => {
    expect(canEditProgram(mentorProgram, owningUser, INCUBATORS)).toBe('FORBIDDEN');
    expect(canEditProgram(mentorProgram, otherUser, INCUBATORS)).toBe('FORBIDDEN');
  });

  it('each owner may edit only its own', () => {
    expect(canEditProgram(incProgram, owningUser, INCUBATORS)).toBe('ALLOW');
    expect(canEditProgram(incProgram, otherUser, INCUBATORS)).toBe('FORBIDDEN');
    expect(canEditProgram(mentorProgram, owningMentor, INCUBATORS)).toBe('ALLOW');
    expect(canEditProgram(mentorProgram, otherMentor, INCUBATORS)).toBe('FORBIDDEN');
  });
});

describe('admin moderation backstop', () => {
  it('may DELETE either population', () => {
    expect(canDeleteProgram(incProgram, admin, INCUBATORS)).toBe('ALLOW');
    expect(canDeleteProgram(mentorProgram, admin, INCUBATORS)).toBe('ALLOW');
  });

  it('may NOT edit a program it does not own', () => {
    expect(canEditProgram(incProgram, admin, INCUBATORS)).toBe('FORBIDDEN');
    expect(canEditProgram(mentorProgram, admin, INCUBATORS)).toBe('FORBIDDEN');
  });

  it('reports NOT_FOUND for a missing program before any ownership check', () => {
    expect(canDeleteProgram(null, admin, INCUBATORS)).toBe('NOT_FOUND');
    expect(canEditProgram(undefined, owningUser, INCUBATORS)).toBe('NOT_FOUND');
  });
});

describe('public visibility mirrors the mentor gate', () => {
  const lookups = {
    incubators: INCUBATORS,
    mentors: [
      // Self-signup, approved, NOT published → direct link only.
      { id: 'mentor-1', approvalStatus: 'APPROVED' as const, source: 'SELF' as const, publiclyListed: false },
      // Self-signup, approved, admin-published → also on list surfaces.
      { id: 'mentor-2', approvalStatus: 'APPROVED' as const, source: 'SELF' as const, publiclyListed: true },
      // Pending → hidden everywhere.
      { id: 'mentor-3', approvalStatus: 'PENDING' as const, source: 'SELF' as const, publiclyListed: false },
    ],
  };

  it('an approved-but-unlisted consultant is reachable by link, not listed', () => {
    const p = { incubatorId: null, mentorId: 'mentor-1', isActive: true };
    expect(isProgramPubliclyReachable(p, lookups)).toBe(true);
    expect(isProgramPubliclyListed(p, lookups)).toBe(false);
  });

  it('an admin-published consultant is listed too', () => {
    const p = { incubatorId: null, mentorId: 'mentor-2', isActive: true };
    expect(isProgramPubliclyListed(p, lookups)).toBe(true);
  });

  it('a pending consultant is hidden entirely', () => {
    const p = { incubatorId: null, mentorId: 'mentor-3', isActive: true };
    expect(isProgramPubliclyReachable(p, lookups)).toBe(false);
    expect(isProgramPubliclyListed(p, lookups)).toBe(false);
  });

  it('unpublished (isActive false) is hidden regardless of owner', () => {
    expect(isProgramPubliclyReachable({ ...incProgram, isActive: false }, lookups)).toBe(false);
    expect(isProgramPubliclyReachable({ incubatorId: null, mentorId: 'mentor-2', isActive: false }, lookups)).toBe(false);
  });

  it('incubator programs are unaffected — both predicates agree', () => {
    expect(isProgramPubliclyReachable(incProgram, lookups)).toBe(true);
    expect(isProgramPubliclyListed(incProgram, lookups)).toBe(true);
  });

  it('an archived incubator hides its programs', () => {
    const archived = { incubators: [{ id: 'inc-9', managerId: 'u', status: 'ACTIVE' as const, archivedAt: '2026-01-01' }], mentors: [] };
    expect(isProgramPubliclyReachable({ incubatorId: 'inc-9', mentorId: null, isActive: true }, archived)).toBe(false);
  });
});

describe('host name resolution', () => {
  it('picks the owning population name', () => {
    expect(programHostName(incProgram)).toBe('Hub One');
    expect(programHostName(mentorProgram)).toBe('Amina B.');
  });

  it('falls back rather than rendering an empty host', () => {
    expect(programHostName({ incubatorId: 'inc-1', mentorId: null, incubatorName: '' })).toBe('Metwork');
    expect(programHostName({ incubatorId: null, mentorId: 'm', incubatorName: '', mentorName: null })).toBe('Metwork');
  });
});
