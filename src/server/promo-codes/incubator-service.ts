/**
 * Incubator-owned promo codes.
 *
 * An incubator creates a code and chooses exactly which of ITS OWN programs and
 * spaces it works on. Two rules carry the security of this module:
 *
 *   1. Ownership is verified here, against the store, for every id the client
 *      sends. The route never decides what an incubator owns.
 *   2. A caller can only ever see or touch codes whose `ownerIncubatorId` is
 *      theirs; anything else answers "not found", indistinguishable from an id
 *      that does not exist.
 *
 * Redemption is enforced elsewhere (`promoScopeAllows` in service.ts); this file
 * only decides what may be WRITTEN into a code's scope.
 */
import type { PromoCodeRecord } from '@/server/db/store';
import { db } from '@/server/db/store';
import {
  PromoCodeExistsError,
  applyPromoEdits,
  newPromoRecord,
  type UpdatePromoCodeInput,
} from './service';

/** Thrown when a requested scope is empty or names a listing the incubator does not own. */
export class PromoScopeError extends Error {
  constructor(public readonly reason: 'EMPTY_SCOPE' | 'FOREIGN_TARGET') {
    super(reason);
    this.name = 'PromoScopeError';
  }
}

export interface IncubatorPromoScopeInput {
  programIds: string[];
  spaceIds:   string[];
}

export interface CreateIncubatorPromoCodeInput extends IncubatorPromoScopeInput {
  code:            string;
  discountPercent: number;
  expiresAt:       string | null;
  usageLimit:      number | null;
}

export interface UpdateIncubatorPromoCodeInput {
  code?:            string;
  discountPercent?: number;
  expiresAt?:       string | null;
  usageLimit?:      number | null;
  isActive?:        boolean;
  /** Replace the whole target list. Mutually exclusive with attach/detach (enforced by the route schema). */
  programIds?:      string[];
  spaceIds?:        string[];
  /** Add / remove targets atomically — safe against two tabs editing at once. */
  attach?:          Partial<IncubatorPromoScopeInput>;
  detach?:          Partial<IncubatorPromoScopeInput>;
}

interface OwnedListings {
  spaces?:   Array<{ id: string; incubatorId: string }>;
  programs?: Array<{ id: string; incubatorId: string | null }>;
}

const uniq = (ids: string[]) => [...new Set(ids)];

/** Every id must be a listing this incubator owns. One foreign id rejects the whole write. */
function assertOwned(d: OwnedListings, incubatorId: string, scope: IncubatorPromoScopeInput): void {
  const ownedPrograms = new Set((d.programs ?? []).filter((p) => p.incubatorId === incubatorId).map((p) => p.id));
  const ownedSpaces   = new Set((d.spaces ?? []).filter((s) => s.incubatorId === incubatorId).map((s) => s.id));
  if (scope.programIds.some((id) => !ownedPrograms.has(id))) throw new PromoScopeError('FOREIGN_TARGET');
  if (scope.spaceIds.some((id) => !ownedSpaces.has(id)))     throw new PromoScopeError('FOREIGN_TARGET');
}

function finalScope(d: OwnedListings, incubatorId: string, scope: IncubatorPromoScopeInput): IncubatorPromoScopeInput {
  const clean = { programIds: uniq(scope.programIds), spaceIds: uniq(scope.spaceIds) };
  if (clean.programIds.length + clean.spaceIds.length === 0) throw new PromoScopeError('EMPTY_SCOPE');
  assertOwned(d, incubatorId, clean);
  return clean;
}

/**
 * The incubator a signed-in user MANAGES. Resolved by `managerId` only — the same
 * rule the dashboard pages use — and deliberately not by contact email, which two
 * accounts could share. The id that comes out of here is what every ownership
 * check in this module trusts.
 */
export async function findManagedIncubatorId(userId: string): Promise<string | null> {
  const data = await db.read();
  return (data.incubators ?? []).find((i) => i.managerId === userId)?.id ?? null;
}

/** Codes owned by this incubator, newest first. */
export async function listIncubatorPromoCodes(incubatorId: string): Promise<PromoCodeRecord[]> {
  const data = await db.read();
  return (data.promoCodes ?? [])
    .filter((c) => c.ownerIncubatorId === incubatorId)
    .reverse();
}

