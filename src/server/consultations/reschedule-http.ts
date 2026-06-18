/**
 * Shared HTTP mapping for reschedule failures, used by both the consultant and
 * the member reschedule routes so the two never drift. Kept out of the pure
 * `reschedule.ts` domain module (which owns no HTTP concerns).
 */
import { jsonError } from '@/server/http/json';
import type { RescheduleResult } from './reschedule';

export function rescheduleErrorResponse(reason: Extract<RescheduleResult, { ok: false }>['reason']) {
  switch (reason) {
    case 'LIMIT_REACHED':
      return jsonError(409, 'RESCHEDULE_LIMIT', 'This booking has reached its reschedule limit.');
    case 'TOO_LATE':
      return jsonError(422, 'TOO_LATE', 'It is too late to reschedule this session.');
    case 'SLOT_NOT_BOOKABLE':
      return jsonError(409, 'SLOT_NOT_BOOKABLE', 'That time slot is not available. Please pick another.');
    case 'WRONG_STATE':
      return jsonError(409, 'WRONG_STATE', 'This booking cannot be rescheduled in its current state.');
    default:
      return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }
}
