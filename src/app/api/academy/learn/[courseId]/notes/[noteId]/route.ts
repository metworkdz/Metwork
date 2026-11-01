/** PATCH / DELETE /api/academy/learn/{courseId}/notes/{noteId} — the learner's own note only. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, noContent } from '@/server/http/json';
import { academyRepo } from '@/server/academy/repo';
import { NOTE_MAX } from '@/server/academy/qa';
import { learnerError, parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseId: string; noteId: string }> };
const schema = z.object({ body: z.string().trim().min(1).max(NOTE_MAX) });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { noteId } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  // The repo matches on the owner too: another learner's note id is "not found".
  return (await academyRepo().updateNote(g.user.id, noteId, body.data.body)) ? json({ ok: true }) : learnerError('NOT_FOUND');
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { noteId } = await params;
  return (await academyRepo().deleteNote(g.user.id, noteId)) ? noContent() : learnerError('NOT_FOUND');
}
