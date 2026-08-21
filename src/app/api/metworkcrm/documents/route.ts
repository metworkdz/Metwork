/** POST /api/metworkcrm/documents — attach an already-uploaded file to one entity */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { documentAttachSchema } from '@/server/metworkcrm/validation/documents';
import { attachDocument } from '@/server/metworkcrm/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = documentAttachSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const doc = await attachDocument(parsed.data, guard.user.id);
    return json(doc, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
