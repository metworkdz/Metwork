/**
 * POST /api/consultant/programs/[id]/certificates/send — body { registrationIds?, skip? }
 *
 * Emails the e-mail version of each certificate, a batch per call; the
 * response says how many remain.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleSendCertificates } from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleSendCertificates(req, id, mentorScope(guard.mentorId));
}
