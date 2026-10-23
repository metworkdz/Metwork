/** GET /api/messages/attachables — documents and payment links the caller can share in a thread. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { attachables } from '@/server/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  return json(await attachables(guard.user.id));
}
