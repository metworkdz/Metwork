/**
 * Deleting a CANCELLED document, and getting its number back.
 *
 * What these pin:
 *   - only a cancelled document can go (a live one is refused, untouched);
 *   - the number is free again: stepping the counter back when it was the last
 *     one, otherwise re-usable through the number override — never a collision;
 *   - nobody else's document can be deleted;
 *   - a facture converted from a proforma gives the proforma back;
 *   - the deletion is in the audit log, written in the same transaction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { InvoiceRecord } from '@/server/db/store';

const MANAGER_EMAIL = 'manager@delete-incubator.dz';

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
  requireApprovedApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
}));

import { db } from '@/server/db/store';
import { POST as createInvoice } from '@/app/api/incubator/invoices/route';
import { DELETE, PATCH } from '@/app/api/incubator/invoices/[id]/route';
import { POST as convert } from '@/app/api/incubator/invoices/[id]/convert/route';
import { deleteCancelledInvoice } from '@/server/invoices/delete';

const INC = 'inc-delete';
const NOW = '2026-01-01T00:00:00.000Z';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.invoices = []; d.auditLogs = []; d.deletedInvoices = [];
    d.incubators = [{
      id: INC, name: 'Delete Incubator', city: 'Oran', status: 'ACTIVE', managerId: 'u1', email: MANAGER_EMAIL,
      commercialRegNumber: '16/00-7654321B24', nif: '002616987654321', bankRib: '00100000000000000000',
      invoiceCounters: null, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.clients = [{
      id: 'cl-del', incubatorId: INC, fullName: 'Amina Cherif', email: 'amina@example.dz',
      phone: '0770112233', clientType: 'INDIVIDUAL', createdAt: NOW, updatedAt: NOW,
    } as never];
    d.mentors = [{ id: 'mentor-x', fullName: 'Other Owner', email: 'x@y.dz' } as never];
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function issue(extra: Record<string, unknown> = {}): Promise<InvoiceRecord> {
  const res = await createInvoice(new NextRequest('http://localhost/x', body({
    clientId: 'cl-del',
    lines: [{ designation: 'Accompagnement', quantity: 1, unitPriceHt: 24_000 }],
    vatRate: 19, paymentMethod: 'VIREMENT', ...extra,
  })));
  expect(res.status).toBe(201);
  return res.json() as Promise<InvoiceRecord>;
}
const cancel = (id: string) => PATCH(new NextRequest('http://localhost/x', { ...body({ status: 'CANCELLED' }), method: 'PATCH' }), ctx(id));
const remove = (id: string) => DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx(id));
const counters = async () => (await db.read()).incubators.find((i) => i.id === INC)!.invoiceCounters;
const live = async () => (await db.read()).invoices ?? [];

describe('DELETE /api/incubator/invoices/[id]', () => {
  beforeEach(async () => { await seed(); });

  it('refuses a document that is not cancelled, and changes nothing', async () => {
    const a = await issue();
    const res = await remove(a.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOT_CANCELLED');
    expect(await live()).toHaveLength(1);
    expect(await counters()).toEqual({ '2026': 1 });
  });

  it('deletes the LAST cancelled number and the next automatic number is that one again', async () => {
    await issue(); // 01
    const b = await issue(); // 02
    await cancel(b.id);
    const res = await remove(b.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, number: '02/2026', seq: 2, nextAutomatic: true });
    expect(await counters()).toEqual({ '2026': 1 });
    const c = await issue();
    expect(c.number).toBe('02/2026'); // replaced
    expect((await live()).map((i) => i.number).sort()).toEqual(['01/2026', '02/2026']);
  });

  it('frees a number in the MIDDLE of the series: counter untouched, number re-usable on request', async () => {
    await issue(); // 01
    const b = await issue(); // 02
    await issue(); // 03
    await cancel(b.id);
    const res = await remove(b.id);
    expect(await res.json()).toMatchObject({ number: '02/2026', nextAutomatic: false });
    expect(await counters()).toEqual({ '2026': 3 });

    // Without asking, the series carries on: 04.
    const auto = await issue();
    expect(auto.number).toBe('04/2026');
    // Asking for the freed number works — it no longer collides.
    const replacement = await issue({ seq: 2 });
    expect(replacement.number).toBe('02/2026');
    expect(await counters()).toEqual({ '2026': 4 }); // never lowered by a re-use
    // …and a second document cannot take it again.
    const dup = await createInvoice(new NextRequest('http://localhost/x', body({
      clientId: 'cl-del', lines: [{ designation: 'x', quantity: 1, unitPriceHt: 1000 }], paymentMethod: 'VIREMENT', seq: 2,
    })));
    expect(dup.status).toBe(409);
  });

  it('keeps each kind in its own series', async () => {
    await issue(); // facture 01
    const fp = await issue({ kind: 'PROFORMA' }); // FP 01
    await cancel(fp.id);
    await remove(fp.id);
    expect(await counters()).toEqual({ '2026': 1, 'PROFORMA:2026': 0 });
    const next = await issue({ kind: 'PROFORMA' });
    expect(next.number).toBe('FP 01/2026');
  });

  it('is gone for good: a second delete is a 404', async () => {
    const a = await issue();
    await cancel(a.id);
    expect((await remove(a.id)).status).toBe(200);
    expect((await remove(a.id)).status).toBe(404);
  });

  it('unlocks the proforma a deleted facture was converted from', async () => {
    const fp = await issue({ kind: 'PROFORMA' });
    const conv = await convert(
      new NextRequest('http://localhost/x', body({ paymentMethod: 'VIREMENT', withStamp: false })),
      ctx(fp.id),
    );
    expect(conv.status).toBe(201);
    const { invoice: facture } = await conv.json() as { invoice: InvoiceRecord };
    expect((await live()).find((i) => i.id === fp.id)!.convertedToInvoiceId).toBe(facture.id);

    await cancel(facture.id);
    const res = await remove(facture.id);
    const out = await res.json() as { source: InvoiceRecord | null };
    expect(out.source?.id).toBe(fp.id);
    const source = (await live()).find((i) => i.id === fp.id)!;
    expect(source.convertedToInvoiceId).toBeUndefined();
    expect(source.convertedToNumber).toBeUndefined();
    expect(source.status).toBe('ISSUED');
  });

  it('writes the deletion to the audit log with what it carried', async () => {
    const a = await issue();
    await cancel(a.id);
    await remove(a.id);
    const logs = (await db.read()).auditLogs ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'INVOICE_DELETED', targetType: 'invoice', targetId: a.id, adminId: 'u1', adminEmail: MANAGER_EMAIL,
      details: { ownerType: 'INCUBATOR', ownerId: INC, number: '01/2026', kind: 'FACTURE', ttc: 28_560, counterSteppedBack: true },
    });
  });

  it('keeps the whole deleted record, recoverable', async () => {
    const a = await issue();
    await cancel(a.id);
    await remove(a.id);
    const archived = (await db.read()).deletedInvoices ?? [];
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ deletedById: 'u1', invoice: { id: a.id, number: '01/2026', status: 'CANCELLED' } });
    expect(archived[0]!.invoice.totals.ttc).toBe(28_560);
  });
});

describe('ownership', () => {
  beforeEach(async () => { await seed(); });

  it('another issuer cannot delete this incubator’s cancelled document', async () => {
    const a = await issue();
    await cancel(a.id);
    const res = await deleteCancelledInvoice({ type: 'CONSULTANT', id: 'mentor-x' }, a.id, { id: 'm', email: 'x@y.dz' });
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(await live()).toHaveLength(1);
    expect((await db.read()).auditLogs ?? []).toHaveLength(0);
  });

  it('a row carrying a sibling owner id is not the incubator’s to delete', async () => {
    const a = await issue();
    await cancel(a.id);
    await db.update((d) => { d.invoices!.find((i) => i.id === a.id)!.mentorId = 'mentor-x'; });
    expect((await remove(a.id)).status).toBe(404);
    expect(await live()).toHaveLength(1);
  });
});
