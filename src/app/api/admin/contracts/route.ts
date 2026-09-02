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
import {
  createDraftContract,
  listContracts,
  missingConsultantIdentity,
} from '@/server/consultant-contracts/service';
import { mintContractPdfUrl } from '@/server/consultant-contracts/storage';
import { toAdminContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  consultantId: z.string().min(1),
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
    // Minimal picker payload — identity plus everything that decides whether a
    // contract can actually be issued to them. `missingIdentity` comes from the
    // SAME function `createDraftContract` refuses on, so the picker can never
    // disagree with what the server will do.
    consultants: (data.mentors ?? [])
      .map((m) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.email ?? null,
        phoneVerified: m.phoneVerified === true,
        missingIdentity: missingConsultantIdentity(m),
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

  const result = await createDraftContract({
    consultantId: input.consultantId,
    actorId: guard.user.id,
  });

  if (!result.ok) {
    if (result.reason === 'CONSULTANT_NOT_FOUND') {
      return jsonError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
    }
    if (result.reason === 'INCOMPLETE_CONSULTANT_PROFILE') {
      // Name the fields so the admin can tell the consultant exactly what to
      // fill in, rather than seeing a contract with blank party details.
      return jsonError(
        409,
        'INCOMPLETE_CONSULTANT_PROFILE',
        'This consultant has not completed their contract details yet. Ask them to fill in their full address and ID number in their profile settings.',
        { missing: result.missing },
      );
    }
    return jsonError(
      409,
      'NO_TEMPLATE',
      'No contract template is set. Add one under Settings before creating a contract.',
    );
  }

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === result.contract.consultantId) ?? null;

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_CREATED',
    targetType: 'consultant_contract',
    targetId: result.contract.id,
    details: { consultantId: result.contract.consultantId, consultantName: mentor?.fullName },
  });

  return json({ contract: toAdminContractDto(result.contract, mentor) }, { status: 201 });
}
