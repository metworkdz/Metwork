/**
 * GET /api/freelancer/profile — the signed-in freelancer's profile + completion.
 * PUT /api/freelancer/profile — replace the editable fields.
 *
 * Freelancers only. Photo, phone and payout account are edited through their
 * existing endpoints; they count toward completion from the user record.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { computeCompletion } from '@/lib/freelancer-completion';
import { emptyProfile, refreshTrialUnlock, updateFreelancerProfile } from '@/server/freelancers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Images must come from our own upload pipeline (Cloudinary, or /uploads in dev). */
const imageUrl = z
  .string()
  .max(500)
  .refine((u) => u.startsWith('https://res.cloudinary.com/') || /^\/uploads\/[\w\-/.]+$/.test(u), 'invalidImage')
  .nullable();
const externalUrl = z
  .string()
  .max(500)
  .url()
  .refine((u) => u.startsWith('https://'), 'httpsOnly')
  .nullable();

const schema = z.object({
  headline: z.string().max(80).nullable(),
  bio: z.string().max(2000).nullable(),
  skills: z.array(z.string().max(40)).max(20),
  languages: z.array(z.enum(['ar', 'fr', 'en', 'tzm'])).max(4),
  remote: z.boolean(),
  dayRate: z.number().int().min(0).max(10_000_000).nullable(),
  address: z.string().max(200).nullable(),
  portfolio: z
    .array(
      z.object({
        id: z.string().max(60).optional(),
        title: z.string().min(1).max(80),
        imageUrl,
        url: externalUrl,
      }),
    )
    .max(12),
});

async function payload(userId: string) {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  const profile = data.freelancerProfiles?.find((p) => p.userId === userId) ?? emptyProfile(userId, new Date().toISOString());
  if (!user) return null;
  // The stored document reference and extraction are evidence for admins,
  // never sent back to the browser.
  const { legal, ...rest } = profile;
  return {
    profile: {
      ...rest,
      legal: legal
        ? { status: legal.status, documentKind: legal.documentKind, submittedAt: legal.submittedAt, review: legal.review }
        : null,
    },
    completion: computeCompletion(user, profile),
  };
}

export async function GET() {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  // Photo / payout changes happen elsewhere; catch up the unlock on read.
  await refreshTrialUnlock(guard.user.id);
  const body = await payload(guard.user.id);
  if (!body) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json(body);
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`freelancer-profile:${guard.user.id}`, 30, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many updates. Please wait a moment.');
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  await updateFreelancerProfile(guard.user.id, input);
  return json(await payload(guard.user.id));
}
