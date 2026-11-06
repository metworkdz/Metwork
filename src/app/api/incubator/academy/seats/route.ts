/**
 * GET  /api/incubator/academy/seats?seats=&months= — the incubator's seat batches, and a quote.
 * POST /api/incubator/academy/seats — { seats, months, clientReference }: buy from the incubator wallet.
 * The price is computed on the server (bulk tiers from the Academy settings).
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { requireApiRole } from '@/server/auth/api-guards';
import { isAcademyEnabled } from '@/config/feature-flags';
import { ACADEMY_MAX_SEAT_MONTHS, ACADEMY_MAX_SEATS } from '@/lib/academy';
import { buySeats, listSeatBatches, quoteSeatPurchase } from '@/server/academy/seats';
import { getWallet } from '@/server/wallet/service';
import { parseBody, rateLimited } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function guard() {
  if (!isAcademyEnabled()) return { ok: false as const, response: jsonError(404, 'NOT_FOUND', 'Not found') };
  return requireApiRole(['INCUBATOR']);
}

const qty = (v: string | null, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= max ? n : 1; };

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;
  const batches = await listSeatBatches(g.user.id);
  if (!batches) return jsonError(403, 'NOT_AN_INCUBATOR', 'No incubator for this account');
  const seats = qty(req.nextUrl.searchParams.get('seats'), ACADEMY_MAX_SEATS);
  const months = qty(req.nextUrl.searchParams.get('months'), ACADEMY_MAX_SEAT_MONTHS);
  const [quote, wallet] = await Promise.all([quoteSeatPurchase(seats, months), getWallet(g.user.id)]);
  return json({ batches, quote, walletBalance: wallet?.balance ?? 0 });
}

const schema = z.object({
  seats: z.number().int().min(1).max(ACADEMY_MAX_SEATS),
  months: z.number().int().min(1).max(ACADEMY_MAX_SEAT_MONTHS),
  clientReference: z.string().min(8).max(120),
});
const STATUS: Record<string, number> = { NOT_AN_INCUBATOR: 403, INVALID_QUANTITY: 422, WALLET_FROZEN: 423, INSUFFICIENT_FUNDS: 402 };

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;
  const limited = await rateLimited(`academy:seats:${g.user.id}`, 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await buySeats(g.user.id, body.data);
  if (!res.ok) return jsonError(STATUS[res.code] ?? 422, res.code, res.code, res.code === 'INSUFFICIENT_FUNDS' ? { balance: res.balance, required: res.required } : undefined);
  return json({ batchId: res.batch.id }, { status: 201 });
}
