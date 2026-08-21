/**
 * POST /api/consultant/contracts/:id/sign  { signatureImagePng, code }
 *
 * Complete a signature. Everything that matters — code verification, PDF
 * render, hashing, private upload and the atomic status flip — happens in
 * `signContract`; this route enforces ownership, bounds the payload, and maps
 * outcomes to HTTP.
 *
 * NOTHING FROM THE CLIENT IS TRUSTED AS A TERM. The request carries only a
 * signature image and a code; the commission rate, payout route and phone are
 * read from the frozen record server-side. A tampered UI cannot alter what gets
 * signed — the locked fields the portal displays are advisory rendering, not
 * the source of the contract.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { findContractById, signContract } from '@/server/consultant-contracts/service';
import { mintContractPdfUrl } from '@/server/consultant-contracts/storage';
import { toConsultantContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upper bound on the signature payload. A canvas signature is a few KB; this
 * caps a hostile client well below the point where PDF embedding would matter,
 * while leaving ample room for a high-DPI drawing.
 */
const MAX_SIGNATURE_CHARS = 1_500_000;

const schema = z.object({
  signatureImagePng: z
    .string()
    .max(MAX_SIGNATURE_CHARS, 'Signature image is too large')
    .regex(/^data:image\/png;base64,/, 'Signature must be a PNG data URL'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const contract = await findContractById(id);
  if (!contract || contract.consultantId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Contract not found');
  }

  // Hard ceiling on guesses per consultant. The service enforces the per-code
  // attempt cap and the lockout; this stops an attacker with a session from
  // burning through code after code.
  if (!(await checkRateLimitDistributed(`contract-sign:mentor:${guard.mentorId}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  const result = await signContract(id, {
    signatureImagePng: input.signatureImagePng,
    otpCode: input.code,
    actorId: guard.mentorId,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'NOT_FOUND':
        return jsonError(404, 'NOT_FOUND', 'Contract not found');
      case 'NOT_PENDING':
        return jsonError(409, 'NOT_PENDING', 'This contract is not awaiting signature.');
      case 'LOCKED':
        return jsonError(429, 'OTP_LOCKED', 'Too many attempts. Try again later.');
      case 'TOO_MANY_ATTEMPTS':
        return jsonError(429, 'OTP_LOCKED', 'Too many attempts. Request a new code.');
      case 'EXPIRED':
        return jsonError(401, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
      case 'INVALID':
        return jsonError(401, 'INVALID_OTP', 'Invalid or expired code');
      case 'BAD_SIGNATURE':
        return jsonError(400, 'BAD_SIGNATURE', 'Please draw your signature before confirming.');
      case 'METWORK_LEGAL_INCOMPLETE':
        // Not the consultant's fault and not something they can fix.
        return jsonError(503, 'UNAVAILABLE', 'Signing is temporarily unavailable. Please try again later.');
      default:
        console.error('[consultant/contracts/sign] storage failure:', result.message);
        return jsonError(500, 'SIGN_FAILED', 'Could not finalise the contract. Please try again.');
    }
  }

  return json({
    contract: toConsultantContractDto(result.contract, {
      pdfUrl: result.contract.finalPdfPublicId ? mintContractPdfUrl(result.contract.finalPdfPublicId) : null,
    }),
  });
}
