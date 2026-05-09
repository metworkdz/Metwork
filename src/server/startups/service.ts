import crypto from 'node:crypto';
import { db } from '@/server/db/store';
import type { StartupListingRecord } from '@/server/db/store';
import type { CreateStartupInput } from './schemas';

export async function listStartups(
  filter: { founderId?: string; status?: StartupListingRecord['status'] } = {},
): Promise<StartupListingRecord[]> {
  const { startupListings } = await db.read();
  return startupListings.filter((l) => {
    if (filter.founderId && l.founderId !== filter.founderId) return false;
    if (filter.status && l.status !== filter.status) return false;
    return true;
  });
}

export async function findStartupById(id: string): Promise<StartupListingRecord | null> {
  const { startupListings } = await db.read();
  return startupListings.find((l) => l.id === id) ?? null;
}

export async function createStartup(
  input: CreateStartupInput,
  founderId: string,
): Promise<StartupListingRecord> {
  return db.update((store) => {
    const now = new Date().toISOString();
    const record: StartupListingRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      industry: input.industry,
      fundingGoal: input.fundingGoal,
      equityOffered: input.equityOffered,
      valuation: input.valuation ?? null,
      founderId,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
    store.startupListings.push(record);
    return record;
  });
}

export type UpdateStartupInput = Partial<CreateStartupInput> & {
  status?: StartupListingRecord['status'];
};

export type UpdateStartupResult =
  | { ok: true; startup: StartupListingRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' };

export async function updateStartup(
  id: string,
  founderId: string,
  patch: UpdateStartupInput,
): Promise<UpdateStartupResult> {
  return db.update<UpdateStartupResult>((store) => {
    const listing = store.startupListings.find((l) => l.id === id);
    if (!listing) return { ok: false, reason: 'NOT_FOUND' };
    if (listing.founderId !== founderId) return { ok: false, reason: 'FORBIDDEN' };

    if (patch.name           !== undefined) listing.name          = patch.name;
    if (patch.description    !== undefined) listing.description   = patch.description;
    if (patch.industry       !== undefined) listing.industry      = patch.industry;
    if (patch.fundingGoal    !== undefined) listing.fundingGoal   = patch.fundingGoal;
    if (patch.equityOffered  !== undefined) listing.equityOffered = patch.equityOffered;
    if (patch.valuation      !== undefined) listing.valuation     = patch.valuation ?? null;
    if (patch.status         !== undefined) listing.status        = patch.status;
    listing.updatedAt = new Date().toISOString();

    return { ok: true, startup: listing };
  });
}
