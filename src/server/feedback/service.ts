/**
 * Training feedback: a program's form, who it was sent to, what they said.
 *
 * Everything the host does is owner-scoped like the certificates: another
 * owner's program simply is not found. Everything a participant does goes
 * through a signed link (./tokens) and never sees anyone else's answers.
 *
 * Refusals always come before the first write — the store saves the draft
 * whatever a `db.update` mutator returns.
 */
import { randomUUID } from 'node:crypto';

import {
  db,
  type FeedbackFormRecord,
  type FeedbackInviteRecord,
  type FeedbackResponseRecord,
  type ProgramRecord,
  type RegistrationRecord,
} from '@/server/db/store';
import { programOwnedBy } from '@/server/certificates/service';
import type { OwnerScope } from '@/server/registrations/service';

import {
  checkFeedbackAnswers,
  computeFeedbackResults,
  defaultFeedbackQuestions,
  defaultFeedbackTitle,
  FEEDBACK_LIMITS,
  type FeedbackAnswer,
  type FeedbackLang,
  type FeedbackQuestion,
  type FeedbackQuestionKind,
  type FeedbackResults,
} from './types';
import { parseFeedbackToken } from './tokens';

type StoreData = Awaited<ReturnType<typeof db.read>>;
type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

const QUESTION_ID = /^[A-Za-z0-9-]{1,64}$/;

function findOwnedProgram(d: StoreData, programId: string, owner: OwnerScope): ProgramRecord | null {
  const program = (d.programs ?? []).find((p) => p.id === programId);
  return program && programOwnedBy(program, owner) ? program : null;
}

function formOf(d: StoreData, programId: string): FeedbackFormRecord | undefined {
  return (d.feedbackForms ?? []).find((f) => f.programId === programId);
}

function organizerName(d: StoreData, program: ProgramRecord): string {
  if (program.mentorId) return (d.mentors ?? []).find((m) => m.id === program.mentorId)?.fullName ?? '';
  return (d.incubators ?? []).find((i) => i.id === program.incubatorId)?.name ?? program.incubatorName ?? '';
}

/** Confirmed participants: the only people a form is sent to. */
function confirmedParticipants(d: StoreData, programId: string): RegistrationRecord[] {
  return (d.registrations ?? []).filter(
    (r) => r.entityType === 'PROGRAM' && r.entityId === programId && r.status === 'CONFIRMED',
  );
}

/* ─────────────────────────── The form (host) ─────────────────────────── */

export interface FeedbackFormView {
  form: Pick<FeedbackFormRecord, 'title' | 'intro' | 'questions' | 'isOpen' | 'sharedLinkEnabled' | 'sharedLinkVersion'> & {
    id: string | null;
  };
  /** False until the host saves once — the defaults are only a proposal. */
  saved: boolean;
  /** Answers exist: the host is told edits apply to future answers only. */
  hasResponses: boolean;
}

/** The program's form, or the default questions when none was saved yet. */
export async function getFeedbackForm(
  programId: string,
  owner: OwnerScope,
  lang: FeedbackLang = 'fr',
): Promise<FeedbackFormView | null> {
  const d = await db.read();
  if (!findOwnedProgram(d, programId, owner)) return null;
  const form = formOf(d, programId);
  if (form) {
    return {
      form: {
        id: form.id, title: form.title, intro: form.intro, questions: form.questions,
        isOpen: form.isOpen, sharedLinkEnabled: form.sharedLinkEnabled, sharedLinkVersion: form.sharedLinkVersion,
      },
      saved: true,
      hasResponses: (d.feedbackResponses ?? []).some((r) => r.formId === form.id),
    };
  }
  return {
    form: {
      id: null,
      title: defaultFeedbackTitle(lang),
      intro: null,
      questions: defaultFeedbackQuestions(lang, randomUUID),
      isOpen: true,
      sharedLinkEnabled: false,
      sharedLinkVersion: 1,
    },
    saved: false,
    hasResponses: false,
  };
}

