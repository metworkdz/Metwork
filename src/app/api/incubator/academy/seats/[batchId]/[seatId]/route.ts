/** PUT /api/incubator/academy/seats/{batchId}/{seatId} — { contact | null }: give the seat to a member (email or phone), or free it. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { requireApiRole } from '@/server/auth/api-guards';
import { isAcademyEnabled } from '@/config/feature-flags';
import { assignSeat } from '@/server/academy/seats';
import { isAcademyId, parseBody, rateLimited } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { NOT_FOUND: 404, MEMBER_NOT_FOUND: 404, NOT_A_LEARNER: 422, ALREADY_SEATED: 409, ENDED: 410 };

export async function PUT(req: NextRequest, { params }: { params: Promise<{ batchId: string; seatId: string }> }) {
  if (!isAcademyEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const g = await requireApiRole(['INCUBATOR']);
  if (!g.ok) return g.response;
  const { batchId, seatId } = await params;
  if (!isAcademyId(batchId) || !isAcademyId(seatId)) return jsonError(404, 'NOT_FOUND', 'Not found');
  // Looking members up by email or phone: a budget keeps it from becoming a directory search.
  const limited = await rateLimited(`academy:seat-assign:${g.user.id}`, 60, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, z.object({ contact: z.string().trim().min(5).max(120).nullable() }));
  if (!body.ok) return body.response;
  const res = await assignSeat(g.user.id, batchId, seatId, body.data.contact);
  return res.ok ? json(res) : jsonError(STATUS[res.code] ?? 422, res.code, res.code);
}
