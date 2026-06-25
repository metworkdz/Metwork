/**
 * GET /api/incubator/bookings/[id]/contract?templateId=<id>
 *
 * Generates a filled contract PDF for a SPACE booking the calling incubator
 * owns, using one of the incubator's contract templates. Resolves every
 * whitelisted variable server-side from the booking + client + incubator
 * records, renders the template, and returns the PDF as a download.
 *
 * Read-only: no DB writes, no external side effects beyond the null-safe logo
 * fetch inside the PDF generator.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import { resolveContractIncubator } from '@/server/contracts/service';
import {
  generateContractNumber,
  renderTemplate,
  resolveContractVariables,
} from '@/server/contracts/variables';
import { generateContractPdf } from '@/server/contracts/contract-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await resolveContractIncubator(guard.user);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;
  const templateId = new URL(req.url).searchParams.get('templateId');
  if (!templateId) return jsonError(400, 'MISSING_PARAM', 'templateId is required');

  const data = await db.read();

  const booking = data.bookings.find((b) => b.id === id);
  if (!booking) return jsonError(404, 'NOT_FOUND', 'Booking not found');

  // Contracts are space-only.
  if (booking.itemKind !== 'SPACE') {
    return jsonError(400, 'NOT_A_SPACE_BOOKING', 'Contracts are only available for space bookings');
  }

  // Ownership: the booked space must belong to the calling incubator.
  const space = (data.spaces ?? []).find((s) => s.id === booking.itemId);
  if (!space || space.incubatorId !== inc.id) {
    return jsonError(403, 'FORBIDDEN', 'This booking does not belong to your incubator');
  }

  // Template must belong to the same incubator.
  const template = (data.contractTemplates ?? []).find(
    (c) => c.id === templateId && c.incubatorId === inc.id,
  );
  if (!template) return jsonError(404, 'TEMPLATE_NOT_FOUND', 'Contract template not found');

  const user = booking.userId ? data.users.find((u) => u.id === booking.userId) ?? null : null;
  const contractNumber = generateContractNumber(inc, booking);

  const values = resolveContractVariables({
    booking,
    space,
    incubator: inc,
    user,
    lang: template.language,
    contractNumber,
  });
  const body = renderTemplate(template.body, values);

  let pdf: Buffer;
  try {
    pdf = await generateContractPdf({
      incubator: inc,
      lang: template.language,
      contractNumber,
      body,
    });
  } catch {
    return jsonError(500, 'PDF_FAILED', 'Failed to generate the contract PDF');
  }

  const filename = `contract-${contractNumber}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
