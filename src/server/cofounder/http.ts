/** Turns a missing cofounder backend (migration not applied) into a clean 503. */
import { jsonError } from '@/server/http/json';
import { CofounderUnavailableError } from '@/server/cofounder/repo';
import { MessagingUnavailableError } from '@/server/messaging/repo';

export async function withCofounder(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CofounderUnavailableError || err instanceof MessagingUnavailableError) {
      console.error('[cofounder] backend unavailable', err.message);
      return jsonError(503, 'COFOUNDER_UNAVAILABLE', 'Cofounder matching is temporarily unavailable');
    }
    throw err;
  }
}
