/**
 * Feedback follows what it belongs to out of the store. Kept apart from the
 * service so the registration and program delete paths can call it without
 * importing the feedback service (and its imports) into theirs.
 */
import type { db } from '@/server/db/store';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];


/** A deleted program takes its form, invites and answers with it. */
export function pruneFeedbackForProgramSync(d: StoreDraft, programId: string): void {
  if (d.feedbackForms) d.feedbackForms = d.feedbackForms.filter((f) => f.programId !== programId);
  if (d.feedbackInvites) d.feedbackInvites = d.feedbackInvites.filter((i) => i.programId !== programId);
  if (d.feedbackResponses) d.feedbackResponses = d.feedbackResponses.filter((r) => r.programId !== programId);
}

/**
 * A deleted registration (or member) takes their invite and their answers:
 * a response names them through the registration.
 */
export function pruneFeedbackForRegistrationsSync(d: StoreDraft, registrationIds: Set<string>): void {
  if (registrationIds.size === 0) return;
  if (d.feedbackInvites) d.feedbackInvites = d.feedbackInvites.filter((i) => !registrationIds.has(i.registrationId));
  if (d.feedbackResponses) {
    d.feedbackResponses = d.feedbackResponses.filter((r) => !(r.registrationId && registrationIds.has(r.registrationId)));
  }
}
