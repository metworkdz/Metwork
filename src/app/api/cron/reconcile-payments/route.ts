/**
 * Vercel Cron — Payment reconciliation safety net.
 *
 * Schedule: every 15 minutes. Recovers payments that completed at the provider
 * but were never settled because the webhook didn't arrive AND the payer never
 * returned to the success/pay page. Without this, money taken by SlickPay can
 * sit uncredited (wallet top-up) or a paid booking can stay PENDING_PAYMENT.
 *
 * Each reconciler re-polls the provider and settles idempotently, so a webhook
 * + return + cron can race without double-crediting. No-ops with the mock
 * provider (nothing to poll). Secured by CRON_SECRET, same as the other crons.
 */
import { NextResponse } from 'next/server';
import { reconcilePendingTopUps } from '@/server/wallet/service';
import { reconcilePendingCardBookings } from '@/server/bookings/card-payment';
import { reconcilePendingGuestConsultations } from '@/server/consultations/guest-payment';
import { reconcilePendingPaymentLinks } from '@/server/payments/payment-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

async function run(): Promise<Response> {
  const startedAt = Date.now();
  // Sequential — each reconciler runs its own provider polls + db.update
  // critical sections; serialising keeps the in-memory store contention low.
  const topups = await reconcilePendingTopUps();
  const card = await reconcilePendingCardBookings();
  const guest = await reconcilePendingGuestConsultations();
  const paymentLinks = await reconcilePendingPaymentLinks();
  const durationMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.info('[cron] reconcile-payments: finished', { topups, card, guest, paymentLinks, durationMs });
  return NextResponse.json({ ok: true, topups, card, guest, paymentLinks, durationMs });
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}

// Vercel may invoke crons as GET; accept both.
export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}
