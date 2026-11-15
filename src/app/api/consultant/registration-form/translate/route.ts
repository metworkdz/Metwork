/**
 * POST /api/consultant/registration-form/translate
 * Draft translations of the questions the builder sends. Stores nothing.
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { handleTranslateForm } from '@/server/registrations/translate-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return handleTranslateForm(req, `mentor:${guard.mentorId}`);
}
