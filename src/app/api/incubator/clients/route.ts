/**
 * GET  /api/incubator/clients  — list clients (newest first)
 * POST /api/incubator/clients  — create a client
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type ClientRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  fullName:     z.string().min(2).max(120),
  // Email & phone are optional in the CRM "add client" form (a name-only record
  // is valid). Stored as '' when omitted, matching ClientRecord and the
  // find-or-create in the manual-bookings route.
  email:        z.string().email().max(200).optional().nullable(),
  phone:        z.string().min(6).max(30).optional().nullable(),
  idCardNumber: z.string().max(30).optional().nullable(),
  companyName:  z.string().max(120).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const data = await db.read();
  const clients = (data.clients ?? [])
    .filter((c) => c.incubatorId === inc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items: clients, total: clients.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = (input.email ?? '').trim().toLowerCase();
  const phone = (input.phone ?? '').trim();
  const now = new Date().toISOString();
  const record = await db.update<ClientRecord>((d) => {
    if (!Array.isArray(d.clients)) d.clients = [];
    // Dedup by email within this incubator — but only when an email is given.
    // Name-only clients (empty email) must never collapse into one another.
    if (email) {
      const existing = d.clients.find(
        (c) => c.incubatorId === inc.id && c.email.toLowerCase() === email,
      );
      if (existing) return existing; // idempotent — return existing if same email
    }

    const client: ClientRecord = {
      id:           randomUUID(),
      incubatorId:  inc.id,
      fullName:     input.fullName.trim(),
      email,
      phone,
      idCardNumber: input.idCardNumber ?? null,
      companyName:  input.companyName ?? null,
      notes:        input.notes ?? null,
      createdAt:    now,
      updatedAt:    now,
    };
    d.clients.push(client);
    return client;
  });

  return json(record, { status: 201 });
}
