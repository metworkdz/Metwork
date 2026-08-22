/**
 * Wire shapes for consultant contracts.
 *
 * The stored record carries things the client must never receive — the OTP
 * send counters are an attacker's feedback channel for probing the throttle,
 * and the full audit trail is admin material. Serialisation is therefore an
 * explicit allowlist rather than a spread of the record: a field added to the
 * store in future is invisible to the client until someone deliberately adds it
 * here.
 */
import type { ConsultantContractRecord, ConsultantContractPayoutMethod, ConsultantContractStatus } from './types';

export interface ConsultantContractDto {
  id: string;
  status: ConsultantContractStatus;
  /** The French contract body, exactly as frozen at send-time. */
  contentSnapshot: string;
  /** Frozen platform commission, 0–1. The UI renders it read-only. */
  commissionRate: number;
  payoutMethod: ConsultantContractPayoutMethod;
  payoutDetails: string | null;
  /** The phone the signing code goes to — the consultant's own, so not masked. */
  signerPhoneSnapshot: string;
  sentAt: string | null;
  signedAt: string | null;
  /**
   * True while an active lockout blocks signing. A boolean rather than the
   * timestamp and counters: enough for the UI to explain itself, without
   * handing back a readout of the throttle state.
   */
  locked: boolean;
  /** Present only once signed. Expiring link, re-minted per request. */
  pdfUrl: string | null;
}

export function toConsultantContractDto(
  record: ConsultantContractRecord,
  options: { pdfUrl?: string | null } = {},
): ConsultantContractDto {
  return {
    id: record.id,
    status: record.status,
    contentSnapshot: record.contentSnapshot,
    commissionRate: record.commissionRate,
    payoutMethod: record.payoutMethod,
    payoutDetails: record.payoutDetails,
    signerPhoneSnapshot: record.signerPhoneSnapshot,
    sentAt: record.sentAt,
    signedAt: record.signedAt,
    locked: record.otp?.lockedUntil != null && new Date(record.otp.lockedUntil).getTime() > Date.now(),
    pdfUrl: options.pdfUrl ?? null,
  };
}

/* ─────────────────── Admin wire shape ─────────────────── */

/**
 * What an admin sees. A superset of the consultant view: the full audit trail
 * (who did what, when — the whole point of the admin screen), the consultant's
 * identity, and the integrity hash.
 *
 * Still an allowlist, and still without the OTP internals: an admin has no
 * business reading send counters either, and the code hash lives in the shared
 * OTP table regardless.
 */
export interface AdminContractDto extends ConsultantContractDto {
  consultantId: string;
  consultantName: string;
  consultantEmail: string | null;
  templateVersion: number;
  createdAt: string;
  voidedAt: string | null;
  /** SHA-256 of the signed PDF bytes. Shown so an admin can verify a download. */
  finalPdfHash: string | null;
  auditTrail: ConsultantContractRecord['auditTrail'];
}

export function toAdminContractDto(
  record: ConsultantContractRecord,
  consultant: { fullName: string; email?: string | null } | null,
  options: { pdfUrl?: string | null } = {},
): AdminContractDto {
  return {
    ...toConsultantContractDto(record, options),
    consultantId: record.consultantId,
    // A contract can outlive the consultant record it names; the fallback keeps
    // the admin list readable rather than rendering a blank row.
    consultantName: consultant?.fullName ?? 'Unknown consultant',
    consultantEmail: consultant?.email ?? null,
    templateVersion: record.templateVersion,
    createdAt: record.createdAt,
    voidedAt: record.voidedAt,
    finalPdfHash: record.finalPdfHash,
    auditTrail: record.auditTrail,
  };
}
