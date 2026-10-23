/**
 * Ventures — THE service for an entrepreneur's business profile.
 *
 * One venture per entrepreneur for now (entitlements: ventures = 1 on both
 * plans). The existing fundraising listing is not migrated: a venture links
 * to it (`listingId`) and is pre-filled from it the first time, so investor
 * pages keep reading the listing exactly as before.
 *
 * The public page is the Founder benefit. `isPublic` is stored as the owner's
 * choice, but a venture is only ever SHOWN while the owner holds Founder — see
 * `publicVentureBySlug` — so a lapsed plan hides the page without a write.
 */
import { randomUUID } from 'node:crypto';
import { db, type VentureRecord } from '@/server/db/store';
import { entitlementsForUser } from '@/lib/entitlements';
import { slugifyVentureName, type VentureKind } from '@/lib/venture-options';
import type { LegalIdentity } from '@/types/legal-status';

type Draft = Parameters<Parameters<typeof db.update>[0]>[0];

export interface VentureInput {
  name: string;
  kind: VentureKind;
  legal: LegalIdentity;
  stage: VentureRecord['stage'];
  sector: string;
  wilaya: string;
  description: string;
  website: string | null;
  lookingFor: VentureRecord['lookingFor'];
  isPublic: boolean;
}

/** A slug no other venture uses; the owner's own venture keeps its slug. */
function uniqueSlug(d: Draft, name: string, ownId: string | null): string {
  const base = slugifyVentureName(name);
  const taken = new Set((d.ventures ?? []).filter((v) => v.id !== ownId).map((v) => v.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function ventureOf(data: { ventures?: VentureRecord[] }, ownerId: string): VentureRecord | null {
  return (data.ventures ?? []).find((v) => v.ownerId === ownerId) ?? null;
}

/** Pre-fill values for a first venture, from the founder's fundraising listing. */
export function draftFromListing(
  data: { startupListings?: Array<{ id: string; founderId: string; name: string; description: string; industry: string; websiteUrl?: string | null }> },
  ownerId: string,
): Partial<VentureInput> & { listingId: string | null } {
  const listing = (data.startupListings ?? []).find((l) => l.founderId === ownerId);
  if (!listing) return { listingId: null };
  return {
    listingId: listing.id,
    name: listing.name,
    kind: 'STARTUP',
    description: listing.description,
    sector: listing.industry,
    website: listing.websiteUrl ?? null,
  };
}

export type SaveVentureResult =
  | { ok: true; venture: VentureRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'PUBLIC_PAGE_REQUIRES_FOUNDER' };

export async function saveVenture(ownerId: string, input: VentureInput): Promise<SaveVentureResult> {
  const now = new Date().toISOString();
  return db.update((d) => {
    const owner = d.users.find((u) => u.id === ownerId);
    if (!owner || owner.role !== 'ENTREPRENEUR') return { ok: false, reason: 'NOT_FOUND' } as const;
    // Checked before any write: turning the page ON needs Founder. Leaving it
    // on (or turning it off) never does, so a lapsed member can still save.
    const existing = ventureOf(d, ownerId);
    const turningOn = input.isPublic && !existing?.isPublic;
    const ent = entitlementsForUser(owner);
    if (turningOn && !(ent?.audience === 'ENTREPRENEUR' && ent.publicStartupPage)) {
      return { ok: false, reason: 'PUBLIC_PAGE_REQUIRES_FOUNDER' } as const;
    }
    if (!Array.isArray(d.ventures)) d.ventures = [];
    const fields = {
      name: input.name.trim(),
      kind: input.kind,
      legal: input.legal,
      stage: input.stage,
      sector: input.sector.trim(),
      wilaya: input.wilaya,
      description: input.description.trim(),
      website: input.website,
      lookingFor: [...new Set(input.lookingFor)],
      isPublic: input.isPublic,
    };
    if (existing) {
      const slug = existing.name === fields.name ? existing.slug : uniqueSlug(d, fields.name, existing.id);
      Object.assign(existing, fields, { slug, updatedAt: now });
      return { ok: true, venture: { ...existing } } as const;
    }
    const venture: VentureRecord = {
      id: randomUUID(),
      ownerId,
      slug: uniqueSlug(d, fields.name, null),
      logoUrl: null,
      listingId: draftFromListing(d, ownerId).listingId,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    d.ventures.push(venture);
    return { ok: true, venture: { ...venture } } as const;
  });
}

/** The public page's data, or null when it must not be shown. */
export async function publicVentureBySlug(slug: string) {
  const data = await db.read();
  const venture = (data.ventures ?? []).find((v) => v.slug === slug);
  return venture ? publicVenture(data, venture) : null;
}

/** The venture and its owner when its public page is live, else null. */
export function publicVenture(data: Awaited<ReturnType<typeof db.read>>, venture: VentureRecord) {
  if (!venture.isPublic) return null;
  const owner = data.users.find((u) => u.id === venture.ownerId);
  if (!owner || owner.status !== 'ACTIVE') return null;
  const ent = entitlementsForUser(owner);
  if (!ent || ent.audience !== 'ENTREPRENEUR' || !ent.publicStartupPage) return null;
  return { venture, owner };
}
