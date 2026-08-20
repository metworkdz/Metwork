/**
 * GET  /api/metworkcrm/contacts — list with filters (status, organizationId, q)
 * POST /api/metworkcrm/contacts — create, optionally with an initial organization-link set
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { contactInputSchemaRefined, contactListQuerySchema } from '@/server/metworkcrm/validation/contacts';
import { createContact, listContacts } from '@/server/metworkcrm/services/contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = contactListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listContacts(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = contactInputSchemaRefined.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const contact = await createContact(parsed.data, guard.user.id);
    return json(contact, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
