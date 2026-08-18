/**
 * Single source of truth for "who owns this program?" and "may this caller
 * see / edit / delete it?".
 *
 * A program is owned by EXACTLY ONE of two populations:
 *   - an incubator  (`incubatorId` → IncubatorRecord.managerId → session user)
 *   - a consultant  (`mentorId`    → MentorRecord.id → consultant portal session)
 *
 * These two populations authenticate through completely separate systems —
 * consultants have no `UserRecord` at all (see `@/server/mentors/access`) — so
 * every ownership check has to branch on which one owns the row. Centralised
 * here so the create/edit/delete routes, the public catalog, the form builder
 * and the registrations list can never drift apart on that branch.
 *
 * Visibility deliberately MIRRORS the mentor gate in `@/lib/mentor-approval`
 * rather than inventing a second model:
 *   - reachable by direct link  ⇔ owner is approved/active
 *   - shown on public LIST surfaces ⇔ owner is publicly listed
 * A self-signed-up consultant is reachable only via their direct link, so their
 * programs behave the same way.
 */
import type { IncubatorRecord, MentorRecord, ProgramRecord } from '@/server/db/store';
import { isPubliclyVisibleIncubator } from '@/server/incubator/visibility';
import { isMentorApproved, isMentorPubliclyListed } from '@/lib/mentor-approval';

/* ─────────────────────────── Owner resolution ─────────────────────────── */

export type ProgramOwner =
  | { kind: 'INCUBATOR'; incubatorId: string; mentorId: null }
  | { kind: 'MENTOR'; mentorId: string; incubatorId: null };

/** Minimal shape needed to resolve ownership — accepts records and DTOs alike. */
type ProgramOwnershipShape = Pick<ProgramRecord, 'incubatorId'> & {
  mentorId?: string | null;
};

/**
 * Resolve which population owns a program. `mentorId` wins when both are
 * somehow set, so a consultant row can never be authorized through the
 * incubator path. Returns null for an unowned/corrupt row (never authorize it).
 */
export function getProgramOwner(program: ProgramOwnershipShape): ProgramOwner | null {
  if (program.mentorId) {
    return { kind: 'MENTOR', mentorId: program.mentorId, incubatorId: null };
  }
  if (program.incubatorId) {
    return { kind: 'INCUBATOR', incubatorId: program.incubatorId, mentorId: null };
  }
  return null;
}

/** Whether this program belongs to a consultant rather than an incubator. */
export function isMentorOwnedProgram(program: ProgramOwnershipShape): boolean {
  return getProgramOwner(program)?.kind === 'MENTOR';
}

/* ─────────────────────────── Write authorization ─────────────────────────── */

/**
 * Identity of whoever is attempting a write. Built by the caller from whichever
 * guard already ran — `requireApprovedApiRole` (users) or `requireConsultant`
 * (consultants). Keeping both in one shape means routes express the rule once.
 */
export type ProgramActor =
  /** A platform user. `isAdmin` short-circuits the ownership check (see below). */
  | { kind: 'USER'; userId: string; isAdmin: boolean }
  | { kind: 'MENTOR'; mentorId: string };

export type ProgramWriteDecision = 'ALLOW' | 'FORBIDDEN' | 'NOT_FOUND';

/**
 * Whether `actor` may mutate `program`.
 *
 * Admins may DELETE any program regardless of owner (moderation backstop —
 * an incubator or consultant can publish something that has to come down),
 * which is why `isAdmin` bypasses the ownership branch. Admins do NOT get a
 * blanket edit bypass: `canEditProgram` passes `allowAdmin: false` so an admin
 * cannot silently rewrite someone else's listing content.
 */
