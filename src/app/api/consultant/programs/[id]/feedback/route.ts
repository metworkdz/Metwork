/**
 * GET  /api/consultant/programs/[id]/feedback — the form (or the default questions); PUT — save it
 *
 * Consultant portal — the handlers are shared, in @/server/feedback/routes.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope, type OwnerScope } from '@/server/registrations/service';
import { handleGetFeedbackForm, handleSaveFeedbackForm } from '@/server/feedback/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function owner(): Promise<OwnerScope | Response> {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return mentorScope(guard.mentorId);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const o = await owner();
  if (o instanceof Response) return o;
  const { id } = await params;
  return handleGetFeedbackForm(req, id, o);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const o = await owner();
  if (o instanceof Response) return o;
  const { id } = await params;
  return handleSaveFeedbackForm(req, id, o);
}
