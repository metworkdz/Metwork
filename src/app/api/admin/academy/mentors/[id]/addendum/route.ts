/**
 * POST /api/admin/academy/mentors/{id}/addendum — draft the mentor's Academy
 * addendum (their share written in). The admin then reviews and sends it from
 * the Contracts page; the mentor signs it in their portal.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { prepareAcademyAddendum } from '@/server/academy/addendum';
import { requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const res = await prepareAcademyAddendum(id, g.admin.id);
  if (!res.ok) {
    const status = res.code === 'CONSULTANT_NOT_FOUND' ? 404 : 409;
    return jsonError(status, res.code, res.code, res.missing ? { missing: res.missing } : undefined);
  }
  return json(res, { status: 201 });
}
