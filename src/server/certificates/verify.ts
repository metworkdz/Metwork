/**
 * What the QR code on a certificate answers — kept apart from issuing on
 * purpose: the public verification page imports only this, not the PDF
 * renderer, pdfkit and the certificate fonts it would otherwise drag into its
 * bundle to look up one record.
 */
import { db } from '@/server/db/store';

import type { Civility } from './types';

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
  if (!cert) {
    // Startup Academy certificates share the page and the token format.
    const aca = (d.academyCertificates ?? []).find((c) => c.verifyToken === token);
    if (!aca) return { status: 'NOT_FOUND' };
    return {
      status: aca.revokedAt ? 'REVOKED' : 'VALID',
      number: aca.number,
      fullName: aca.fullName,
      civility: null,
      programTitle: aca.courseTitle,
      organizer: aca.mentorNames ? `Metwork Startup Academy · ${aca.mentorNames}` : 'Metwork Startup Academy',
      startDate: aca.issuedAt,
      endDate: aca.issuedAt,
      issuedAt: aca.issuedAt,
    };
  }

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
