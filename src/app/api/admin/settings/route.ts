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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  appName:          z.string().min(1).max(60).optional(),
  maintenanceMode:  z.boolean().optional(),
  signupsEnabled:   z.boolean().optional(),
  paymentsEnabled:  z.boolean().optional(),
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

  const updated = await db.update((store) => {
    const current = store.platformSettings ?? { ...DEFAULT_PLATFORM_SETTINGS };
    store.platformSettings = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return { ...store.platformSettings };
  });

  return json({ settings: updated });
}
