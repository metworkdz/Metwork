/**
 * PATCH /api/admin/investor-contacts/:id
 * Update status (PENDING → CONNECTED | DECLINED) and admin note.
 * Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status:    z.enum(['PENDING', 'CONNECTED', 'DECLINED']).optional(),
  adminNote: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    if (!Array.isArray(d.investorContacts)) d.investorContacts = [];
    const contact = d.investorContacts.find((c) => c.id === id);
    if (!contact) return null;
    if (input.status    !== undefined) contact.status    = input.status;
    if (input.adminNote !== undefined) contact.adminNote = input.adminNote;
    contact.updatedAt = new Date().toISOString();
    return contact;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Contact request not found');
  return json({ contact: result });
}