/**
 * Create a code scoped to the given programs/spaces.
 * Throws PromoScopeError (empty / foreign target) or PromoCodeExistsError.
 */
export async function createIncubatorPromoCode(
  incubatorId: string,
  input: CreateIncubatorPromoCodeInput,
): Promise<PromoCodeRecord> {
  const upper = input.code.toUpperCase().trim();
  const now = new Date().toISOString();

  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];

    const scope = finalScope(d, incubatorId, input);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (d.promoCodes as any[]).find((c) => c.code === upper);
    // The "deactivated" hint is only for the caller's own codes — it must not
    // reveal the state of another incubator's (or the platform's) code.
    if (exists) throw new PromoCodeExistsError(!exists.isActive && exists.ownerIncubatorId === incubatorId);

    const record = {
      ...newPromoRecord(
        {
          code: upper,
          discountPercent: input.discountPercent,
          // 'ALL' on purpose: the scope, not appliesTo, restricts an incubator code.
          // A mixed program+space code cannot be expressed by a single appliesTo kind.
          appliesTo: 'ALL',
          expiresAt: input.expiresAt,
          usageLimit: input.usageLimit,
        },
        now,
      ),
      ownerIncubatorId: incubatorId,
      scope,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d.promoCodes as any[]).push(record);
    return record as unknown as PromoCodeRecord;
  });
}

/**
 * Edit a code this incubator owns. Returns null when the id is unknown OR owned
 * by someone else — callers must answer both with the same 404.
 */
export async function updateIncubatorPromoCode(
  incubatorId: string,
  id: string,
  input: UpdateIncubatorPromoCodeInput,
): Promise<PromoCodeRecord | null> {
  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promo = (d.promoCodes as any[]).find((c) => c.id === id && c.ownerIncubatorId === incubatorId);
    if (!promo) return null;

    // db.update mutates the live store in place and does NOT roll back when the
    // callback throws. So everything that can refuse (scope validation, rename
    // collision) must run BEFORE anything is assigned: compute the new scope,
    // let applyPromoEdits do its checks, and only then write the scope.
    let nextScope: IncubatorPromoScopeInput | null = null;
    const touchesScope = input.programIds || input.spaceIds || input.attach || input.detach;
    if (touchesScope) {
      let programIds: string[] = promo.scope?.programIds ?? [];
      let spaceIds: string[]   = promo.scope?.spaceIds ?? [];
      if (input.programIds) programIds = input.programIds;
      if (input.spaceIds)   spaceIds   = input.spaceIds;
      if (input.attach) {
        programIds = [...programIds, ...(input.attach.programIds ?? [])];
        spaceIds   = [...spaceIds,   ...(input.attach.spaceIds ?? [])];
      }
      if (input.detach) {
        const dropP = new Set(input.detach.programIds ?? []);
        const dropS = new Set(input.detach.spaceIds ?? []);
        programIds = programIds.filter((x) => !dropP.has(x));
        spaceIds   = spaceIds.filter((x) => !dropS.has(x));
      }
      nextScope = finalScope(d, incubatorId, { programIds, spaceIds });
    }

    const fields: UpdatePromoCodeInput = {
      code: input.code,
      discountPercent: input.discountPercent,
      expiresAt: input.expiresAt,
      usageLimit: input.usageLimit,
      isActive: input.isActive,
      // appliesTo is deliberately not editable here — scope is what restricts it.
    };
    applyPromoEdits(d.promoCodes as PromoCodeRecord[], promo, fields, incubatorId);
    if (nextScope) promo.scope = nextScope;
    return promo as PromoCodeRecord;
  });
}

/** Delete a code this incubator owns; frees the name. Null when unknown or not theirs. */
export async function deleteIncubatorPromoCode(
  incubatorId: string,
  id: string,
): Promise<PromoCodeRecord | null> {
  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) return null;
    const idx = d.promoCodes.findIndex((c) => c.id === id && c.ownerIncubatorId === incubatorId);
    if (idx === -1) return null;
    const [removed] = d.promoCodes.splice(idx, 1);
    return removed as PromoCodeRecord;
  });
}
