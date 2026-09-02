/**
 * POST /api/contact
 * Public — no auth required.
 * Saves the submission to the DB and fires an admin email notification.
 */
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { sendContactNotification } from '@/server/notifications/mock';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(200),
  message: z.string().min(10).max(2000),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`contact:${ip}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many contact submissions. Please try again later.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  await db.update((store) => {
    store.contactSubmissions.push({
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      message: input.message,
      createdAt: new Date().toISOString(),
    });
  });

  await sendContactNotification(input);

  return json({ ok: true }, { status: 201 });
}
