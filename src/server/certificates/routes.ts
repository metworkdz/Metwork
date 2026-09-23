/**
 * HTTP handlers for a program's certificate settings and live preview.
 *
 * The incubator dashboard and the consultant portal answer through these same
 * handlers — the route files only resolve the owner — so the two surfaces
 * cannot drift into different certificate features.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { OwnerScope } from '@/server/registrations/service';

import { renderCertificatesPdf } from './render';
import { certificateSettingsSchema } from './schema';
import { loadCertificateSetup, previewName, saveCertificateSettings } from './service';

function ownerKey(owner: OwnerScope): string {
  return owner.kind === 'MENTOR' ? `m:${owner.mentorId}` : `i:${owner.incubatorId}`;
}

export async function handleGetCertificateSettings(programId: string, owner: OwnerScope) {
  const setup = await loadCertificateSetup(programId, owner);
  // Not found for another owner's program too — a stranger learns nothing.
  if (!setup) return jsonError(404, 'NOT_FOUND', 'Program not found');
  return json({
    settings: setup.settings,
    saved: setup.saved,
    context: setup.context,
    hasStamp: Boolean(setup.stampUrl),
    sampleName: await previewName(programId),
  });
}

async function readJson(req: NextRequest): Promise<unknown | Response> {
  try { return await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
}

export async function handlePutCertificateSettings(req: NextRequest, programId: string, owner: OwnerScope) {
  const body = await readJson(req);
  if (body instanceof Response) return body;

  let settings;
  try { settings = certificateSettingsSchema.parse((body as { settings?: unknown })?.settings); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const saved = await saveCertificateSettings(programId, owner, settings);
  if (!saved) return jsonError(404, 'NOT_FOUND', 'Program not found');
  return json({ settings, saved: true });
}

const previewSchema = z.object({
  settings: certificateSettingsSchema,
  mode: z.enum(['PRINT', 'DIGITAL']).default('PRINT'),
});

/**
 * One certificate, drawn from the settings as they stand in the editor —
 * saved or not — with a real participant's name.
 *
 * The preview IS the renderer: the same code that issues the certificates
 * draws it, so what the host approves is what prints. Rate-limited per owner,
 * because the editor calls it as the host types.
 */
export async function handleCertificatePreview(req: NextRequest, programId: string, owner: OwnerScope) {
  if (!(await checkRateLimitDistributed(`certificate-preview:${ownerKey(owner)}`, 90, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop d’aperçus demandés. Patientez quelques secondes.');
  }

  const body = await readJson(req);
  if (body instanceof Response) return body;

  let input;
  try { input = previewSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const setup = await loadCertificateSetup(programId, owner);
  if (!setup) return jsonError(404, 'NOT_FOUND', 'Program not found');

  const pdf = await renderCertificatesPdf({
    settings: input.settings,
    context: setup.context,
    recipients: [{
      fullName: await previewName(programId),
      // A sample number, so the host sees where it prints — never a real one.
      number: 'ATT-0000-0000',
      verifyUrl: 'https://metwork.dz',
    }],
    mode: input.mode,
    logoUrl: setup.logoUrl,
    stampUrl: setup.stampUrl,
  });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="apercu-attestation.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
