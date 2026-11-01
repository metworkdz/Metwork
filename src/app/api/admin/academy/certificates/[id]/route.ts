/** PATCH /api/admin/academy/certificates/{id} — { revoked }: revoke a certificate, or restore it (same number). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { setCertificateRevoked } from '@/server/academy/certificates';
import { learnerError, parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, z.object({ revoked: z.boolean() }));
  if (!body.ok) return body.response;
  if (!(await setCertificateRevoked(id, body.data.revoked))) return learnerError('NOT_FOUND');
  void appendAuditLog({
    adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_CERTIFICATE_REVOKED',
    targetType: 'ACADEMY_CERTIFICATE', targetId: id, details: { revoked: body.data.revoked },
  });
  return json({ ok: true });
}
