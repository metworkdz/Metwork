/**
 * POST /api/startups/:id/contact
 * Investor sends a contact request to a startup founder.
 * Only admins can see and act on these — they manually connect the two parties.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  message: z.string().min(10).max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: startupId } = await params;
  const startup = await findStartupById(startupId);
  if (!startup || startup.status !== 'ACTIVE') {
    return jsonError(404, 'NOT_FOUND', 'Startup not found');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();

  const contact = await db.update((d) => {
    if (!Array.isArray(d.investorContacts)) d.investorContacts = [];

    // Prevent duplicate pending requests for the same (investor, startup) pair.
    const existing = d.investorContacts.find(
      (c) => c.investorId === guard.user.id && c.startupId === startupId && c.status === 'PENDING',
    );
    if (existing) return existing;

    // Look up founder name.
    const founder = d.users.find((u) => u.id === startup.founderId);

    const record = {
      id: randomUUID(),
      investorId:    guard.user.id,
      investorName:  guard.user.fullName,
      investorEmail: guard.user.email,
      startupId,
      startupName:   startup.name,
      founderName:   founder?.fullName ?? 'Unknown',
      message:       input.message,
      status:        'PENDING' as const,
      adminNote:     null,
      createdAt:     now,
      updatedAt:     now,
    };
    d.investorContacts.push(record);
    return record;
  });

  return json({ id: contact.id, status: contact.status }, { status: 201 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: startupId } = await params;
  const data = await db.read();
  const request = (data.investorContacts ?? []).find(
    (c) => c.investorId === guard.user.id && c.startupId === startupId,
  );

  return json({ request: request ?? null });
}
