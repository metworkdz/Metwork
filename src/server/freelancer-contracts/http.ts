/** HTTP mapping of freelancer contract errors, shared by its routes. */
import { jsonError } from '@/server/http/json';
import type { ContractError } from '@/server/freelancer-contracts/service';

const MAP: Record<ContractError, [number, string]> = {
  NOT_FOUND: [404, 'Contract not found'],
  NOT_PENDING: [409, 'This contract is not awaiting signature'],
  BAD_SIGNATURE: [422, 'Draw your signature'],
  BAD_ID_NUMBER: [422, 'Enter your national ID card number (9 to 18 digits)'],
  LOCKED: [423, 'Too many wrong codes: try again later'],
  INVALID: [422, 'Wrong code'],
  EXPIRED: [422, 'The code has expired'],
  TOO_MANY_ATTEMPTS: [423, 'Too many wrong codes: try again later'],
  NO_PHONE: [409, 'Add a phone number to your account first'],
  STORAGE_FAILED: [503, 'The signed contract could not be stored. Try again.'],
};

export function contractErrorResponse(reason: ContractError): Response {
  const [status, message] = MAP[reason];
  return jsonError(status, reason, message);
}
