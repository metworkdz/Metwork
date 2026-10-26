/** PUT /api/admin/academy/mentors/{id}/share — { rate: 0.35 } sets the mentor's own share; { rate: null } returns to the default. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { setMentorAcademyShare } from '@/server/academy/settings';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ rate: z.number().nullable() });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await setMentorAcademyShare(id, body.data.rate, g.admin);
  if (!res.ok) return jsonError(res.code === 'MENTOR_NOT_FOUND' ? 404 : 422, res.code, res.code);
  return json({ ok: true });
}
