/**
 * GET /api/ventures/me — the entrepreneur's venture, or a pre-filled draft.
 * PUT /api/ventures/me — create or update it. Entrepreneurs only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { draftFromListing, saveVenture, ventureOf } from '@/server/ventures/service';
import { VENTURE_KINDS, VENTURE_NEEDS, VENTURE_STAGES } from '@/lib/venture-options';
import { COMPANY_FORMS, LEGAL_STATUSES, TAX_REGIMES } from '@/types/legal-status';
import { algerianCities } from '@/config/cities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WILAYA_CODES = new Set<string>(algerianCities.map((c) => c.code));

const schema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(VENTURE_KINDS),
    legal: z.object({
      status: z.enum(LEGAL_STATUSES),
      companyForm: z.enum(COMPANY_FORMS).nullable().optional(),
      taxRegime: z.enum(TAX_REGIMES).nullable().optional(),
      hasStartupLabel: z.boolean().optional(),
    }),
    stage: z.enum(VENTURE_STAGES),
    sector: z.string().trim().min(2).max(60),
    wilaya: z.string().refine((c) => WILAYA_CODES.has(c), 'invalidWilaya'),
    description: z.string().trim().max(1500),
    website: z.string().max(300).url().refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'invalidUrl').nullable(),
    lookingFor: z.array(z.enum(VENTURE_NEEDS)).max(VENTURE_NEEDS.length),
    isPublic: z.boolean(),
  })
  // The company form only means something for a company.
  .transform((v) => ({
    ...v,
    legal: { ...v.legal, companyForm: v.legal.status === 'COMPANY' ? v.legal.companyForm ?? null : null },
  }));

export async function GET() {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const data = await db.read();
  const venture = ventureOf(data, guard.user.id);
  return json({ venture, draft: venture ? null : draftFromListing(data, guard.user.id) });
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`venture:${guard.user.id}`, 30, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many updates. Please wait a moment.');
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await saveVenture(guard.user.id, input);
  if (!result.ok) {
    if (result.reason === 'PUBLIC_PAGE_REQUIRES_FOUNDER') {
      return jsonError(403, 'PUBLIC_PAGE_REQUIRES_FOUNDER', 'A public page is part of the Founder plan');
    }
    return jsonError(404, 'NOT_FOUND', 'User not found');
  }
  return json({ venture: result.venture });
}