function decideProgramWrite(
  program: ProgramOwnershipShape | null | undefined,
  actor: ProgramActor,
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'id' | 'managerId'>>,
  allowAdmin: boolean,
): ProgramWriteDecision {
  if (!program) return 'NOT_FOUND';
  if (allowAdmin && actor.kind === 'USER' && actor.isAdmin) return 'ALLOW';

  const owner = getProgramOwner(program);
  if (!owner) return 'FORBIDDEN';

  if (owner.kind === 'MENTOR') {
    // Consultant-owned: ONLY the owning consultant's portal session passes.
    // A platform user (any role) can never satisfy this branch.
    return actor.kind === 'MENTOR' && actor.mentorId === owner.mentorId
      ? 'ALLOW'
      : 'FORBIDDEN';
  }

  // Incubator-owned: the acting user must manage the owning incubator.
  if (actor.kind !== 'USER') return 'FORBIDDEN';
  const incubator = incubators.find((i) => i.id === owner.incubatorId);
  return incubator && incubator.managerId === actor.userId ? 'ALLOW' : 'FORBIDDEN';
}

/** Edit authorization — no admin bypass (admins can't rewrite others' listings). */
export function canEditProgram(
  program: ProgramOwnershipShape | null | undefined,
  actor: ProgramActor,
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'id' | 'managerId'>>,
): ProgramWriteDecision {
  return decideProgramWrite(program, actor, incubators, false);
}

/** Delete authorization — admins may remove any program (moderation backstop). */
export function canDeleteProgram(
  program: ProgramOwnershipShape | null | undefined,
  actor: ProgramActor,
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'id' | 'managerId'>>,
): ProgramWriteDecision {
  return decideProgramWrite(program, actor, incubators, true);
}

/* ─────────────────────────── Public visibility ─────────────────────────── */

type OwnerLookups = {
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'id' | 'status' | 'archivedAt'>>;
  mentors: ReadonlyArray<
    Pick<MentorRecord, 'id' | 'approvalStatus' | 'source' | 'publiclyListed'>
  >;
};

/**
 * Reachable via its direct `/programs/[slug]` link.
 * Requires the program to be published (`isActive`) AND its owner to be in
 * good standing (incubator ACTIVE + not archived, or consultant APPROVED).
 */
export function isProgramPubliclyReachable(
  program: ProgramOwnershipShape & Pick<ProgramRecord, 'isActive'>,
  lookups: OwnerLookups,
): boolean {
  if (!program.isActive) return false;
  const owner = getProgramOwner(program);
  if (!owner) return false;

  if (owner.kind === 'MENTOR') {
    const mentor = lookups.mentors.find((m) => m.id === owner.mentorId);
    return !!mentor && isMentorApproved(mentor);
  }
  const inc = lookups.incubators.find((i) => i.id === owner.incubatorId);
  return isPubliclyVisibleIncubator(inc);
}

/**
 * Shown on public LIST surfaces (the /programs explorer). Stricter than
 * `isProgramPubliclyReachable` for consultant-owned programs: a self-signed-up
 * consultant is not on public list surfaces unless an admin published them, so
 * neither are their programs. Incubator-owned programs are unaffected —
 * for them the two predicates are identical.
 */
export function isProgramPubliclyListed(
  program: ProgramOwnershipShape & Pick<ProgramRecord, 'isActive'>,
  lookups: OwnerLookups,
): boolean {
  if (!isProgramPubliclyReachable(program, lookups)) return false;
  const owner = getProgramOwner(program);
  if (owner?.kind !== 'MENTOR') return true;
  const mentor = lookups.mentors.find((m) => m.id === owner.mentorId);
  return !!mentor && isMentorPubliclyListed(mentor);
}

/**
 * Public host/branding name for a program, resolved from whichever population
 * owns it. Falls back to the denormalized snapshot on the record so a deleted
 * owner never renders an empty host label.
 */
export function programHostName(
  program: ProgramOwnershipShape &
    Pick<ProgramRecord, 'incubatorName'> & { mentorName?: string | null },
): string {
  return isMentorOwnedProgram(program)
    ? program.mentorName?.trim() || 'Metwork'
    : program.incubatorName?.trim() || 'Metwork';
}
