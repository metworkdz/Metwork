/**
 * GET  /api/cms/landing — public; returns current landing content (or defaults).
 * PUT  /api/cms/landing — admin-only; replaces landing content.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { getLandingContent, updateLandingContent } from '@/server/cms/service';
import { landingContentSchema } from '@/server/cms/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const content = await getLandingContent();
  return json(content);
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = landingContentSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await updateLandingContent(input);
  return json(updated);
}
