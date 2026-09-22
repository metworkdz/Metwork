/**
 * POST /api/consultant/registrations/edit — body { id, fullName?, email?, phone? }
 *
 * Same handler and same contract as the incubator surface; only the owner
 * scope differs, exactly as for the list and the desk participant.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleEditRegistration } from '@/server/registrations/edit-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  return handleEditRegistration(req, mentorScope(guard.mentorId));
}
