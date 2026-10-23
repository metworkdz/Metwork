/** HTTP mapping of order errors, shared by the order routes. */
import { jsonError } from '@/server/http/json';
import { messagingErrorResponse } from '@/server/messaging/http';
import type { OrderError } from '@/server/orders/service';

export function orderErrorResponse(reason: OrderError): Response {
  switch (reason) {
    case 'NOT_FOUND': return jsonError(404, 'NOT_FOUND', 'Order not found');
    case 'ALREADY_ORDERED': return jsonError(409, 'ALREADY_ORDERED', 'This devis has already been accepted');
    case 'TOO_SMALL': return jsonError(422, 'TOO_SMALL', 'The amount is too small to order');
    case 'WRONG_STATUS': return jsonError(409, 'WRONG_STATUS', 'Not possible at this stage of the order');
    case 'ALREADY_REVIEWED': return jsonError(409, 'ALREADY_REVIEWED', 'You already reviewed this order');
    case 'NO_WALLET': return jsonError(409, 'NO_WALLET', 'You have no wallet yet');
    case 'INSUFFICIENT_FUNDS': return jsonError(402, 'INSUFFICIENT_FUNDS', 'Your wallet balance is too low');
    case 'WALLET_FROZEN': return jsonError(403, 'WALLET_FROZEN', 'Your wallet is frozen');
    case 'NOT_PAYABLE': return jsonError(409, 'NOT_PAYABLE', 'This payment is no longer due');
    default: return messagingErrorResponse(reason);
  }
}
