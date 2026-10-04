/**
 * The client book — one implementation, two owners.
 *
 * An incubator's clients and a consultant's are the same kind of record with
 * the same billing profile, and a document addressed to one is built the same
 * way. Only the owner differs, so the routes on both sides are thin wrappers
 * over this file; the alternative is two copies of the dedupe rule, the
 * COMPANY/legalName rule and the field list, drifting apart one patch at a time.
 *
 * The books themselves never mix: `ownsClient` scopes every read and write, so
 * a consultant cannot see — or invoice — an incubator's client.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type ClientRecord } from '@/server/db/store';
import { clientsFor, ownerFields, ownsClient, type InvoiceOwner } from '@/server/invoices/owner';

/* ─────────────────── Schemas ─────────────────── */

export const clientCreateSchema = z
  .object({
    fullName: z.string().min(2).max(120),
    // Email & phone are optional: a name-only record is valid. Stored as ''
    // when omitted, matching ClientRecord and the manual-bookings find-or-create.
    email: z.string().email().max(200).optional().nullable(),
    phone: z.string().min(6).max(30).optional().nullable(),
    idCardNumber: z.string().max(30).optional().nullable(),
    companyName: z.string().max(120).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    // Invoice billing profile (additive — legacy callers omit them).
    clientType: z.enum(['COMPANY', 'INDIVIDUAL']).optional(),
    legalName: z.string().max(200).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    rc: z.string().max(100).optional().nullable(),
    nif: z.string().max(100).optional().nullable(),
    nis: z.string().max(100).optional().nullable(),
    ai: z.string().max(100).optional().nullable(),
  })
  .refine((v) => v.clientType !== 'COMPANY' || !!v.legalName?.trim(), {
    message: 'legalName is required for a COMPANY client',
    path: ['legalName'],
  });

export const clientPatchSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  // Nullable, like every other optional field here: a form edits the whole
  // record and sends `null` for the boxes left empty. Accepting `undefined`
  // only would mean a client with no email could never be saved again — the
  // patch would 422 on the very field the user cleared. '' is how an absent
  // email is stored (see createClient), so null and '' mean the same thing.
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().min(6).max(30).optional().nullable(),
  idCardNumber: z.string().max(30).nullable().optional(),
  companyName: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  clientType: z.enum(['COMPANY', 'INDIVIDUAL']).optional(),
  legalName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  rc: z.string().max(100).nullable().optional(),
  nif: z.string().max(100).nullable().optional(),
  nis: z.string().max(100).nullable().optional(),
  ai: z.string().max(100).nullable().optional(),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientPatchInput = z.infer<typeof clientPatchSchema>;

/* ─────────────────── Read ─────────────────── */

/** This owner's clients, newest first. */
export async function listClients(owner: InvoiceOwner): Promise<ClientRecord[]> {
  return clientsFor(await db.read(), owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Up to `limit` of this owner's clients matching name, email, phone or company. */
export async function searchClients(
  owner: InvoiceOwner,
  query: string,
  limit = 10,
): Promise<ClientRecord[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return clientsFor(await db.read(), owner)
    .filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.companyName ?? '').toLowerCase().includes(q) ||
        (c.legalName ?? '').toLowerCase().includes(q),
    )
    .slice(0, limit);
}

/* ─────────────────── Write ─────────────────── */

/**
 * Create a client, or return the existing one with the same email.
 *
 * Idempotent on email WITHIN this owner's book only — and only when an email
 * was given. Name-only clients must never collapse into one another.
 */
export async function createClient(
  owner: InvoiceOwner,
  input: ClientCreateInput,
): Promise<ClientRecord> {
  const email = (input.email ?? '').trim().toLowerCase();
  const phone = (input.phone ?? '').trim();
  const now = new Date().toISOString();

  return db.update<ClientRecord>((d) => {
    if (!Array.isArray(d.clients)) d.clients = [];
    if (email) {
      const existing = d.clients.find((c) => ownsClient(c, owner) && c.email.toLowerCase() === email);
      if (existing) return existing;
    }

    const client: ClientRecord = {
      id: randomUUID(),
      ...ownerFields(owner),
      fullName: input.fullName.trim(),
      email,
      phone,
      idCardNumber: input.idCardNumber ?? null,
      companyName: input.companyName ?? null,
      notes: input.notes ?? null,
      clientType: input.clientType ?? (input.companyName ? 'COMPANY' : 'INDIVIDUAL'),
      legalName: input.legalName?.trim() || null,
      address: input.address?.trim() || null,
      rc: input.rc?.trim() || null,
      nif: input.nif?.trim() || null,
      nis: input.nis?.trim() || null,
      ai: input.ai?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    d.clients.push(client);
    return client;
  });
}

/** Apply only the fields present in the patch. Null when not this owner's. */
export async function updateClient(
  owner: InvoiceOwner,
  id: string,
  input: ClientPatchInput,
): Promise<ClientRecord | null> {
  return db.update<ClientRecord | null>((d) => {
    if (!Array.isArray(d.clients)) d.clients = [];
    const c = d.clients.find((x) => x.id === id && ownsClient(x, owner));
    if (!c) return null;

    if (input.fullName !== undefined) c.fullName = input.fullName.trim();
    if (input.email !== undefined) c.email = (input.email ?? '').trim().toLowerCase();
    if (input.phone !== undefined) c.phone = (input.phone ?? '').trim();
    if (input.idCardNumber !== undefined) c.idCardNumber = input.idCardNumber;
    if (input.companyName !== undefined) c.companyName = input.companyName;
    if (input.notes !== undefined) c.notes = input.notes;
    if (input.clientType !== undefined) c.clientType = input.clientType;
    if (input.legalName !== undefined) c.legalName = input.legalName;
    if (input.address !== undefined) c.address = input.address;
    if (input.rc !== undefined) c.rc = input.rc;
    if (input.nif !== undefined) c.nif = input.nif;
    if (input.nis !== undefined) c.nis = input.nis;
    if (input.ai !== undefined) c.ai = input.ai;
    c.updatedAt = new Date().toISOString();
    return c;
  });
}

/** Remove a client from this owner's book. Silent when it isn't theirs. */
export async function deleteClient(owner: InvoiceOwner, id: string): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.clients)) d.clients = [];
    d.clients = d.clients.filter((c) => !(c.id === id && ownsClient(c, owner)));
  });
}
