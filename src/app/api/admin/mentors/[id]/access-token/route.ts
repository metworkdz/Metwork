/**
 * Durable consultant access token — ADMIN only.
 *
 *   POST   /api/admin/mentors/:id/access-token  → (re)generate. Returns the raw
 *          token ONCE so the admin can copy/share the link out-of-band. Rotating
 *          invalidates the previous link and all remembered devices.
 *   DELETE /api/admin/mentors/:id/access-token  → revoke durable access entirely.
 *
 * Only the SHA-256 hash is ever stored; the plaintext is never persisted and
 * never returned again after this call.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { generateMentorAccessToken, revokeMentorAccessToken } from '@/server/mentors/access';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await generateMentorAccessToken(id);
  if (!result) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');

  return json({
    mentorId: id,
    // Shown ONCE — the admin shares this link manually. Never returned again.
    token: result.token,
    rotatedAt: result.mentor.accessTokenRotatedAt ?? null,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const ok = await revokeMentorAccessToken(id);
  if (!ok) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  return json({ mentorId: id, revoked: true });
}
