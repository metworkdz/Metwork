/**
 * HTTP handlers for a program's feedback form.
 *
 * The incubator dashboard and the consultant portal answer through these same
 * handlers — the route files only resolve the owner — so the two surfaces
 * cannot drift into different feedback features.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { OwnerScope } from '@/server/registrations/service';

import { FEEDBACK_SEND_BATCH, sendFeedbackInvites } from './send';
import {
  getFeedbackForm,
  getFeedbackResults,
  listFeedbackParticipants,
  rotateSharedFeedbackLink,
  saveFeedbackForm,
} from './service';
import { feedbackUrl, sharedFeedbackToken } from './tokens';
import { FEEDBACK_LIMITS, type FeedbackLang } from './types';

function ownerKey(owner: OwnerScope): string {
  return owner.kind === 'MENTOR' ? `m:${owner.mentorId}` : `i:${owner.incubatorId}`;
}

function langOf(req: NextRequest): FeedbackLang {
  const l = new URL(req.url).searchParams.get('lang');
  return l === 'en' || l === 'ar' ? l : 'fr';
}

const notFound = () => jsonError(404, 'NOT_FOUND', 'Program not found');

async function parseBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T> | Response> {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  try { return schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}

export async function handleGetFeedbackForm(req: NextRequest, programId: string, owner: OwnerScope) {
  const lang = langOf(req);
  const view = await getFeedbackForm(programId, owner, lang);
  if (!view) return notFound();
  const { form } = view;
  // The shared link is only handed out while it is on.
  const sharedUrl = form.id && form.sharedLinkEnabled
    ? feedbackUrl(sharedFeedbackToken(form.id, form.sharedLinkVersion), lang)
    : null;
  return json({ ...view, sharedUrl });
}

const saveSchema = z.object({
  title: z.string().max(FEEDBACK_LIMITS.title),
  intro: z.string().max(FEEDBACK_LIMITS.intro).nullable().optional(),
  isOpen: z.boolean(),
  sharedLinkEnabled: z.boolean(),
  questions: z.array(z.object({
    id: z.string().max(64).nullable().optional(),
    kind: z.enum(['RATING', 'TEXT']),
    label: z.string().max(FEEDBACK_LIMITS.label),
    required: z.boolean(),
  })).min(1).max(FEEDBACK_LIMITS.questions),
});

export async function handleSaveFeedbackForm(req: NextRequest, programId: string, owner: OwnerScope) {
  const input = await parseBody(req, saveSchema);
  if (input instanceof Response) return input;
  const result = await saveFeedbackForm(programId, owner, input);
  if (!result.ok) {
    return result.reason === 'NOT_FOUND'
      ? notFound()
      : jsonError(422, 'INVALID', 'Vérifiez le titre et les questions (une question vide ou en double).');
  }
  return handleGetFeedbackForm(req, programId, owner);
}

export async function handleRotateFeedbackLink(req: NextRequest, programId: string, owner: OwnerScope) {
  const form = await rotateSharedFeedbackLink(programId, owner);
  if (!form) return notFound();
  return handleGetFeedbackForm(req, programId, owner);
}

export async function handleFeedbackParticipants(programId: string, owner: OwnerScope) {
  const items = await listFeedbackParticipants(programId, owner);
  if (!items) return notFound();
  return json({ items });
}

export async function handleFeedbackResults(programId: string, owner: OwnerScope) {
  const view = await getFeedbackResults(programId, owner);
  if (!view) return notFound();
  return json(view);
}

const sendSchema = z.object({
  registrationIds: z.array(z.string().min(1).max(64)).min(1).max(FEEDBACK_SEND_BATCH).optional(),
  skip: z.array(z.string().min(1).max(64)).max(1000).optional(),
});

export async function handleSendFeedback(req: NextRequest, programId: string, owner: OwnerScope) {
  // Each call sends up to a batch of emails from our domain to addresses the
  // host typed in; the ceiling keeps a host from turning it into a mailer.
  if (!(await checkRateLimitDistributed(`feedback-send:${ownerKey(owner)}`, 40, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop d’envois cette heure-ci. Réessayez plus tard.');
  }
  const input = await parseBody(req, sendSchema);
  if (input instanceof Response) return input;

  const result = await sendFeedbackInvites(programId, owner, input);
  if (!result.ok) {
    switch (result.reason) {
      case 'NOT_FOUND': return notFound();
      case 'NOT_SAVED': return jsonError(409, 'NOT_SAVED', 'Enregistrez le questionnaire avant de l’envoyer.');
      case 'CLOSED': return jsonError(409, 'CLOSED', 'Le questionnaire est clôturé : rouvrez-le pour l’envoyer.');
      case 'NONE': return jsonError(409, 'NONE', 'Aucun participant confirmé à qui l’envoyer.');
      case 'TOO_MANY': return jsonError(422, 'TOO_MANY', `${FEEDBACK_SEND_BATCH} personnes au plus à la fois.`);
    }
  }
  return json({ sent: result.sent, failed: result.failed, remaining: result.remaining });
}
