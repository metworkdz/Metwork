/**
 * GET  /api/consultant/academy — the mentor's Studio: courses, stats, addendum state
 * POST /api/consultant/academy — open a draft { title, fieldId }
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { createCourseSchema } from '@/server/academy/catalog';
import { createMentorCourse, getStudioOverview } from '@/server/academy/studio';
import { parseBody, requireStudioMentor, studioError } from '@/server/academy/http';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { getAcademyPricing, listAcademyFields } from '@/server/academy/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The mentor is always the course's mentor: no mentorIds from the request.
const schema = createCourseSchema.pick({ title: true, fieldId: true });

export async function GET() {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const [overview, fields, pricing] = await Promise.all([getStudioOverview(g.mentorId), listAcademyFields(), getAcademyPricing()]);
  // What the builder needs besides the course: the fields to pick from, and
  // the Premium rate for the price preview.
  return json({
    ...overview,
    fields: fields.map((f) => ({ id: f.id, label: f.label ?? null })),
    premiumDiscountRate: pricing.premiumDiscountRate,
  });
}

export async function POST(req: NextRequest) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  if (!(await checkRateLimitDistributed(`academy:studio:create:${g.mentorId}`, 20, 24 * 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many new courses today.');
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await createMentorCourse(g.mentorId, body.data);
  if (!res.ok) return studioError(res.code);
  return json({ id: res.value.id }, { status: 201 });
}
