/**
 * GET /api/consultant/registrations/:id/files/:fieldId[?download=1]
 *
 * Open the file a participant attached to a registration for one of THIS
 * consultant's programs. Owner-only: see `@/server/registrations/file-route`.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleRegistrationFile } from '@/server/registrations/file-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id, fieldId } = await params;
  return handleRegistrationFile(req, mentorScope(guard.mentorId), id, fieldId);
}
