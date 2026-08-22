/**
 * GET /api/admin/contracts/:id/pdf — a freshly-minted, short-lived link to a
 * signed contract.
 *
 * Minted per request because the stored link expires within minutes. Returns
 * the URL rather than proxying the bytes, keeping this function out of the
 * download path.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { findContractById, getContractPdfUrl } from '@/server/consultant-contracts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!(await findContractById(id))) return jsonError(404, 'NOT_FOUND', 'Contract not found');

  const url = await getContractPdfUrl(id);
  if (!url) return jsonError(404, 'NO_PDF', 'This contract has no signed document yet.');

  return json({ url });
}
