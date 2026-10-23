/** POST /api/cofounder/matches/[id]/chat — open the conversation of a match (paid plan on either side). */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { openMatchChat } from '@/server/cofounder/service';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return withCofounder(async () => {
    const r = await openMatchChat(guard.user.id, id);
    if (r.ok) return json({ conversationId: r.conversationId });
    return r.reason === 'UPGRADE_REQUIRED'
      ? jsonError(402, 'UPGRADE_REQUIRED', 'A paid plan opens the chat')
      : jsonError(404, 'NOT_FOUND', 'Match not found');
  });
}
