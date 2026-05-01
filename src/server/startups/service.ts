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
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    store.startupListings.push(record);
    return record;
  });
}
