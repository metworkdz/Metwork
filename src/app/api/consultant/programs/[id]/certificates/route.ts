/**
 * GET / PUT /api/consultant/programs/[id]/certificates
 *
 * Same handlers and contract as the incubator surface; only the owner differs.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import {
  handleGetCertificateSettings,
  handlePutCertificateSettings,
} from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleGetCertificateSettings(id, mentorScope(guard.mentorId));
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handlePutCertificateSettings(req, id, mentorScope(guard.mentorId));
}
