/** GET /api/academy/certificates/{id}/pdf — the learner's own certificate as a PDF. */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { renderAcademyCertificatePdf } from '@/server/academy/certificates';
import { isAcademyId, learnerError, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isAcademyId(id)) return learnerError('NOT_FOUND');
  const cert = (await db.read()).academyCertificates?.find((c) => c.id === id);
  // Someone else's certificate is "not found", never "forbidden".
  if (!cert || cert.revokedAt || (cert.userId !== g.user.id && g.user.role !== 'ADMIN')) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:cert-pdf:${g.user.id}`, 30, 60 * 60_000);
  if (limited) return limited;
  const pdf = await renderAcademyCertificatePdf(cert);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cert.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
