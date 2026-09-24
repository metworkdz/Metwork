/**
 * Issuing a program's participation certificates.
 *
 * Who gets one: every CONFIRMED participant of the program, unless the host
 * unticked them as absent. Nobody has to be ticked in — attendance is assumed,
 * because hosts forget to tick and nobody forgets someone who never came.
 *
 * A certificate is ISSUED the first time it is printed or sent. From then on
 * its number is frozen: reprinting, correcting the name, or sending it again
 * keeps the same number, so a paper already handed over never disagrees with
 * the record behind its QR code. Marking the participant absent afterwards
 * revokes it; ticking them back restores it, number unchanged.
 *
 * An unpaid balance does not block anything — the host decides — but every
 * participant row says how much is still owed, so nobody is surprised.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import {
  db,
  type CertificateRecord,
  type ProgramRecord,
  type RegistrationRecord,
} from '@/server/db/store';
import type { OwnerScope } from '@/server/registrations/service';

import { renderCertificatesPdf, type CertificateImages } from './render';
import { loadCertificateSetup, programOwnedBy, type CertificateSetup } from './service';
import type { CertificateMode, CertificateRecipient, Civility } from './types';

type StoreData = Awaited<ReturnType<typeof db.read>>;

/** Never more in one PDF or one request — a program is not a stadium. */
export const MAX_CERTIFICATES_PER_BATCH = 300;

export interface CertificateParticipant {
  registrationId: string;
  fullName: string;
  email: string;
  civility: Civility;
  absent: boolean;
  /** Cash still to collect on this participant's booking, integer DZD. */
  balanceDue: number;
  certificate: {
    number: string;
    issuedAt: string;
    emailedAt: string | null;
    revoked: boolean;
  } | null;
}

/** Where the QR code points. Unprefixed: the site picks the reader's language. */
export function certificateVerifyUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
  return `${base}/attestation/${token}`;
}

function ownerOf(program: Pick<ProgramRecord, 'incubatorId' | 'mentorId'>) {
  return program.mentorId
    ? { incubatorId: null, mentorId: program.mentorId }
    : { incubatorId: program.incubatorId ?? null, mentorId: null };
}

function sameOwner(c: CertificateRecord, owner: { incubatorId: string | null; mentorId: string | null }) {
  return owner.mentorId ? c.mentorId === owner.mentorId : !c.mentorId && c.incubatorId === owner.incubatorId;
}

/** The program's confirmed participants — the only people a certificate can name. */
function confirmedParticipants(d: StoreData, programId: string): RegistrationRecord[] {
  return (d.registrations ?? []).filter(
    (r) => r.entityType === 'PROGRAM' && r.entityId === programId && r.status === 'CONFIRMED',
  );
}

function balanceDue(d: StoreData, reg: RegistrationRecord): number {
  if (!reg.bookingId) return 0;
  const booking = (d.bookings ?? []).find((b) => b.id === reg.bookingId);
  if (!booking || booking.paymentStatus !== 'AWAITING_CASH') return 0;
  return Math.max(0, booking.cashRemainingAmount ?? 0);
}

function byName(a: { fullName: string }, b: { fullName: string }) {
  return a.fullName.localeCompare(b.fullName, 'fr', { sensitivity: 'base' });
}

function toParticipant(d: StoreData, reg: RegistrationRecord): CertificateParticipant {
  const cert = (d.certificates ?? []).find((c) => c.registrationId === reg.id);
  return {
    registrationId: reg.id,
    fullName: reg.fullName,
    email: reg.email,
    civility: reg.civility ?? null,
    absent: Boolean(reg.absent),
    balanceDue: balanceDue(d, reg),
    certificate: cert
      ? {
          number: cert.number,
          issuedAt: cert.issuedAt,
          emailedAt: cert.emailedAt ?? null,
          revoked: Boolean(cert.revokedAt),
        }
      : null,
  };
}

