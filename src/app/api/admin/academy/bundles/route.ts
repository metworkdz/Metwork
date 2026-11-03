/**
 * GET  /api/admin/academy/bundles — every bundle (learning path).
 * POST /api/admin/academy/bundles — { title, description, courseIds, priceDzd }: a new draft.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { bundleInputSchema, createBundle, listBundlesForAdmin } from '@/server/academy/bundles';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  return json({ bundles: await listBundlesForAdmin() });
}

export async function POST(req: NextRequest) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const body = await parseBody(req, bundleInputSchema);
  if (!body.ok) return body.response;
  const res = await createBundle(body.data);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : 422, res.code, res.code);
  void appendAuditLog({ adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_BUNDLE_UPDATED', targetType: 'ACADEMY_BUNDLE', targetId: res.bundle.id, details: { created: true, priceDzd: res.bundle.priceDzd } });
  return json({ bundle: res.bundle }, { status: 201 });
}
