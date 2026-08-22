/**
 * GET  /api/admin/settings — read platform settings
 * PATCH /api/admin/settings — update platform settings
 * Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { DEFAULT_PLATFORM_SETTINGS } from '@/server/admin/settings-defaults';
import { LANDING_SECTIONS } from '@/config/landing-sections';
import { MIN_EUR_DZD_RATE, MAX_EUR_DZD_RATE } from '@/server/payments/fx';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  appName:          z.string().min(1).max(60).optional(),
  maintenanceMode:  z.boolean().optional(),
  signupsEnabled:   z.boolean().optional(),
  paymentsEnabled:  z.boolean().optional(),
  /** Public landing-section toggles — only known section ids accepted. */
  landingVisibility: z.record(z.enum(LANDING_SECTIONS), z.boolean()).optional(),
  /**
   * DZD per 1 EUR for the international-card checkout. Must be positive and
   * within sane bounds — a fat-fingered rate mischarges every subsequent payer.
   * Handled separately below so it carries its own audit stamp.
   */
  eurToDzdRate: z
    .number()
    .positive()
    .min(MIN_EUR_DZD_RATE)
    .max(MAX_EUR_DZD_RATE)
    .optional(),
  /**
   * Metwork's stamp / authorised-signature image, composited into every signed
   * consultant contract PDF. A URL from /api/upload (an ordinary public image,
   * unlike the signed contracts themselves). Null clears it.
   */
  adminStampImageUrl: z.string().url().max(2_000).nullable().optional(),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  return json({ settings: data.platformSettings ?? DEFAULT_PLATFORM_SETTINGS });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const { eurToDzdRate, ...rest } = input;
  const rateChanged = eurToDzdRate !== undefined;
  const stampChanged = input.adminStampImageUrl !== undefined;

  const updated = await db.update((store) => {
    const current = store.platformSettings ?? { ...DEFAULT_PLATFORM_SETTINGS };
    store.platformSettings = {
      ...current,
      ...rest,
      // The rate carries who/when alongside it. Rates already snapshotted onto
      // in-flight or settled transactions are untouched by design.
      ...(rateChanged
        ? {
            eurToDzdRate,
            eurToDzdRateUpdatedAt: now,
            eurToDzdRateUpdatedBy: guard.user.id,
          }
        : {}),
      updatedAt: now,
    };
    return { ...store.platformSettings };
  });

  // The stamp appears on every future signed contract, so a change to it is
  // recorded in the platform audit log alongside the other settings changes.
  if (stampChanged) {
    await appendAuditLog({
      adminId: guard.user.id,
      adminEmail: guard.user.email,
      action: 'CONTRACT_STAMP_UPDATED',
      targetType: 'platform_settings',
      targetId: 'adminStampImageUrl',
      details: { cleared: input.adminStampImageUrl === null },
    });
  }

  return json({ settings: updated });
}