export async function listCertificateParticipants(
  programId: string,
  owner: OwnerScope,
): Promise<{ participants: CertificateParticipant[]; saved: boolean } | null> {
  const d = await db.read();
  const program = (d.programs ?? []).find((p) => p.id === programId);
  if (!program || !programOwnedBy(program, owner)) return null;
  return {
    participants: confirmedParticipants(d, programId).sort(byName).map((r) => toParticipant(d, r)),
    // Nothing can be issued before the host has saved a design.
    saved: Boolean(program.certificateSettings),
  };
}

export interface ParticipantPatch {
  absent?: boolean;
  civility?: Civility;
}

/**
 * Tick or untick one participant, or set their civility. Unticking revokes an
 * already-issued certificate; ticking back restores it.
 */
export async function updateCertificateParticipant(
  programId: string,
  owner: OwnerScope,
  registrationId: string,
  patch: ParticipantPatch,
): Promise<CertificateParticipant | null> {
  return db.update((d) => {
    const program = (d.programs ?? []).find((p) => p.id === programId);
    if (!program || !programOwnedBy(program, owner)) return null;
    const reg = confirmedParticipants(d, programId).find((r) => r.id === registrationId);
    if (!reg) return null;

    const now = new Date().toISOString();
    if (patch.absent !== undefined) reg.absent = patch.absent;
    if (patch.civility !== undefined) reg.civility = patch.civility;
    reg.updatedAt = now;

    const cert = (d.certificates ?? []).find((c) => c.registrationId === reg.id);
    if (cert && patch.absent !== undefined) {
      cert.revokedAt = patch.absent ? (cert.revokedAt ?? now) : null;
      cert.updatedAt = now;
    }
    return toParticipant(d, reg);
  });
}

