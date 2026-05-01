/**
 * GET /api/wallet/transactions?page=1&pageSize=20&type=TOP_UP
 *
 * Paginated, newest-first, scoped to the caller. `type` is optional.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { listTransactions } from '@/server/wallet/service';
import { toTransactionDto } from '@/server/wallet/serialize';
import { json } from '@/server/http/json';
import type { TransactionRecord } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES: TransactionRecord['type'][] = [
  'TOP_UP',
  'PAYMENT',
  'REFUND',
  'ADJUSTMENT',
  'PAYOUT',
  'COMMISSION',
];

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
  const typeParam = url.searchParams.get('type');
  const type =
    typeParam && (ALLOWED_TYPES as string[]).includes(typeParam)
      ? (typeParam as TransactionRecord['type'])
      : undefined;

  const result = await listTransactions({
    userId: guard.user.id,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    type,
  });

  return json({
    items: result.items.map(toTransactionDto),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
  });
}
