/**
 * Order state transitions that happen INSIDE the payment-link settlement
 * mutation — so the money and the order move together or not at all.
 * Pure over the draft; no I/O. Imported by `payments/payment-links`, which is
 * why it lives apart from the order service (no import cycle).
 */
import type { db, PaymentLinkRecord } from '@/server/db/store';

type Draft = Parameters<Parameters<typeof db.update>[0]>[0];

export type OrderPaymentEvent = { orderId: string; part: 'DEPOSIT' | 'BALANCE'; entrepreneurId: string; freelancerId: string; title: string } | null;

/**
 * A deposit link paid → IN_PROGRESS; a balance link paid → COMPLETED.
 * A payment that lands on a cancelled order still moves the order forward
 * (the money was taken; the order must reflect it).
 */
export function applyOrderPaymentInDraft(d: Draft, link: PaymentLinkRecord, now: string): OrderPaymentEvent {
  if (!link.orderId || !link.orderPart) return null;
  const order = (d.serviceOrders ?? []).find((o) => o.id === link.orderId);
  if (!order) return null;
  if (link.orderPart === 'DEPOSIT' && order.depositLinkId === link.id && !order.depositPaidAt) {
    order.depositPaidAt = now;
    if (order.status === 'AWAITING_DEPOSIT' || order.status === 'CANCELLED') order.status = 'IN_PROGRESS';
    order.cancelledAt = null;
    order.cancelledBy = null;
  } else if (link.orderPart === 'BALANCE' && order.balanceLinkId === link.id && !order.completedAt) {
    order.completedAt = now;
    order.status = 'COMPLETED';
  } else {
    return null;
  }
  order.updatedAt = now;
  return { orderId: order.id, part: link.orderPart, entrepreneurId: order.entrepreneurId, freelancerId: order.freelancerId, title: order.title };
}

/** The frozen receiver rate of the order a link pays, or null for an ordinary link. */
export function orderCommissionRate(d: { serviceOrders?: Draft['serviceOrders'] }, link: PaymentLinkRecord): number | null {
  if (!link.orderId) return null;
  const order = (d.serviceOrders ?? []).find((o) => o.id === link.orderId);
  return order ? order.commissionRate : null;
}
