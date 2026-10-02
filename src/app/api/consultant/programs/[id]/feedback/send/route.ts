/**
 * POST /api/consultant/programs/[id]/feedback/send — body { registrationIds?, skip? }; one batch per call
 *
 * Consultant portal — the handlers are shared, in @/server/feedback/routes.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope, type OwnerScope } from '@/server/registrations/service';
import { handleSendFeedback } from '@/server/feedback/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function owner(): Promise<OwnerScope | Response> {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return mentorScope(guard.mentorId);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const o = await owner();
  if (o instanceof Response) return o;
  const { id } = await params;
  return handleSendFeedback(req, id, o);
}
