/** POST /api/freelancer/contract/sign — `{ contractId, signaturePng, code, idNumber }`. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { contractView, signContract } from '@/server/freelancer-contracts/service';
import { contractErrorResponse } from '@/server/freelancer-contracts/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Render + store the PDF.
export const maxDuration = 60;

const bodySchema = z.object({
  contractId: z.string().uuid(),
  // A drawn signature PNG; 400 KB of base64 is far above any real one.
  signaturePng: z.string().startsWith('data:image/png;base64,').max(400_000),
  code: z.string().trim().regex(/^\d{4,8}$/),
  idNumber: z.string().trim().min(9).max(24),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`freelancer-contract-sign:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const r = await signContract(guard.user.id, parsed.data.contractId, parsed.data);
  return r.ok ? json({ contract: contractView(r.value) }) : contractErrorResponse(r.reason);
}
