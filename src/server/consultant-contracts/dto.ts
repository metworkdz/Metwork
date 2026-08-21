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
