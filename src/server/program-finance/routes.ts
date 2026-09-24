/**
 * HTTP handlers for a program's finances. The incubator and consultant route
 * files only resolve the owner; everything else is here, once.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { isAllowedCertificateImageUrl } from '@/server/certificates/images';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { OwnerScope } from '@/server/registrations/service';

import {
  buildProgramFinanceCsv,
  financeFilename,
  normalizeExportLang,
  renderProgramFinancePdf,
} from './export';
import {
  createProgramExpense,
  deleteProgramExpense,
  loadProgramFinances,
  updateProgramExpense,
} from './service';

/** A real calendar day, not just the right shape — "2026-02-31" is refused. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Date invalide');

/**
 * A receipt must have been uploaded through the platform — the same rule as
 * certificate signatures: https, our own Cloudinary account.
 */
const receiptUrl = z.string().trim().max(500)
  .refine((u) => isAllowedCertificateImageUrl(u), 'Le justificatif doit être importé sur Metwork')
  .nullable();

const expenseSchema = z.object({
  date: day,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // Integer DZD. The ceiling only stops a typo from swallowing the report.
  amount: z.number().int().min(1).max(1_000_000_000),
  category: z.string().max(80).nullable().optional(),
  receiptUrl: receiptUrl.optional(),
});

const patchSchema = expenseSchema.partial().refine(
  (p) => Object.keys(p).length > 0,
  { message: 'Nothing to change' },
);

async function parse<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S> | Response> {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  try { return schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}

export async function handleGetProgramFinances(programId: string, owner: OwnerScope) {
  const finances = await loadProgramFinances(programId, owner);
  if (!finances) return jsonError(404, 'NOT_FOUND', 'Program not found');
  return json(finances);
}

export async function handleCreateProgramExpense(req: NextRequest, programId: string, owner: OwnerScope) {
  const input = await parse(req, expenseSchema);
  if (input instanceof Response) return input;
  const expense = await createProgramExpense(programId, owner, input);
  if (!expense) return jsonError(404, 'NOT_FOUND', 'Program not found');
  return json({ expense }, { status: 201 });
}

export async function handleUpdateProgramExpense(
  req: NextRequest,
  programId: string,
  expenseId: string,
  owner: OwnerScope,
) {
  const input = await parse(req, patchSchema);
  if (input instanceof Response) return input;
  const expense = await updateProgramExpense(programId, owner, expenseId, input);
  if (!expense) return jsonError(404, 'NOT_FOUND', 'Expense not found');
  return json({ expense });
}

export async function handleDeleteProgramExpense(programId: string, expenseId: string, owner: OwnerScope) {
  const deleted = await deleteProgramExpense(programId, owner, expenseId);
  if (!deleted) return jsonError(404, 'NOT_FOUND', 'Expense not found');
  return json({ ok: true });
}

/**
 * The report as a file: `?format=csv` (in the viewer's language, `?lang=`)
 * or `?format=pdf` (French, like every document the platform issues).
 */
export async function handleExportProgramFinances(req: NextRequest, programId: string, owner: OwnerScope) {
  const key = owner.kind === 'MENTOR' ? `m:${owner.mentorId}` : `i:${owner.incubatorId}`;
  if (!(await checkRateLimitDistributed(`program-finance-export:${key}`, 20, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop d’exports. Patientez un instant.');
  }
  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format');
  if (format !== 'csv' && format !== 'pdf') return jsonError(400, 'INVALID_FORMAT', 'format must be csv or pdf');

  const finances = await loadProgramFinances(programId, owner);
  if (!finances) return jsonError(404, 'NOT_FOUND', 'Program not found');

  const filename = financeFilename(finances.program.title, format);
  const body = format === 'csv'
    ? new TextEncoder().encode(buildProgramFinanceCsv(finances, normalizeExportLang(searchParams.get('lang'))))
    : new Uint8Array(await renderProgramFinancePdf(finances));
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
