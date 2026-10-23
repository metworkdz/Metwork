/** Shared HTTP mapping for the messaging routes. */
import { jsonError } from '@/server/http/json';
import { MessagingUnavailableError } from '@/server/messaging/repo';
import type { MessagingError } from '@/server/messaging/service';

export function messagingErrorResponse(reason: MessagingError, limit?: number): Response {
  switch (reason) {
    case 'NOT_FOUND': return jsonError(404, 'NOT_FOUND', 'Conversation not found');
    case 'BLOCKED': return jsonError(403, 'BLOCKED', 'You cannot message this person');
    case 'NOT_ALLOWED': return jsonError(403, 'NOT_ALLOWED', 'Messaging is not available for this account');
    case 'CONTACT_LIMIT': return jsonError(403, 'CONTACT_LIMIT', 'Weekly new-contact limit reached', { limit: limit ?? 0 });
    case 'INVALID_ATTACHMENT': return jsonError(422, 'INVALID_ATTACHMENT', 'This document cannot be shared');
    case 'EMPTY': return jsonError(422, 'EMPTY', 'Write a message');
  }
}

/** Runs a handler, turning a missing messaging backend into a clean 503. */
export async function withMessaging(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MessagingUnavailableError) {
      console.error('[messaging] backend unavailable', err.message);
      return jsonError(503, 'MESSAGING_UNAVAILABLE', 'Messaging is temporarily unavailable');
    }
    throw err;
  }
}
