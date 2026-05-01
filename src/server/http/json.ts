/**
 * Small response helpers. The error envelope shape mirrors the one the
 * frontend `apiClient` already destructures: `{ error: { code, message, details? } }`.
 */
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, details } }, { status });
}

export function fromZod(err: ZodError): NextResponse {
  return jsonError(422, 'VALIDATION_ERROR', 'Invalid input', {
    fieldErrors: err.flatten().fieldErrors,
  });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