/** The next number in this organizer's sequence for the year of issue. */
function nextNumber(d: StoreData, owner: { incubatorId: string | null; mentorId: string | null }, year: number): string {
  const prefix = `ATT-${year}-`;
  let max = 0;
  for (const c of d.certificates ?? []) {
    if (!c.number.startsWith(prefix) || !sameOwner(c, owner)) continue;
    const n = Number(c.number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export interface IssuedCertificate {
  registration: RegistrationRecord;
  certificate: CertificateRecord;
}

export type IssueResult =
  | { ok: true; setup: CertificateSetup; issued: IssuedCertificate[] }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_SAVED' | 'NONE' | 'TOO_MANY' };

/**
 * Issue (or re-issue) the certificates of the given participants — all
 * present participants when `registrationIds` is omitted. Absent or
 * unconfirmed participants are skipped, never issued, whatever the caller
 * sends. Returns them sorted by name, the order they print in.
 */
export async function issueCertificates(
  programId: string,
  owner: OwnerScope,
  registrationIds?: string[],
): Promise<IssueResult> {
  const setup = await loadCertificateSetup(programId, owner);
  if (!setup) return { ok: false, reason: 'NOT_FOUND' };
  // Issuing freezes a number against a design; the host has to have chosen it.
  if (!setup.saved) return { ok: false, reason: 'NOT_SAVED' };

  const wanted = registrationIds ? new Set(registrationIds) : null;
  if (wanted && wanted.size > MAX_CERTIFICATES_PER_BATCH) return { ok: false, reason: 'TOO_MANY' };

  const issued = await db.update<IssuedCertificate[] | 'NOT_FOUND' | 'TOO_MANY'>((d) => {
    const program = (d.programs ?? []).find((p) => p.id === programId);
    if (!program || !programOwnedBy(program, owner)) return 'NOT_FOUND';

    const regs = confirmedParticipants(d, programId)
      .filter((r) => !r.absent && (!wanted || wanted.has(r.id)))
      .sort(byName);
    // Checked before a single number is handed out, so a refused batch
    // leaves nothing half-issued behind it.
    if (regs.length > MAX_CERTIFICATES_PER_BATCH) return 'TOO_MANY';
    if (!d.certificates) d.certificates = [];

    const ownerIds = ownerOf(program);
    const now = new Date();
    const nowIso = now.toISOString();
    const out: IssuedCertificate[] = [];

    for (const reg of regs) {
      let cert = d.certificates.find((c) => c.registrationId === reg.id);
      const snapshot = {
        fullName: reg.fullName,
        civility: reg.civility ?? null,
        programTitle: setup.context.programTitle,
        organizer: setup.context.organizer,
        startDate: setup.context.startDate,
        endDate: setup.context.endDate,
      };
      if (!cert) {
        cert = {
          id: randomUUID(),
          number: nextNumber(d, ownerIds, now.getFullYear()),
          verifyToken: randomBytes(15).toString('base64url'),
          programId,
          registrationId: reg.id,
          ...ownerIds,
          ...snapshot,
          issuedAt: nowIso,
          updatedAt: nowIso,
          emailedAt: null,
          revokedAt: null,
        };
        d.certificates.push(cert);
      } else {
        Object.assign(cert, snapshot, { revokedAt: null, updatedAt: nowIso });
      }
      out.push({ registration: { ...reg }, certificate: { ...cert } });
    }
    return out;
  });

  if (issued === 'NOT_FOUND' || issued === 'TOO_MANY') return { ok: false, reason: issued };
  if (issued.length === 0) return { ok: false, reason: 'NONE' };
  return { ok: true, setup, issued };
}

export function recipientFor(item: IssuedCertificate): CertificateRecipient {
  return {
    fullName: item.certificate.fullName,
    civility: item.certificate.civility ?? null,
    number: item.certificate.number,
    verifyUrl: certificateVerifyUrl(item.certificate.verifyToken),
  };
}

/** One PDF, one page per certificate, in the order given. */
export function renderIssuedCertificates(
  setup: CertificateSetup,
  items: IssuedCertificate[],
  mode: CertificateMode,
  images?: CertificateImages,
): Promise<Buffer> {
  return renderCertificatesPdf({
    settings: setup.settings,
    context: setup.context,
    recipients: items.map(recipientFor),
    mode,
    logoUrl: setup.logoUrl,
    stampUrl: setup.stampUrl,
    images,
  });
}

/** "Attestation - Djihene Amara.pdf" — safe in a Content-Disposition header. */
export function certificateFilename(label: string): string {
  const ascii = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    // An all-Arabic name leaves "Attestation -" behind; drop the dangling dash.
    .replace(/[\s-]+$/, '');
  return `${ascii || 'attestation'}.pdf`;
}

/* ─────────────────────────── Public verification ─────────────────────────── */

export type CertificateVerification =
  | {
      status: 'VALID' | 'REVOKED';
      number: string;
      fullName: string;
      civility: Civility;
      programTitle: string;
      organizer: string;
      startDate: string;
      endDate: string;
      issuedAt: string;
    }
  | { status: 'NOT_FOUND' };

/**
 * What the QR code on a certificate answers. Validity is decided live: a
 * certificate whose participant was later cancelled, or marked absent, no
 * longer verifies — whatever the paper says.
 */
export async function verifyCertificate(token: string): Promise<CertificateVerification> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return { status: 'NOT_FOUND' };
  const d = await db.read();
  const cert = (d.certificates ?? []).find((c) => c.verifyToken === token);
  if (!cert) return { status: 'NOT_FOUND' };

  const reg = (d.registrations ?? []).find((r) => r.id === cert.registrationId);
  const valid = !cert.revokedAt && reg?.status === 'CONFIRMED' && !reg.absent;
  return {
    status: valid ? 'VALID' : 'REVOKED',
    number: cert.number,
    fullName: cert.fullName,
    civility: cert.civility ?? null,
    programTitle: cert.programTitle,
    organizer: cert.organizer,
    startDate: cert.startDate,
    endDate: cert.endDate,
    issuedAt: cert.issuedAt,
  };
}
