/**
 * Certificate settings for a program, and everything the renderer needs to
 * draw one — resolved in one place so the editor preview, and later the
 * issuing routes, can never disagree about what a certificate says.
 *
 * Ownership follows the registrations service: an incubator owns the programs
 * it created, a consultant the ones they created, and a program owned by one
 * is simply not found by the other.
 */
import { db, type ProgramRecord } from '@/server/db/store';
import type { OwnerScope } from '@/server/registrations/service';

import {
  DEFAULT_CERTIFICATE_SETTINGS,
  type CertificateContext,
  type CertificateSettings,
} from './types';

type StoreData = Awaited<ReturnType<typeof db.read>>;

export function programOwnedBy(
  program: Pick<ProgramRecord, 'incubatorId' | 'mentorId'>,
  owner: OwnerScope,
): boolean {
  return owner.kind === 'MENTOR'
    ? program.mentorId === owner.mentorId
    // A consultant-owned program must never match an incubator scope, even if
    // a stale incubatorId lingers on it.
    : !program.mentorId && program.incubatorId === owner.incubatorId;
}

export interface CertificateSetup {
  program: ProgramRecord;
  settings: CertificateSettings;
  /** False until the host saves — the editor says "not saved yet". */
  saved: boolean;
  context: CertificateContext;
  logoUrl: string | null;
  /** The organizer's stamp, when they have one — consultants have none. */
  stampUrl: string | null;
}

/**
 * Settings to offer a program that has none yet: the host's most recently
 * saved settings on another program, so signatures are not drawn again for
 * every training — otherwise the Metwork model.
 */
function inheritedSettings(d: StoreData, owner: OwnerScope, exceptId: string): CertificateSettings {
  const previous = (d.programs ?? [])
    .filter((p) => p.id !== exceptId && p.certificateSettings && programOwnedBy(p, owner))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return previous?.certificateSettings ?? DEFAULT_CERTIFICATE_SETTINGS;
}

export async function loadCertificateSetup(
  programId: string,
  owner: OwnerScope,
): Promise<CertificateSetup | null> {
  const d = await db.read();
  const program = (d.programs ?? []).find((p) => p.id === programId);
  if (!program || !programOwnedBy(program, owner)) return null;

  let organizer = program.incubatorName ?? '';
  let logoUrl: string | null = null;
  let stampUrl: string | null = null;

  if (owner.kind === 'MENTOR') {
    const mentor = (d.mentors ?? []).find((m) => m.id === owner.mentorId);
    organizer = mentor?.fullName ?? program.mentorName ?? organizer;
    // A consultant's photo is not a logo; the renderer prints their name
    // where a logo would go instead.
  } else {
    const incubator = (d.incubators ?? []).find((i) => i.id === owner.incubatorId);
    organizer = incubator?.name ?? organizer;
    logoUrl = incubator?.logoUrl ?? null;
    stampUrl = incubator?.stampUrl ?? null;
  }

  return {
    program,
    settings: program.certificateSettings ?? inheritedSettings(d, owner, program.id),
    saved: Boolean(program.certificateSettings),
    context: {
      programTitle: program.title,
      organizer,
      city: program.city ?? '',
      startDate: program.startDate,
      endDate: program.endDate,
    },
    logoUrl,
    stampUrl,
  };
}

export async function saveCertificateSettings(
  programId: string,
  owner: OwnerScope,
  settings: CertificateSettings,
): Promise<boolean> {
  return db.update((d) => {
    const program = (d.programs ?? []).find((p) => p.id === programId);
    if (!program || !programOwnedBy(program, owner)) return false;
    program.certificateSettings = settings;
    program.updatedAt = new Date().toISOString();
    return true;
  });
}

/**
 * A real name for the preview, so the host sees their layout with an actual
 * participant — the first confirmed one — rather than a placeholder that is
 * never as long as a real Algerian name.
 */
export async function previewName(programId: string): Promise<string> {
  const d = await db.read();
  const first = (d.registrations ?? []).find(
    (r) => r.entityType === 'PROGRAM' && r.entityId === programId && r.status === 'CONFIRMED',
  );
  return first?.fullName?.trim() || 'Prénom Nom';
}
