/** HTTP mapping of agreement errors, shared by the agreement routes. */
import { jsonError } from '@/server/http/json';
import type { AgreementError } from '@/server/cofounder/agreement';

const MAP: Record<AgreementError, [number, string]> = {
  NOT_FOUND: [404, 'Agreement not found'],
  EXISTS: [409, 'This match already has an agreement'],
  NOT_DRAFT: [409, 'Only a draft can be edited'],
  NOT_PENDING: [409, 'This agreement is not awaiting signatures'],
  INCOMPLETE: [422, 'Both founders must fill in their identity'],
  INVALID_TERMS: [422, 'Check the terms: equity must add up to 100 %, vesting and cliff within limits, roles filled in'],
  ALREADY_SIGNED: [409, 'Already signed'],
  SIGNED_BY_OTHER: [409, 'Someone has already signed: the text can no longer change'],
  BAD_SIGNATURE: [422, 'Draw your signature'],
  LOCKED: [423, 'Too many wrong codes: try again later'],
  INVALID: [422, 'Wrong code'],
  EXPIRED: [422, 'The code has expired'],
  TOO_MANY_ATTEMPTS: [423, 'Too many wrong codes: try again later'],
  NO_PHONE: [409, 'Add a phone number to your account first'],
  STORAGE_FAILED: [503, 'The signed document could not be stored. Try again.'],
};

export function agreementErrorResponse(reason: AgreementError): Response {
  const [status, message] = MAP[reason];
  return jsonError(status, reason, message);
}
