/**
 * Admin-side consultant-contract API.
 *
 * Kept separate from `consultant.service.ts`, which is the CONSULTANT's view of
 * the same records: different endpoints, different guard, and a wider DTO. One
 * shared module would blur which surface a caller is on.
 */
import { apiClient } from '@/lib/api-client';
import type { ConsultantContract } from './consultant.service';

export type ContractAuditEvent =
  | 'CREATED' | 'SENT' | 'VIEWED' | 'OTP_SENT' | 'OTP_FAILED'
  | 'OTP_VERIFIED' | 'SIGNED' | 'VOIDED' | 'RESEND_OTP';

export interface ContractAuditEntry {
  event: ContractAuditEvent;
  actorId: string;
  timestamp: string;
}

/** Mirrors `AdminContractDto` in `src/server/consultant-contracts/dto.ts`. */
export interface AdminContract extends ConsultantContract {
  consultantId: string;
  consultantName: string;
  consultantEmail: string | null;
  templateVersion: number;
  createdAt: string;
  voidedAt: string | null;
  finalPdfHash: string | null;
  auditTrail: ContractAuditEntry[];
}

export interface ContractDraftInput {
  consultantId: string;
  contentSnapshot: string;
  payoutMethod: 'BANK_TRANSFER' | 'CCP' | 'CHEQUE';
  payoutDetails?: string | null;
}

/**
 * A consultant a contract can be issued to.
 *
 * Comes from the admin contracts endpoint, NOT `/api/mentors`: the public
 * mentor DTO strips `phoneVerified` as private, so reading eligibility from
 * there is always `undefined`.
 */
export interface ContractConsultantOption {
  id: string;
  fullName: string;
  email: string | null;
  phoneVerified: boolean;
}

export const contractsService = {
  list: () =>
    apiClient.get<{ contracts: AdminContract[]; consultants: ContractConsultantOption[] }>(
      '/admin/contracts',
    ),

  create: (body: ContractDraftInput) =>
    apiClient.post<{ contract: AdminContract }>('/admin/contracts', body),

  /** Accepted only while DRAFT — the server refuses once the contract is sent. */
  update: (id: string, body: Partial<Omit<ContractDraftInput, 'consultantId'>>) =>
    apiClient.patch<{ contract: AdminContract }>(`/admin/contracts/${encodeURIComponent(id)}`, body),

  send: (id: string) =>
    apiClient.post<{ contract: AdminContract }>(`/admin/contracts/${encodeURIComponent(id)}/send`, {}),

  /**
   * `confirm` is part of the request, not just the dialog: the server refuses a
   * void that does not carry it.
   */
  void: (id: string) =>
    apiClient.post<{ contract: AdminContract }>(`/admin/contracts/${encodeURIComponent(id)}/void`, { confirm: true }),

  resendOtp: (id: string, channel?: 'whatsapp' | 'sms') =>
    apiClient.post<{ ok: true; channel: 'whatsapp' | 'sms' }>(
      `/admin/contracts/${encodeURIComponent(id)}/otp`,
      { channel },
    ),

  pdfUrl: (id: string) =>
    apiClient.get<{ url: string }>(`/admin/contracts/${encodeURIComponent(id)}/pdf`),
};
