/** PUT /api/admin/academy/bundles/{id} — the whole bundle, including its status (DRAFT / PUBLISHED / ARCHIVED). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json, jsonError } from '@/server/http/json';
import { bundleInputSchema, updateBundle } from '@/server/academy/bundles';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = bundleInputSchema.extend({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']) });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await updateBundle(id, body.data);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : 422, res.code, res.code);
  void appendAuditLog({ adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_BUNDLE_UPDATED', targetType: 'ACADEMY_BUNDLE', targetId: id, details: { status: body.data.status, priceDzd: body.data.priceDzd } });
  revalidatePath('/[locale]/academy', 'layout');
  return json({ bundle: res.bundle });
}
