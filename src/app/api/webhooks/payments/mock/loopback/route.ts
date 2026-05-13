/**
 * GET /api/webhooks/payments/mock/loopback
 *
 * Dev-only loopback that simulates the full hosted-checkout round trip
 * for the mock provider in async mode:
 *
 *   browser  →  /api/webhooks/payments/mock/loopback?topUpId=...&status=COMPLETED&next=...
 *   server   →  confirmTopUp(...)
 *   browser  →  redirected to `next`
 *
 * No signature verification — this path is reached only when
 * `MOCK_PAYMENT_MODE=async` is set in development. Real providers settle
 * via the signed POST webhook at /api/webhooks/payments/:provider.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { confirmTopUp } from '@/server/wallet/service';
import { jsonError } from '@/server/http/json';
import { clientEnvVars } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_PROVIDER !== 'mock') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const url = new URL(req.url);
  const topUpId = url.searchParams.get('topUpId') ?? '';
  const providerRef = url.searchParams.get('providerRef') ?? `mock_${topUpId}`;
  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'FAILED' ? 'FAILED' : 'COMPLETED';
  const next = url.searchParams.get('next');

  if (!topUpId) {
    return jsonError(400, 'MISSING_TOPUP_ID', 'topUpId is required');
  }

  await confirmTopUp({ topUpId, providerRef, status });

  const fallback = `${clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/en/dashboard/entrepreneur`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
  function isSameOrigin(url: string): boolean {
    try { return new URL(url).origin === new URL(appUrl).origin; } catch { return false; }
  }
  const destination = next && isSameOrigin(next) ? next : fallback;
  return NextResponse.redirect(destination);
}
