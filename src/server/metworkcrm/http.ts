/**
 * METWORK OS CRM — shared route-handler helpers.
 */
import { jsonError } from '@/server/http/json';
import type { NextResponse } from 'next/server';
import { CrmServiceError } from './services/errors';

/** Map a thrown CrmServiceError (or anything else) to a JSON error response. */
export function crmErrorResponse(err: unknown): NextResponse {
  if (err instanceof CrmServiceError) {
    return jsonError(err.status, err.code, err.message, err.details);
  }
  console.error('[metworkcrm] unhandled route error:', err);
  return jsonError(500, 'CRM_INTERNAL_ERROR', 'Une erreur interne est survenue.');
}

/** Safely parse a request body as JSON, returning null (not throwing) on malformed input. */
export async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
