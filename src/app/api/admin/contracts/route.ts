/**
 * GET  /api/admin/contracts — every consultant contract, newest first, plus the
 *      consultants a contract can be issued to.
 * POST /api/admin/contracts — create a DRAFT.
 *
 * Admin only. The list carries the full audit trail per contract, so the detail
 * view renders without a second fetch.
 *
 * The `consultants` array is served from HERE rather than from `/api/mentors`
 * because the public mentor DTO deliberately strips `phoneVerified` as private
 * — reading it from there yields `undefined` for everyone, which made the
 * picker label every consultant "phone not verified". This endpoint is
 * admin-guarded, so the eligibility flag is safe to expose on it.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { createDraftContract, listContracts } from '@/server/consultant-contracts/service';
import { mintContractPdfUrl } from '@/server/consultant-contracts/storage';
import { toAdminContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  consultantId: z.string().min(1),
  /** French body. Length-capped so one contract cannot bloat the single-document store. */
  contentSnapshot: z.string().min(1).max(100_000),
  payoutMethod: z.enum(['BANK_TRANSFER', 'CCP', 'CHEQUE']),
  payoutDetails: z.string().max(500).nullable().optional(),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const [contracts, data] = await Promise.all([listContracts(), db.read()]);
  const mentors = new Map((data.mentors ?? []).map((m) => [m.id, m]));

  return json({
    contracts: contracts.map((c) =>
      toAdminContractDto(c, mentors.get(c.consultantId) ?? null, {
        pdfUrl: c.finalPdfPublicId ? mintContractPdfUrl(c.finalPdfPublicId) : null,
      }),
    ),
    // Minimal picker payload — identity plus the one flag that decides whether
    // a contract can actually be sent to them.
    consultants: (data.mentors ?? [])
      .map((m) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.email ?? null,
        phoneVerified: m.phoneVerified === true,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === input.consultantId);
  if (!mentor) return jsonError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');

  const contract = await createDraftContract({
    consultantId: input.consultantId,
    contentSnapshot: input.contentSnapshot,
    payoutMethod: input.payoutMethod,
    payoutDetails: input.payoutDetails ?? null,
    actorId: guard.user.id,
  });

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_CREATED',
    targetType: 'consultant_contract',
    targetId: contract.id,
    details: { consultantId: mentor.id, consultantName: mentor.fullName },
  });

  return json({ contract: toAdminContractDto(contract, mentor) }, { status: 201 });
}
