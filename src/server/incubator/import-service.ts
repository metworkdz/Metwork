/**
 * Incubator CSV bulk-import — income & expenses.
 *
 * Extracted from the route handlers so the per-row validation, find-or-create,
 * and (critically) the IDEMPOTENT insert can be unit-tested directly.
 *
 * Idempotency: when the caller supplies a `clientReference` it becomes the
 * batch's `importBatchId`. The dedup check + insert run inside ONE `db.update`
 * critical section, so a retried upload (e.g. the dialog re-POSTs after a
 * network timeout) replays the original batch instead of duplicating rows and
 * distorting the incubator's P&L. Without a reference each call is a fresh
 * batch (legacy behaviour).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type ClientRecord, type ServiceRecord } from '@/server/db/store';

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  batchId: string;
  /** True when this call matched a prior batch and inserted nothing. */
  replayed: boolean;
}

/** A clientReference must be at least this long to be used as an idempotency key. */
const MIN_REFERENCE_LEN = 8;

export const incomeRowSchema = z.object({
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clientName:    z.string().min(1).max(120),
  serviceName:   z.string().min(1).max(120),
  amount:        z.number().int().min(0),
  paymentMethod: z.enum(['CASH', 'ONLINE', 'OTHER']).optional().default('CASH'),
  notes:         z.string().max(500).optional().nullable(),
});

export const expenseRowSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title:       z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  amount:      z.number().int().min(1),
  category:    z.string().max(80).optional().nullable(),
});

/** Resolve the batch id: the client reference (idempotency key) or a fresh UUID. */
function resolveBatch(clientReference?: string | null): { batchId: string; keyed: boolean } {
  if (typeof clientReference === 'string' && clientReference.length >= MIN_REFERENCE_LEN) {
    return { batchId: clientReference, keyed: true };
  }
  return { batchId: randomUUID(), keyed: false };
}

export async function importIncomeRows(
  incubatorId: string,
  rows: unknown[],
  clientReference?: string | null,
): Promise<ImportSummary> {
  const { batchId, keyed } = resolveBatch(clientReference);
  const now = new Date().toISOString();

  return db.update<ImportSummary>((d) => {
    if (!Array.isArray(d.income))   d.income   = [];
    if (!Array.isArray(d.clients))  d.clients  = [];
    if (!Array.isArray(d.services)) d.services = [];

    // Idempotency: a prior import with this batch id replays unchanged.
    if (keyed) {
      const prior = d.income.filter(
        (r) => r.incubatorId === incubatorId && r.importBatchId === batchId,
      );
      if (prior.length > 0) {
        return { imported: prior.length, skipped: 0, errors: [], batchId, replayed: true };
      }
    }

    // Case-insensitive lookup maps for this incubator's clients / services.
    const clientMap = new Map<string, ClientRecord>();
    for (const c of d.clients) {
      if (c.incubatorId === incubatorId) clientMap.set(c.fullName.toLowerCase(), c);
    }
    const serviceMap = new Map<string, ServiceRecord>();
    for (const s of d.services) {
      if (s.incubatorId === incubatorId) serviceMap.set(s.name.toLowerCase(), s);
    }

    const errors: { row: number; reason: string }[] = [];
    let imported = 0;
    let skipped = 0;

    rows.forEach((raw, idx) => {
      const parsed = incomeRowSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        errors.push({ row: idx + 1, reason: parsed.error.issues[0]?.message ?? 'Invalid row' });
        return;
      }
      const r = parsed.data;
      const nameKey = r.clientName.trim().toLowerCase();
      const svcKey  = r.serviceName.trim().toLowerCase();

      let client = clientMap.get(nameKey);
      if (!client) {
        client = {
          id: randomUUID(), incubatorId, fullName: r.clientName.trim(),
          email: '', phone: '', idCardNumber: null, companyName: null, notes: null,
          createdAt: now, updatedAt: now,
        };
        d.clients.push(client);
        clientMap.set(nameKey, client);
      }

      let service = serviceMap.get(svcKey);
      if (!service) {
        service = {
          id: randomUUID(), incubatorId, name: r.serviceName.trim(),
          description: null, isActive: true, createdAt: now, updatedAt: now,
        };
        d.services.push(service);
        serviceMap.set(svcKey, service);
      }

      d.income.push({
        id: randomUUID(), incubatorId,
        clientId: client.id, clientName: client.fullName,
        serviceName: service.name, serviceId: service.id,
        date: r.date, amount: r.amount, paymentMethod: r.paymentMethod,
        notes: r.notes ?? null, importBatchId: batchId, bookingId: null,
        createdAt: now, updatedAt: now,
      });
      imported++;
    });

    return { imported, skipped, errors, batchId, replayed: false };
  });
}

export async function importExpenseRows(
  incubatorId: string,
  rows: unknown[],
  clientReference?: string | null,
): Promise<ImportSummary> {
  const { batchId, keyed } = resolveBatch(clientReference);
  const now = new Date().toISOString();

  return db.update<ImportSummary>((d) => {
    if (!Array.isArray(d.expenses)) d.expenses = [];

    if (keyed) {
      const prior = d.expenses.filter(
        (r) => r.incubatorId === incubatorId && r.importBatchId === batchId,
      );
      if (prior.length > 0) {
        return { imported: prior.length, skipped: 0, errors: [], batchId, replayed: true };
      }
    }

    const errors: { row: number; reason: string }[] = [];
    let imported = 0;
    let skipped = 0;

    rows.forEach((raw, idx) => {
      const parsed = expenseRowSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        errors.push({ row: idx + 1, reason: parsed.error.issues[0]?.message ?? 'Invalid row' });
        return;
      }
      const r = parsed.data;
      d.expenses.push({
        id: randomUUID(), incubatorId,
        date: r.date, title: r.title.trim(), description: r.description ?? null,
        amount: r.amount, category: r.category ?? null, importBatchId: batchId,
        createdAt: now, updatedAt: now,
      });
      imported++;
    });

    return { imported, skipped, errors, batchId, replayed: false };
  });
}
