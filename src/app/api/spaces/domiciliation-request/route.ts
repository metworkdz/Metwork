/**
 * POST /api/spaces/domiciliation-request — public domiciliation enquiry.
 *
 * A visitor (guest OR logged-in) submits an address-slot request for a
 * DOMICILIATION space. We write a DomiciliationRequestRecord with status
 * 'PENDING'; the incubator follows up offline. No payment, no wallet, no
 * calendar. `incubatorId` is resolved server-side from the space — never
 * trusted from the client. When the caller is authenticated we attach their
 * userId; otherwise it's a guest submission (userId: null).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db, type DomiciliationRequestRecord } from '@/server/db/store';
import { getServerSession } from '@/lib/session';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import { findIncubatorById } from '@/server/incubator/service';
import { notifyIncubatorDomiciliationRequest } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  spaceId: z.string().min(1),
  fullName: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(200),
  message: z.string().trim().max(300).nullable().optional(),
});

export async function POST(req: NextRequest) {
  // Light abuse guard — guests can submit, so cap per IP-ish key. Fail-open.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!(await checkRateLimitDistributed(`domiciliation:${ip}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = bodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Optional auth — attach userId when signed in, accept as guest otherwise.
  const session = await getServerSession();

  const result = await db.update((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === input.spaceId && s.isActive);
    if (!space) return 'SPACE_NOT_FOUND' as const;
    if (space.category !== 'DOMICILIATION') return 'NOT_DOMICILIATION' as const;

    if (!Array.isArray(d.domiciliationRequests)) d.domiciliationRequests = [];

    const record: DomiciliationRequestRecord = {
      id: randomUUID(),
      spaceId: space.id,
      incubatorId: space.incubatorId,
      userId: session?.id ?? null,
      fullName: input.fullName,
      companyName: input.companyName?.trim() || null,
      phone: input.phone,
      email: input.email,
      message: input.message?.trim() || null,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    d.domiciliationRequests.push(record);
    return { ...record, spaceName: space.name };
  });

  if (result === 'SPACE_NOT_FOUND') return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
  if (result === 'NOT_DOMICILIATION') return jsonError(400, 'NOT_DOMICILIATION', 'This space does not offer domiciliation');

  // Incubator alert (email + WhatsApp) — fire-and-forget; a delivery failure
  // must never affect the already-persisted request.
  void (async () => {
    const incubator = await findIncubatorById(result.incubatorId);
    if (!incubator) return;
    await notifyIncubatorDomiciliationRequest(incubator, {
      fullName: result.fullName,
      companyName: result.companyName,
      phone: result.phone,
      email: result.email,
      message: result.message,
      itemName: result.spaceName,
      lang: 'fr',
    });
  })();

  return json({ request: { id: result.id, status: result.status } }, { status: 201 });
}
