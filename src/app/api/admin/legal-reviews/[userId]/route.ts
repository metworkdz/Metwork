/**
 * POST /api/admin/legal-reviews/[userId] — approve or reject a business
 * document. Body: { decision: 'APPROVED' | 'REJECTED', note?: string }.
 * A rejection needs a note: it is what the freelancer reads.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { decideLegalDocumentByAdmin } from '@/server/freelancers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.decision === 'APPROVED' || !!d.note, { message: 'noteRequired', path: ['note'] });

interface RouteParams { params: Promise<{ userId: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await decideLegalDocumentByAdmin({
    userId,
    adminId: guard.user.id,
    decision: input.decision,
    note: input.note ?? null,
  });
  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'No document to review for this user');
  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: input.decision === 'APPROVED' ? 'LEGAL_DOCUMENT_APPROVED' : 'LEGAL_DOCUMENT_REJECTED',
    targetType: 'user',
    targetId: userId,
    details: input.note ? { note: input.note } : {},
  });
  return json({ ok: true });
}
