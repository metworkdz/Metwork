/**
 * PATCH /api/admin/commission-rules/[id]
 * Update a commission rule's rate or active status. Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  rate:     z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
}).refine((d) => d.rate !== undefined || d.isActive !== undefined, {
  message: 'Provide at least one of rate or isActive',
});

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

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
    // Seed default rules if the collection is empty (e.g. first cold-start
    // before the commissions page has been visited).
    if (store.commissionRules.length === 0) {
      store.commissionRules.push(...DEFAULT_COMMISSION_RULES.map((r) => ({ ...r })));
    }

    const rule = store.commissionRules.find((r) => r.id === id);
    if (!rule) return null;
    if (input.rate     !== undefined) rule.rate     = input.rate;
    if (input.isActive !== undefined) rule.isActive = input.isActive;
    rule.updatedAt = new Date().toISOString();
    return { ...rule };
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Commission rule not found');
  return json({ rule: updated });
}
