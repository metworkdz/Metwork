/**
 * Consultant-owned programs.
 *
 *   GET  /api/consultant/programs — this consultant's programs (all states).
 *   POST /api/consultant/programs — create one.
 *
 * Deliberately mirrors `/api/incubator/programs`: same record, same validation
 * shape, same slug rules, same catalog readers. The ONLY difference is which
 * population owns the row — resolved through `@/server/programs/ownership`, so
 * authorization can never drift between the two surfaces.
 *
 * Money model: none here. Paid consultant programs are not settleable yet (the
 * card/wallet paths reject mentor-owned rows rather than settle to nobody), so
 * creation is capped at free until the mentor-ledger wiring lands.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db, type ProgramRecord } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { listProgramsByMentor } from '@/server/bookings/program-catalog';
import { isMentorApproved } from '@/lib/mentor-approval';
import { fromZod, json, jsonError } from '@/server/http/json';
import { slugify, uniqueSlug } from '@/lib/slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createProgramSchema = z.object({
  title:       z.string().min(2).max(120),
  description: z.string().min(10).max(2000),
  type:        z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP', 'WEBINAR']),
  city:        z.string().min(1).max(80),
  imageUrl:    z.string().url().optional().nullable(),
  imageUrls:   z.array(z.string().url()).max(8).optional(),
  /**
   * Free only, for now. A paid consultant program would have to settle into the
   * mentor ledger, which is not wired yet — accepting a price here would let a
   * consultant advertise a fee nobody can actually collect.
   */
  price:       z.literal(0).default(0),
  seatsTotal:  z.number().int().min(1).max(10_000),
  deadline:    z.string().datetime(),
  startDate:   z.string().datetime(),
  endDate:     z.string().datetime(),
  slug:        z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
}).refine(
  (d) => d.deadline <= d.startDate && d.startDate < d.endDate,
  { message: 'deadline must be ≤ startDate, and startDate must be < endDate' },
);

export async function GET() {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const programs = await listProgramsByMentor(guard.mentorId);
  return json({ items: programs, total: programs.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  // Same gate the public surfaces use: an unapproved consultant's programs
  // would be invisible anyway, so refuse rather than create dead rows.
  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'MENTOR_NOT_FOUND', 'Consultant profile not found');
  if (!isMentorApproved(mentor)) {
    return jsonError(403, 'ACCOUNT_PENDING', 'Your consultant profile is awaiting approval.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createProgramSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const imageUrls = input.imageUrls?.length ? input.imageUrls : (input.imageUrl ? [input.imageUrl] : []);
  const coverUrl = imageUrls[0] ?? null;

  const now = new Date().toISOString();
  const record = await db.update<ProgramRecord>((d) => {
    if (!Array.isArray(d.programs)) d.programs = [];

    // Slug uniqueness is scoped per consultant, mirroring the per-incubator rule.
    const existingSlugs = d.programs
      .filter((p) => p.mentorId === guard.mentorId && p.slug)
      .map((p) => p.slug as string);
    const baseSlug = input.slug ? input.slug : slugify(input.title.trim());
    const slug = uniqueSlug(baseSlug, existingSlugs);

    const prog: ProgramRecord = {
      id:                     randomUUID(),
      incubatorId:            null,
      incubatorName:          '',
      mentorId:               guard.mentorId,
      mentorName:             mentor.fullName,
      title:                  input.title.trim(),
      description:            input.description.trim(),
      type:                   input.type,
      city:                   input.city.trim(),
      imageUrl:               coverUrl,
      imageUrls,
      price:                  0,
      onlinePrice:            null,
      cashPrice:              null,
      seatsTotal:             input.seatsTotal,
      deadline:               input.deadline,
      startDate:              input.startDate,
      endDate:                input.endDate,
      // Free programs collect no money, so no payment method applies. The
      // registration flow (POST /api/registrations) is the enrolment path.
      acceptedPaymentMethods: [],
      isActive:               true,
      slug,
      createdAt:              now,
      updatedAt:              now,
    };
    d.programs.push(prog);
    return prog;
  });

  return json(record, { status: 201 });
}
