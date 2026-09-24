/**
 * POST /api/consultant/programs/[id]/certificates/download — body { mode, registrationIds? }
 *
 * Issues the certificates (numbers are fixed at first issue) and returns them
 * as one PDF, one page each.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleDownloadCertificates } from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleDownloadCertificates(req, id, mentorScope(guard.mentorId));
}
