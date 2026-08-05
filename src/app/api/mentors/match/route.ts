/**
 * POST /api/mentors/match — AI-assisted mentor recommendation from a
 * free-text problem description. Public — no auth required, works for
 * both authenticated and unauthenticated callers (a match has no
 * user-specific data).
 *
 * Non-blocking by design: ANY failure (missing API key, network error,
 * malformed response, rate limit) returns `{ matches: [] }` with a 200 —
 * never a 4xx/5xx that the client would need special-case handling for.
 * Same pattern as the existing Zoom/WhatsApp/email integrations — a
 * failure here degrades to plain category browsing, it never blocks the
 * page. See `src/server/integrations/anthropic-mentor-match.ts`.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { listPublicMentors } from '@/server/mentors/service';
import { listActiveMentorCategories } from '@/server/mentor-categories/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { resolveMentorCard } from '@/lib/mentor-directory';
import { matchMentorsViaClaude } from '@/server/integrations/anthropic-mentor-match';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isLocale, defaultLocale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  query: z.string().min(1).max(500),
  locale: z.string().optional(),
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
  if (!(await checkRateLimitDistributed(`mentor-match:${ip}`, 5, 60_000))) {
    // Rate limit hit — the client treats any non-success the same way
    // (fail silently), so a plain 429 is fine here.
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
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

  const locale = isLocale(input.locale ?? '') ? (input.locale as typeof defaultLocale) : defaultLocale;

  try {
    const [mentors, categories] = await Promise.all([
      listPublicMentors().then((list) => list.map(toMentorDto)),
      listActiveMentorCategories(),
    ]);
    const roster = mentors.map((m) => resolveMentorCard(m, categories, locale));

    const matches = await matchMentorsViaClaude(input.query.trim(), roster, locale);
    return json({ matches });
  } catch (err) {
    // Non-blocking: never let a match failure disturb the page. Fall back
    // to no recommendation — the grid behaves like plain category browsing.
    // eslint-disable-next-line no-console
    console.error('[anthropic-mentor-match] match failed, falling back to no matches →', err instanceof Error ? err.message : err);
    return json({ matches: [] });
  }
}
