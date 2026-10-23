/** GET /api/admin/message-reports — reported conversations, open first. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const data = await db.read();
  const who = (id: string) => {
    const u = data.users.find((x) => x.id === id);
    return { id, name: u?.fullName ?? '—', email: u?.email ?? null, status: u?.status ?? null };
  };
  const reports = [...(data.messageReports ?? [])]
    .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'OPEN' ? -1 : 1))
    .slice(0, 200)
    .map((r) => ({ ...r, reporter: who(r.reporterId), reported: who(r.reportedId) }));
  return json({ reports });
}
