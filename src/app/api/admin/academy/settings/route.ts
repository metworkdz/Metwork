/**
 * GET   /api/admin/academy/settings — Pass price, discounts, default mentor share, stamp
 * PATCH /api/admin/academy/settings — change any of them (applies to new sales only)
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json, jsonError } from '@/server/http/json';
import { getAcademySettings, updateAcademySettings } from '@/server/academy/settings';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  passMonthlyPriceDzd: z.number().optional(),
  passAnnualDiscountRate: z.number().optional(),
  premiumDiscountRate: z.number().optional(),
  defaultMentorShareRate: z.number().optional(),
  certificateStampUrl: z.string().max(500).nullable().optional(),
  addendumTemplate: z.string().max(30_000).nullable().optional(),
}).strict();

export async function GET() {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  return json(await getAcademySettings());
}

export async function PATCH(req: NextRequest) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await updateAcademySettings(body.data, g.admin);
  if (!res.ok) return jsonError(422, res.code, res.code);
  revalidatePath('/[locale]/academy', 'layout');
  return json(res.settings);
}
