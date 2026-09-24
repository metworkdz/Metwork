/**
 * GET   /api/consultant/programs/[id]/certificates/participants — confirmed participants, with
 *       attendance, civility, balance still due and certificate status
 * PATCH /api/consultant/programs/[id]/certificates/participants — body { registrationId, absent?, civility? }
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleListCertificateParticipants, handleUpdateCertificateParticipant } from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleListCertificateParticipants(id, mentorScope(guard.mentorId));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleUpdateCertificateParticipant(req, id, mentorScope(guard.mentorId));
}
