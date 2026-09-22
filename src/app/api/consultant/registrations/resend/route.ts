/**
 * POST /api/consultant/registrations/resend — body { id }
 *
 * Send the confirmation and the stamped receipt again. Same handler as the
 * incubator surface, scoped to the acting consultant.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleResendRegistration } from '@/server/registrations/edit-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  return handleResendRegistration(req, mentorScope(guard.mentorId));
}
