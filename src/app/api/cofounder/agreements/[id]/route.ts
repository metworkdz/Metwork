/**
 * PATCH /api/cofounder/agreements/[id] — `{ terms }` or `{ identity }` (draft only; identity = the caller's own).
 * POST  /api/cofounder/agreements/[id] — `{ action: 'SEND' | 'REOPEN' | 'CANCEL' }`.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { agreementView, cancel, reopen, sendToSignature, updateIdentity, updateTerms } from '@/server/cofounder/agreement';
import { agreementErrorResponse } from '@/server/cofounder/agreement-http';
import { COMMITMENTS } from '@/lib/cofounder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

// Latin script only: the agreement is printed in French and the names must
// match the Latin spelling on the ID card.
const latin = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((v) => !/[؀-ۿ]/.test(v), { message: 'LATIN_ONLY' });

const termsSchema = z.object({
  projectName: z.string().trim().min(2).max(120),
  projectDescription: z.string().trim().min(10).max(1000),
  roles: z.record(z.string().max(80), z.string().trim().max(80)),
  commitments: z.record(z.string().max(80), z.enum(COMMITMENTS)),
  equity: z.record(z.string().max(80), z.number().min(0).max(100)),
  reservePercent: z.number().min(0).max(30),
  vestingMonths: z.number().int(),
  cliffMonths: z.number().int(),
  jurisdiction: z.string().max(60),
}).strict();

const identitySchema = z.object({
  legalName: latin(3, 120),
  idNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{5,30}$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address: latin(8, 300),
}).strict();

const patchSchema = z.union([
  z.object({ terms: termsSchema }).strict(),
  z.object({ identity: identitySchema }).strict(),
]);

async function readBody(req: NextRequest): Promise<unknown | Response> {
  try { return await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const r = 'terms' in parsed.data
    ? await updateTerms(guard.user.id, id, parsed.data.terms)
    : await updateIdentity(guard.user.id, id, parsed.data.identity);
  return r.ok ? json({ agreement: agreementView(r.value, guard.user.id) }) : agreementErrorResponse(r.reason);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const parsed = z.object({ action: z.enum(['SEND', 'REOPEN', 'CANCEL']) }).strict().safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const fn = { SEND: sendToSignature, REOPEN: reopen, CANCEL: cancel }[parsed.data.action];
  const r = await fn(guard.user.id, id);
  return r.ok ? json({ agreement: agreementView(r.value, guard.user.id) }) : agreementErrorResponse(r.reason);
}
