/**
 * The Startup Academy addendum — the e-signed agreement a mentor must have
 * signed before submitting a course (owner decision, 2026-11-01).
 *
 * Built on the consultant-contract system, not beside it: the addendum is a
 * consultant contract of kind ACADEMY_ADDENDUM. This module only drafts it
 * (with the mentor's Academy share filled in); the admin reviews and sends it
 * from the existing Contracts page, and the mentor signs it in their portal's
 * Contract tab (WhatsApp code + drawn signature, stamped PDF).
 */
import { db, type ConsultantContractRecord } from '@/server/db/store';
import { createDraftContract, findContractsByConsultant } from '@/server/consultant-contracts/service';
import { DEFAULT_ACADEMY_ADDENDUM } from '@/lib/academy-addendum-text';
import { mentorShareRate } from '@/lib/academy';
import { getAcademyPricing, getAcademySettings } from './settings';

export type AddendumState = 'NONE' | 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED';

function pct(rate: number): string {
  return `${(Math.round(rate * 1000) / 10).toString().replace('.', ',')} %`;
}

/** The mentor's most advanced addendum: SIGNED wins over pending, pending over draft. */
export function addendumStateOf(contracts: ConsultantContractRecord[]): { state: AddendumState; contractId: string | null } {
  const mine = contracts.filter((c) => c.kind === 'ACADEMY_ADDENDUM' && c.status !== 'VOIDED');
  for (const state of ['SIGNED', 'PENDING_SIGNATURE', 'DRAFT'] as const) {
    const c = mine.find((x) => x.status === state);
    if (c) return { state, contractId: c.id };
  }
  return { state: 'NONE', contractId: null };
}

export async function getAddendumState(mentorId: string) {
  return addendumStateOf(await findContractsByConsultant(mentorId));
}

export type PrepareAddendumResult =
  | { ok: true; contractId: string }
  | { ok: false; code: 'ALREADY_EXISTS' | 'CONSULTANT_NOT_FOUND' | 'INCOMPLETE_CONSULTANT_PROFILE' | 'NO_TEMPLATE'; missing?: string[] };

/** Draft the addendum for one mentor, with their Academy share written in. */
export async function prepareAcademyAddendum(mentorId: string, adminId: string): Promise<PrepareAddendumResult> {
  const current = await getAddendumState(mentorId);
  if (current.state !== 'NONE') return { ok: false, code: 'ALREADY_EXISTS' };
  const [settings, pricing, d] = await Promise.all([getAcademySettings(), getAcademyPricing(), db.read()]);
  const mentor = d.mentors.find((m) => m.id === mentorId);
  if (!mentor) return { ok: false, code: 'CONSULTANT_NOT_FOUND' };
  const share = mentorShareRate(mentor, pricing);
  const template = (settings.addendumTemplate?.trim() || DEFAULT_ACADEMY_ADDENDUM)
    .replaceAll('{{academy_share}}', pct(share))
    .replaceAll('{{academy_metwork_share}}', pct(1 - share));
  const res = await createDraftContract({ consultantId: mentorId, actorId: adminId, kind: 'ACADEMY_ADDENDUM', template });
  if (!res.ok) return res.reason === 'INCOMPLETE_CONSULTANT_PROFILE'
    ? { ok: false, code: res.reason, missing: res.missing }
    : { ok: false, code: res.reason };
  return { ok: true, contractId: res.contract.id };
}
