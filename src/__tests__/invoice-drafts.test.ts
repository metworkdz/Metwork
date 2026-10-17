/**
 * Proformas and devis can be corrected in place and have their stamp toggled;
 * a facture never can.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { InvoiceRecord } from '@/server/db/store';

const MANAGER_EMAIL = 'manager@qa-drafts.dz';
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
  requireApprovedApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
}));

import { db } from '@/server/db/store';
import { POST as createInvoice } from '@/app/api/incubator/invoices/route';
import { PATCH, PUT } from '@/app/api/incubator/invoices/[id]/route';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

const INC = 'inc-drafts';
const NOW = '2026-01-01T00:00:00.000Z';
const LINES = [{ designation: 'Conseil en Vente', quantity: 2, unitPriceHt: 24_000 }];

beforeEach(async () => {
  await db.update((d) => {
    d.users = []; d.invoices = [];
    d.incubators = [{
      id: INC, name: 'EURL Test', city: 'Oran', status: 'ACTIVE', managerId: 'u1', email: MANAGER_EMAIL,
      commercialRegNumber: '31/00-1125194 B24', nif: '002431112519476', bankRib: '03803101336635600141',
      stampUrl: 'https://res.cloudinary.com/x/stamp.png', invoiceCounters: null, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.clients = [
      { id: 'cl-mdm', incubatorId: INC, fullName: 'Sarl Mdm Express', email: 'm@x.dz', phone: '0540', createdAt: NOW, updatedAt: NOW } as never,
      { id: 'cl-other', incubatorId: 'someone-else', fullName: 'Not yours', email: 'n@x.dz', phone: '0', createdAt: NOW, updatedAt: NOW } as never,
    ];
  });
});

async function issue(kind: 'FACTURE' | 'PROFORMA' | 'DEVIS', extra: Record<string, unknown> = {}) {
  const res = await createInvoice(new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: 'cl-mdm', lines: LINES, vatRate: 19, paymentMethod: 'VIREMENT', kind,
      ...(kind === 'DEVIS' ? { validUntil: '2026-12-31' } : {}), ...extra,
    }),
  }));
  expect(res.status).toBe(201);
  return await res.json() as InvoiceRecord;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: Record<string, unknown>) => PUT(new NextRequest('http://localhost/x', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), ctx(id));
const patch = (id: string, body: Record<string, unknown>) => PATCH(new NextRequest('http://localhost/x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), ctx(id));

const edit = { clientId: 'cl-mdm', lines: [{ designation: 'Conseil en Vente', quantity: 3, unitPriceHt: 24_000 }], vatRate: 19, paymentMethod: 'ESPECE', note: 'Avance 50 %' };

describe('editing a proforma', () => {
  it('keeps its number and date, recomputes the totals, and picks up the client as completed since', async () => {
    const fp = await issue('PROFORMA');
    expect(buildInvoiceViewModel(fp).clientLines.some((l) => l.startsWith('RC'))).toBe(false);

    // The client is completed after the proforma was issued.
    await db.update((d) => {
      Object.assign(d.clients.find((c) => c.id === 'cl-mdm')!, {
        clientType: 'COMPANY', legalName: 'SARL MDM EXPRESS', rc: '31/00-99B', nif: '000231', address: 'Oran',
      });
    });

    const res = await put(fp.id, edit);
    expect(res.status).toBe(200);
    const { invoice } = await res.json() as { invoice: InvoiceRecord };
    expect(invoice).toMatchObject({ number: fp.number, issuedAt: fp.issuedAt, kind: 'PROFORMA', note: 'Avance 50 %' });
    expect(invoice.totals.ht).toBe(72_000);
    // No timbre on a proforma, even in cash.
    expect(invoice.totals.timbre).toBe(0);
    expect(invoice.editedAt).toBeTruthy();
    expect(buildInvoiceViewModel(invoice).clientLines).toEqual(expect.arrayContaining(['SARL MDM EXPRESS', 'RC: 31/00-99B', 'NIF: 000231']));
  });

  it('a devis is editable too, and still needs its validity date', async () => {
    const dv = await issue('DEVIS');
    expect((await put(dv.id, edit)).status).toBe(422);
    expect((await put(dv.id, { ...edit, validUntil: '2027-01-31' })).status).toBe(200);
  });

  it('never edits a facture', async () => {
    const f = await issue('FACTURE');
    const res = await put(f.id, edit);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('FACTURE_LOCKED');
    expect((await db.read()).invoices!.find((i) => i.id === f.id)!.totals).toEqual(f.totals);
  });

  it('refuses a cancelled proforma, another owner’s client, and an unknown id', async () => {
    const fp = await issue('PROFORMA');
    expect((await put(fp.id, { ...edit, clientId: 'cl-other' })).status).toBe(404);
    expect((await put('nope', edit)).status).toBe(404);
    await patch(fp.id, { status: 'CANCELLED' });
    expect((await (await put(fp.id, edit)).json()).error.code).toBe('CANCELLED');
  });

  it('runs the legal gate: virement needs the RIB', async () => {
    const fp = await issue('PROFORMA');
    await db.update((d) => { (d.incubators[0] as { bankRib?: string | null }).bankRib = null; });
    expect((await put(fp.id, { ...edit, paymentMethod: 'VIREMENT' })).status).toBe(422);
  });
});

describe('the stamp toggle', () => {
  it('adds and removes the stamp on a proforma', async () => {
    const fp = await issue('PROFORMA');
    let res = await patch(fp.id, { withStamp: true });
    expect(res.status).toBe(200);
    let inv = (await res.json()).invoice as InvoiceRecord;
    expect(buildInvoiceViewModel(inv).stampUrl).toBe('https://res.cloudinary.com/x/stamp.png');
    res = await patch(fp.id, { withStamp: false });
    inv = (await res.json()).invoice as InvoiceRecord;
    expect(buildInvoiceViewModel(inv).stampUrl).toBeNull();
  });

  it('is refused on a facture, and without a stamp on file', async () => {
    const f = await issue('FACTURE');
    expect((await patch(f.id, { withStamp: true })).status).toBe(409);
    const fp = await issue('PROFORMA');
    await db.update((d) => { (d.incubators[0] as { stampUrl?: string | null }).stampUrl = null; });
    expect((await (await patch(fp.id, { withStamp: true })).json()).error.code).toBe('NO_STAMP');
  });

  it('cancelling still works as before', async () => {
    const f = await issue('FACTURE');
    expect(((await (await patch(f.id, { status: 'CANCELLED' })).json()).invoice as InvoiceRecord).status).toBe('CANCELLED');
  });
});

describe('converting to a facture', () => {
  const convert = async (id: string, body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/incubator/invoices/[id]/convert/route');
    return POST(new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), ctx(id));
  };

  it('issues the next facture number, today, with the client as completed since, and locks the proforma', async () => {
    await issue('FACTURE'); // 01
    const fp = await issue('PROFORMA', { note: 'Avance 50 %' });
    await db.update((d) => {
      Object.assign(d.clients.find((c) => c.id === 'cl-mdm')!, { clientType: 'COMPANY', legalName: 'SARL MDM', rc: 'RC-1', nif: 'NIF-1' });
    });

    const res = await convert(fp.id, { paymentMethod: 'ESPECE', withStamp: true });
    expect(res.status).toBe(201);
    const { invoice, source } = await res.json() as { invoice: InvoiceRecord; source: InvoiceRecord };
    const year = new Date().getUTCFullYear();
    expect(invoice).toMatchObject({
      kind: 'FACTURE', number: `02/${year}`, convertedFromId: fp.id, withStamp: true, note: 'Avance 50 %',
      lines: fp.lines, vatRate: 19, paymentMethod: 'ESPECE', status: 'ISSUED',
    });
    // A cash facture carries the timbre the proforma did not.
    expect(invoice.totals.timbre).toBeGreaterThan(0);
    expect(fp.totals.timbre).toBe(0);
    expect(buildInvoiceViewModel(invoice).clientLines).toEqual(expect.arrayContaining(['SARL MDM', 'RC: RC-1']));
    expect(source).toMatchObject({ convertedToInvoiceId: invoice.id, convertedToNumber: `02/${year}`, status: 'ISSUED' });

    // Locked: no second conversion, no edit, no stamp toggle — and no extra facture.
    expect((await (await convert(fp.id, { paymentMethod: 'ESPECE', withStamp: false })).json()).error.code).toBe('CONVERTED');
    expect((await put(fp.id, edit)).status).toBe(409);
    expect((await patch(fp.id, { withStamp: false })).status).toBe(409);
    expect((await db.read()).invoices!.filter((i) => (i.kind ?? 'FACTURE') === 'FACTURE')).toHaveLength(2);

    // The next facture continues the sequence: no hole, no reuse.
    expect((await issue('FACTURE')).number).toBe(`03/${year}`);
  });

  it('converts a devis too', async () => {
    const dv = await issue('DEVIS');
    expect((await convert(dv.id, { paymentMethod: 'CHEQUE', withStamp: false })).status).toBe(201);
  });

  it('refuses a facture, a cancelled proforma, and virement without a RIB — writing nothing', async () => {
    const f = await issue('FACTURE');
    expect((await (await convert(f.id, { paymentMethod: 'ESPECE', withStamp: false })).json()).error.code).toBe('FACTURE_LOCKED');
    const fp = await issue('PROFORMA');
    await patch(fp.id, { status: 'CANCELLED' });
    expect((await (await convert(fp.id, { paymentMethod: 'ESPECE', withStamp: false })).json()).error.code).toBe('CANCELLED');
    const fp2 = await issue('PROFORMA');
    await db.update((d) => { (d.incubators[0] as { bankRib?: string | null }).bankRib = null; });
    expect((await convert(fp2.id, { paymentMethod: 'VIREMENT', withStamp: false })).status).toBe(422);
    const d = await db.read();
    expect(d.invoices!.filter((i) => (i.kind ?? 'FACTURE') === 'FACTURE')).toHaveLength(1);
    expect(d.invoices!.every((i) => !i.convertedToInvoiceId)).toBe(true);
  });

  it('rejects a bad body', async () => {
    const fp = await issue('PROFORMA');
    expect((await convert(fp.id, { paymentMethod: 'BITCOIN', withStamp: false })).status).toBe(422);
  });
});
