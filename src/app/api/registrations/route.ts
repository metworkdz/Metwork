/**
 * POST /api/registrations
 *
 * Public endpoint — no authentication required for guests.
 * Authenticated users may submit with their session attached.
 *
 * Rate-limited: 5 submissions per IP per 10 minutes.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createRegistration } from '@/server/registrations/service';
import { readSession } from '@/server/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registrationSchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId:   z.string().uuid(),
  fullName:   z.string().min(2).max(120).transform((s) => s.trim()),
  email:      z.string().email().transform((s) => s.trim().toLowerCase()),
  phone:      z.string().min(6).max(30).transform((s) => s.trim()),
  answers:    z.array(
    z.object({
      fieldId: z.string().uuid(),
      value:   z.union([z.string(), z.array(z.string())]),
    }),
  ).default([]),
});

export async function POST(req: NextRequest) {
  // Rate limit: 5 attempts per IP per 10 minutes (600 000 ms)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`reg:${ip}`, 5, 10 * 60_000)) {
    return jsonError(429, 'RATE_LIMITED', 'Too many registration attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = registrationSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Verify the entity exists and is active
  const data = await db.read();
  if (input.entityType === 'PROGRAM') {
    const prog = (data.programs ?? []).find((p) => p.id === input.entityId && p.isActive);
    if (!prog) return jsonError(404, 'NOT_FOUND', 'Program not found or inactive');
    // Deadline check
    if (new Date(prog.deadline) < new Date()) {
      return jsonError(409, 'DEADLINE_PASSED', 'The application deadline has passed');
    }
  } else {
    const ev = (data.events ?? []).find((e) => e.id === input.entityId && e.isActive);
    if (!ev) return jsonError(404, 'NOT_FOUND', 'Event not found or inactive');
    // Past event check
    if (new Date(ev.eventDate) < new Date()) {
      return jsonError(409, 'EVENT_PASSED', 'This event has already taken place');
    }
  }

  // Validate required custom field answers
  const formFields = (data.registrationFormFields ?? []).filter(
    (f) => f.entityType === input.entityType && f.entityId === input.entityId,
  );
  for (const field of formFields) {
    if (!field.required) continue;
    const answer = input.answers.find((a) => a.fieldId === field.id);
    const missing =
      !answer ||
      (Array.isArray(answer.value) ? answer.value.length === 0 : !String(answer.value).trim());
    if (missing) {
      return jsonError(422, 'MISSING_REQUIRED_FIELD', `Field "${field.label}" is required`, {
        fieldId: field.id,
      });
    }
  }

  // Authenticated user session (optional)
  const session = await readSession();
  const userId = session?.user?.id ?? null;

  const { registration, alreadyRegistered } = await createRegistration({
    entityType: input.entityType,
    entityId: input.entityId,
    userId,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    answers: input.answers,
  });

  if (alreadyRegistered) {
    return json(
      {
        registration,
        message: 'You are already registered for this event.',
        alreadyRegistered: true,
      },
      { status: 200 },
    );
  }

  return json({ registration, alreadyRegistered: false }, { status: 201 });
}
