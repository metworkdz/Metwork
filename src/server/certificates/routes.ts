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
import {
  certificateFilename,
  issueCertificates,
  listCertificateParticipants,
  MAX_CERTIFICATES_PER_BATCH,
  renderIssuedCertificates,
  updateCertificateParticipant,
} from './issue';
import { SEND_BATCH, sendCertificates } from './send';
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

/* ─────────────────────────── Issuing ─────────────────────────── */

const ISSUE_REFUSAL: Record<'NOT_FOUND' | 'NOT_SAVED' | 'NONE' | 'TOO_MANY', [number, string]> = {
  NOT_FOUND: [404, 'Program not found'],
  NOT_SAVED: [409, 'Enregistrez le modèle d’attestation avant de les émettre.'],
  NONE: [409, 'Aucun participant présent à qui émettre une attestation.'],
  TOO_MANY: [413, 'Trop d’attestations en une fois.'],
};

function refusal(reason: keyof typeof ISSUE_REFUSAL) {
  const [status, message] = ISSUE_REFUSAL[reason];
  return jsonError(status, reason, message);
}

async function parseBody<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S> | Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try { return schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}

const registrationId = z.string().trim().min(1).max(64);

export async function handleListCertificateParticipants(programId: string, owner: OwnerScope) {
  const list = await listCertificateParticipants(programId, owner);
  if (!list) return jsonError(404, 'NOT_FOUND', 'Program not found');
  return json(list);
}

const participantPatchSchema = z.object({
  registrationId,
  absent: z.boolean().optional(),
  civility: z.enum(['M.', 'Mme']).nullable().optional(),
}).refine((p) => p.absent !== undefined || p.civility !== undefined, { message: 'Nothing to change' });

export async function handleUpdateCertificateParticipant(req: NextRequest, programId: string, owner: OwnerScope) {
  const input = await parseBody(req, participantPatchSchema);
  if (input instanceof Response) return input;
  const participant = await updateCertificateParticipant(programId, owner, input.registrationId, {
    absent: input.absent,
    civility: input.civility,
  });
  // Another owner's program, or someone who is not a confirmed participant.
  if (!participant) return jsonError(404, 'NOT_FOUND', 'Participant not found');
  return json({ participant });
}

const downloadSchema = z.object({
  mode: z.enum(['PRINT', 'DIGITAL']).default('PRINT'),
  /** Omitted: every present participant, in one PDF. */
  registrationIds: z.array(registrationId).min(1).max(MAX_CERTIFICATES_PER_BATCH).optional(),
});

/**
 * Issue and download certificates as one PDF — a single participant's, or
 * everybody's, one page each. Downloading is what issues: a participant's
 * number is fixed the first time their certificate leaves the platform.
 */
export async function handleDownloadCertificates(req: NextRequest, programId: string, owner: OwnerScope) {
  if (!(await checkRateLimitDistributed(`certificate-download:${ownerKey(owner)}`, 30, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop de téléchargements. Patientez un instant.');
  }
  const input = await parseBody(req, downloadSchema);
  if (input instanceof Response) return input;

  const result = await issueCertificates(programId, owner, input.registrationIds);
  if (!result.ok) return refusal(result.reason);

  const pdf = await renderIssuedCertificates(result.setup, result.issued, input.mode);
  const only = result.issued.length === 1 ? result.issued[0] : null;
  const filename = only
    ? certificateFilename(`Attestation - ${only.certificate.fullName}`)
    : certificateFilename(`Attestations - ${result.setup.program.title}`);

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Certificates-Issued': String(result.issued.length),
    },
  });
}

const sendSchema = z.object({
  /** Given: resend to exactly these. Omitted: everyone not yet sent one. */
  registrationIds: z.array(registrationId).min(1).max(SEND_BATCH).optional(),
  /** Already failed in this run — not retried in a loop. */
  skip: z.array(registrationId).max(MAX_CERTIFICATES_PER_BATCH).optional(),
});

export async function handleSendCertificates(req: NextRequest, programId: string, owner: OwnerScope) {
  // Each call sends up to SEND_BATCH emails from our domain to addresses the
  // host typed in; the ceiling keeps a host from turning it into a mailer.
  if (!(await checkRateLimitDistributed(`certificate-send:${ownerKey(owner)}`, 40, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop d’envois cette heure-ci. Réessayez plus tard.');
  }
  const input = await parseBody(req, sendSchema);
  if (input instanceof Response) return input;

  const result = await sendCertificates(programId, owner, input);
  if (!result.ok) return refusal(result.reason);
  return json({ sent: result.sent, failed: result.failed, remaining: result.remaining });
}
