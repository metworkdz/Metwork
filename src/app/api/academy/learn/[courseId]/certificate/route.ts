/**
 * GET  /api/academy/learn/{courseId}/certificate — progress towards the certificate, and the certificate if issued.
 * POST /api/academy/learn/{courseId}/certificate — claim it (issued once; the learner is emailed the PDF).
 */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { courseReach } from '@/server/academy/access';
import { activeCertificate, certificateProgress, claimCertificate } from '@/server/academy/certificates';
import { notifyCertificateIssued } from '@/server/academy/notify';
import { isAcademyId, learnerError, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ courseId: string }> };

function certView(c: { id: string; number: string; issuedAt: string; verifyToken: string }) {
  return { id: c.id, number: c.number, issuedAt: c.issuedAt, verifyPath: `/attestation/${c.verifyToken}` };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const reach = await courseReach(g.user, courseId);
  if (!reach.ok) return learnerError('NOT_FOUND');
  const cert = activeCertificate(reach.d, g.user.id, courseId);
  const progress = reach.access === 'OWNED' || reach.access === 'PASS' ? await certificateProgress(g.user.id, reach.course, reach.d) : null;
  return json({ progress, certificate: cert ? certView(cert) : null });
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:cert:${g.user.id}`, 20, 60 * 60_000);
  if (limited) return limited;
  const res = await claimCertificate(g.user, courseId);
  if (!res.ok) return learnerError(res.code, res.progress ? { progress: res.progress } : undefined);
  // Awaited: on Vercel the lambda freezes once the response is sent.
  if (res.created) await notifyCertificateIssued(res.certificate);
  return json({ certificate: certView(res.certificate) }, { status: res.created ? 201 : 200 });
}