export interface SaveFeedbackFormInput {
  title: string;
  intro?: string | null;
  questions: Array<{ id?: string | null; kind: FeedbackQuestionKind; label: string; required: boolean }>;
  isOpen: boolean;
  sharedLinkEnabled: boolean;
}

export type SaveFeedbackFormResult =
  | { ok: true; form: FeedbackFormRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID' };

/**
 * Save the form. A question keeps its id when the editor sends it back, so
 * renaming or moving it keeps its answers attached; a question without an id
 * is new. A deleted question's answers stay stored but stop counting.
 */
export async function saveFeedbackForm(
  programId: string,
  owner: OwnerScope,
  input: SaveFeedbackFormInput,
): Promise<SaveFeedbackFormResult> {
  const title = input.title.trim();
  const intro = input.intro?.trim() || null;
  if (!title || title.length > FEEDBACK_LIMITS.title) return { ok: false, reason: 'INVALID' };
  if (intro && intro.length > FEEDBACK_LIMITS.intro) return { ok: false, reason: 'INVALID' };
  if (input.questions.length === 0 || input.questions.length > FEEDBACK_LIMITS.questions) {
    return { ok: false, reason: 'INVALID' };
  }
  const seen = new Set<string>();
  const questions: FeedbackQuestion[] = [];
  for (const q of input.questions) {
    const label = q.label.trim();
    if (!label || label.length > FEEDBACK_LIMITS.label) return { ok: false, reason: 'INVALID' };
    if (q.kind !== 'RATING' && q.kind !== 'TEXT') return { ok: false, reason: 'INVALID' };
    const id = q.id && QUESTION_ID.test(q.id) ? q.id : randomUUID();
    if (seen.has(id)) return { ok: false, reason: 'INVALID' };
    seen.add(id);
    questions.push({ id, kind: q.kind, label, required: Boolean(q.required) });
  }

  return db.update<SaveFeedbackFormResult>((d) => {
    const program = findOwnedProgram(d, programId, owner);
    if (!program) return { ok: false, reason: 'NOT_FOUND' };
    const now = new Date().toISOString();
    if (!Array.isArray(d.feedbackForms)) d.feedbackForms = [];
    const existing = formOf(d, programId);
    if (existing) {
      existing.title = title;
      existing.intro = intro;
      existing.questions = questions;
      existing.isOpen = input.isOpen;
      existing.sharedLinkEnabled = input.sharedLinkEnabled;
      existing.updatedAt = now;
      return { ok: true, form: { ...existing } };
    }
    const form: FeedbackFormRecord = {
      id: randomUUID(),
      programId,
      incubatorId: program.mentorId ? null : program.incubatorId ?? null,
      mentorId: program.mentorId ?? null,
      title,
      intro,
      questions,
      isOpen: input.isOpen,
      sharedLinkEnabled: input.sharedLinkEnabled,
      sharedLinkVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    d.feedbackForms.push(form);
    return { ok: true, form: { ...form } };
  });
}

/** Retire every shared link handed out so far. */
export async function rotateSharedFeedbackLink(
  programId: string,
  owner: OwnerScope,
): Promise<FeedbackFormRecord | null> {
  return db.update<FeedbackFormRecord | null>((d) => {
    if (!findOwnedProgram(d, programId, owner)) return null;
    const form = formOf(d, programId);
    if (!form) return null;
    form.sharedLinkVersion += 1;
    form.updatedAt = new Date().toISOString();
    return { ...form };
  });
}

/* ─────────────────────────── Participants (host) ─────────────────────────── */

export interface FeedbackParticipant {
  registrationId: string;
  fullName: string;
  email: string;
  sentAt: string | null;
  responded: boolean;
}

export async function listFeedbackParticipants(
  programId: string,
  owner: OwnerScope,
): Promise<FeedbackParticipant[] | null> {
  const d = await db.read();
  if (!findOwnedProgram(d, programId, owner)) return null;
  const form = formOf(d, programId);
  const invites = form ? (d.feedbackInvites ?? []).filter((i) => i.formId === form.id) : [];
  const respondedInvites = new Set(
    form ? (d.feedbackResponses ?? []).filter((r) => r.formId === form.id && r.inviteId).map((r) => r.inviteId) : [],
  );
  return confirmedParticipants(d, programId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((r) => {
      const invite = invites.find((i) => i.registrationId === r.id);
      return {
        registrationId: r.id,
        fullName: r.fullName,
        email: r.email,
        sentAt: invite?.sentAt ?? null,
        responded: Boolean(invite && respondedInvites.has(invite.id)),
      };
    });
}

/**
 * The invite of each named participant, created when missing. Only confirmed
 * participants of this program get one — an id from elsewhere is skipped.
 * Synchronous: called inside the send run's own `db.update`.
 */
export function ensureFeedbackInvitesSync(
  d: StoreDraft,
  form: FeedbackFormRecord,
  registrationIds: string[],
): FeedbackInviteRecord[] {
  if (!Array.isArray(d.feedbackInvites)) d.feedbackInvites = [];
  const allowed = new Set(confirmedParticipants(d, form.programId).map((r) => r.id));
  const out: FeedbackInviteRecord[] = [];
  for (const registrationId of registrationIds) {
    if (!allowed.has(registrationId)) continue;
    let invite = d.feedbackInvites.find((i) => i.formId === form.id && i.registrationId === registrationId);
    if (!invite) {
      invite = {
        id: randomUUID(),
        formId: form.id,
        programId: form.programId,
        registrationId,
        sentAt: null,
        emailClaimedAt: null,
        createdAt: new Date().toISOString(),
      };
      d.feedbackInvites.push(invite);
    }
    out.push(invite);
  }
  return out;
}

/* ─────────────────────────── Results (host) ─────────────────────────── */

export interface FeedbackResponseView {
  id: string;
  /** Null for an answer through the shared link — nobody is named. */
  fullName: string | null;
  viaSharedLink: boolean;
  submittedAt: string;
  answers: FeedbackAnswer[];
  /** Mean of this person's star answers to current questions. */
  average: number | null;
}

export interface FeedbackResultsView {
  results: FeedbackResults;
  sent: number;
  responses: FeedbackResponseView[];
}

export async function getFeedbackResults(
  programId: string,
  owner: OwnerScope,
): Promise<FeedbackResultsView | null> {
  const d = await db.read();
  if (!findOwnedProgram(d, programId, owner)) return null;
  const form = formOf(d, programId);
  if (!form) return { results: computeFeedbackResults([], []), sent: 0, responses: [] };

  const responses = (d.feedbackResponses ?? [])
    .filter((r) => r.formId === form.id)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const regs = new Map((d.registrations ?? []).map((r) => [r.id, r]));
  const sent = (d.feedbackInvites ?? []).filter((i) => i.formId === form.id && i.sentAt).length;

  return {
    results: computeFeedbackResults(form.questions, responses),
    sent,
    responses: responses.map((r) => ({
      id: r.id,
      fullName: r.registrationId ? regs.get(r.registrationId)?.fullName ?? null : null,
      viaSharedLink: !r.inviteId,
      submittedAt: r.submittedAt,
      answers: r.answers,
      average: computeFeedbackResults(form.questions, [r]).overall,
    })),
  };
}

/** Per-program summary for the « Avis » overview page. */
export interface FeedbackOverviewRow {
  programId: string;
  title: string;
  overall: number | null;
  responses: number;
  sent: number;
  status: 'NONE' | 'OPEN' | 'CLOSED';
}

export async function getFeedbackOverview(owner: OwnerScope): Promise<FeedbackOverviewRow[]> {
  const d = await db.read();
  return (d.programs ?? [])
    .filter((p) => programOwnedBy(p, owner))
    .map((p) => {
      const form = formOf(d, p.id);
      if (!form) return { programId: p.id, title: p.title, overall: null, responses: 0, sent: 0, status: 'NONE' as const };
      const responses = (d.feedbackResponses ?? []).filter((r) => r.formId === form.id);
      return {
        programId: p.id,
        title: p.title,
        overall: computeFeedbackResults(form.questions, responses).overall,
        responses: responses.length,
        sent: (d.feedbackInvites ?? []).filter((i) => i.formId === form.id && i.sentAt).length,
        status: form.isOpen ? ('OPEN' as const) : ('CLOSED' as const),
      };
    });
}

/* ─────────────────────────── The participant's side ─────────────────────────── */

export type FeedbackLinkTarget =
  | {
      ok: true;
      form: FeedbackFormRecord;
      program: ProgramRecord;
      organizer: string;
      /** Personal link: who it is for, and what they already answered. */
      invite: FeedbackInviteRecord | null;
      registration: RegistrationRecord | null;
      previous: FeedbackAnswer[] | null;
    }
  | { ok: false; reason: 'INVALID' | 'CLOSED' };

function resolveTarget(d: StoreData, token: string): FeedbackLinkTarget {
  const parsed = parseFeedbackToken(token);
  if (!parsed) return { ok: false, reason: 'INVALID' };

  let form: FeedbackFormRecord | undefined;
  let invite: FeedbackInviteRecord | null = null;
  let registration: RegistrationRecord | null = null;

  if (parsed.kind === 'PERSONAL') {
    invite = (d.feedbackInvites ?? []).find((i) => i.id === parsed.inviteId) ?? null;
    if (!invite) return { ok: false, reason: 'INVALID' };
    form = (d.feedbackForms ?? []).find((f) => f.id === invite!.formId);
    registration = (d.registrations ?? []).find((r) => r.id === invite!.registrationId) ?? null;
    // A cancelled participant's link stops working with their place.
    if (!registration || registration.status !== 'CONFIRMED') return { ok: false, reason: 'INVALID' };
  } else {
    form = (d.feedbackForms ?? []).find((f) => f.id === parsed.formId);
    if (!form || !form.sharedLinkEnabled || form.sharedLinkVersion !== parsed.version) {
      return { ok: false, reason: 'INVALID' };
    }
  }

  if (!form) return { ok: false, reason: 'INVALID' };
  const program = (d.programs ?? []).find((p) => p.id === form!.programId);
  if (!program) return { ok: false, reason: 'INVALID' };
  if (!form.isOpen) return { ok: false, reason: 'CLOSED' };

  const previous = invite
    ? (d.feedbackResponses ?? []).find((r) => r.inviteId === invite!.id)?.answers ?? null
    : null;
  return { ok: true, form, program, organizer: organizerName(d, program), invite, registration, previous };
}

/** What the public page needs to draw the form — nothing about anyone else. */
export async function resolveFeedbackLink(token: string): Promise<FeedbackLinkTarget> {
  return resolveTarget(await db.read(), token);
}

export type SubmitFeedbackResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: 'INVALID' | 'CLOSED' | 'MISSING_REQUIRED' | 'INVALID_ANSWER'; questionId?: string };

/**
 * Record a participant's answers. Through a personal link they replace that
 * person's earlier answers (one response each, editable while the form is
 * open); through the shared link each submission is a new, unnamed response.
 */
export async function submitFeedback(token: string, raw: FeedbackAnswer[]): Promise<SubmitFeedbackResult> {
  return db.update<SubmitFeedbackResult>((d) => {
    const target = resolveTarget(d, token);
    if (!target.ok) return target;
    const check = checkFeedbackAnswers(target.form.questions, raw);
    if (!check.ok) return check;

    const now = new Date().toISOString();
    if (!Array.isArray(d.feedbackResponses)) d.feedbackResponses = [];
    if (target.invite) {
      const existing = d.feedbackResponses.find((r) => r.inviteId === target.invite!.id);
      if (existing) {
        existing.answers = check.answers;
        existing.updatedAt = now;
        return { ok: true, updated: true };
      }
    }
    const response: FeedbackResponseRecord = {
      id: randomUUID(),
      formId: target.form.id,
      programId: target.form.programId,
      inviteId: target.invite?.id ?? null,
      registrationId: target.registration?.id ?? null,
      answers: check.answers,
      submittedAt: now,
      updatedAt: now,
    };
    d.feedbackResponses.push(response);
    return { ok: true, updated: false };
  });
}
