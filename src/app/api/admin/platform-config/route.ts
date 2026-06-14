/**
 * GET   /api/admin/platform-config  — read current platform-wide config
 * PATCH /api/admin/platform-config  — update any subset of config fields
 *
 * Controls: FLAT subscription pricing, billing-cycle discounts, commission rate.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, defaultPlatformConfig } from '@/server/db/store';
import { fromZod, json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  flatMonthlyPrice:      z.number().int().min(0).optional(),
  semesterlyMonths:      z.number().int().min(1).max(24).optional(),
  yearlyDiscountPercent: z.number().min(0).max(100).optional(),
  commissionRate:        z.number().min(0).max(1).optional(),
  // Central commission engine rates (decimal 0–1).
  receiverCommissionRate: z.number().min(0).max(1).optional(),
  payerFeeRate:           z.number().min(0).max(1).optional(),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const cfg = { ...defaultPlatformConfig, ...data.meta?.platformConfig };
  return json(cfg);
}

export async function PATCH(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON' } }, { status: 400 }); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await db.update((d) => {
    if (!d.meta) d.meta = {};
    d.meta.platformConfig = { ...defaultPlatformConfig, ...d.meta.platformConfig, ...input };
    return d.meta.platformConfig;
  });

  return json(updated);
}
