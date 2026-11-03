/**
 * The date of a new document: today by default, any earlier day on request.
 *
 * What these pin:
 *   - an earlier date is stored (noon UTC, so every time zone prints that day)
 *     and its YEAR picks the numbering sequence;
 *   - a refused date never burns a number (the sequence stays gapless);
 *   - the future, impossible days and absurdly old days are refused with a 422;
 *   - editing a draft cannot change the date.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { InvoiceRecord } from '@/server/db/store';
import { algiersToday, checkIssueDay } from '@/lib/invoice-date';

const MANAGER_EMAIL = 'manager@date-incubator.dz';

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
  requireApprovedApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
}));

import { db } from '@/server/db/store';
import { POST as createInvoice } from '@/app/api/incubator/invoices/route';
import { PUT } from '@/app/api/incubator/invoices/[id]/route';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

const INC = 'inc-date';
const NOW = '2026-01-01T00:00:00.000Z';

async function seed(counters: Record<string, number> | null = null): Promise<void> {
  await db.update((d) => {
    d.users = []; d.invoices = [];
    d.incubators = [{
      id: INC, name: 'Date Incubator', city: 'Oran', status: 'ACTIVE', managerId: 'u1', email: MANAGER_EMAIL,
      commercialRegNumber: '16/00-7654321B24', nif: '002616987654321', bankRib: '00100000000000000000',
      invoiceCounters: counters, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.clients = [{
      id: 'cl-date', incubatorId: INC, fullName: 'Amina Cherif', email: 'amina@example.dz',
      phone: '0770112233', clientType: 'INDIVIDUAL', createdAt: NOW, updatedAt: NOW,
    } as never];
  });
}

const post = (body: Record<string, unknown>) =>
  createInvoice(new NextRequest('http://localhost/api/incubator/invoices', {
    method: 'POST',
    body: JSON.stringify({
      clientId: 'cl-date',
      lines: [{ designation: 'Accompagnement', quantity: 1, unitPriceHt: 24_000 }],
      vatRate: 19,
      paymentMethod: 'ESPECE',
      ...body,
    }),
    headers: { 'content-type': 'application/json' },
  }));

const putInvoice = (id: string, body: Record<string, unknown>) =>
  PUT(new NextRequest('http://localhost/x', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

const counters = async () => (await db.read()).incubators.find((i) => i.id === INC)!.invoiceCounters;

describe('lib/invoice-date: checkIssueDay', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  it('accepts today and any earlier day', () => {
    expect(checkIssueDay('2026-11-03', now)).toBeNull();
    expect(checkIssueDay('2025-03-12', now)).toBeNull();
    expect(checkIssueDay('2000-01-01', now)).toBeNull();
  });
  it('refuses tomorrow, impossible days, junk and pre-2000 days', () => {
    expect(checkIssueDay('2026-11-04', now)).toBe('IN_FUTURE');
    expect(checkIssueDay('2026-02-30', now)).toBe('INVALID_DATE');
    expect(checkIssueDay('hello', now)).toBe('INVALID_DATE');
    expect(checkIssueDay('1999-12-31', now)).toBe('TOO_OLD');
  });
  it('uses Algeria’s day: just after midnight there, "today" is already the next UTC date', () => {
    expect(checkIssueDay('2026-11-04', new Date('2026-11-03T23:30:00Z'))).toBeNull();
  });
});

describe('POST /api/incubator/invoices — issuedOn', () => {
  beforeEach(async () => { await seed(); });

  it('defaults to today when no date is sent', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    const inv = await res.json() as InvoiceRecord;
    expect(inv.issuedAt.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('stores an earlier date at noon UTC and prints that exact day', async () => {
    const res = await post({ issuedOn: '2025-03-12' });
    expect(res.status).toBe(201);
    const inv = await res.json() as InvoiceRecord;
    expect(inv.issuedAt).toBe('2025-03-12T12:00:00.000Z');
    expect(buildInvoiceViewModel(inv).date).toBe('12/03/2025');
    // createdAt stays the real moment the record was made.
    expect(inv.createdAt.slice(0, 4)).toBe(String(new Date().getUTCFullYear()));
  });

  it('numbers a document in the series of its OWN year', async () => {
    const a = await (await post({ issuedOn: '2025-03-12' })).json() as InvoiceRecord;
    const b = await (await post({ issuedOn: '2025-04-01' })).json() as InvoiceRecord;
    const c = await (await post({})).json() as InvoiceRecord;
    expect(a.number).toBe('01/2025');
    expect(b.number).toBe('02/2025');
    expect(c.number).toBe(`01/${new Date().getUTCFullYear()}`);
    expect(await counters()).toEqual({ '2025': 2, [String(new Date().getUTCFullYear())]: 1 });
  });

  it('honours a typed number within the chosen year', async () => {
    const res = await post({ issuedOn: '2025-03-12', seq: 7 });
    expect(((await res.json()) as InvoiceRecord).number).toBe('07/2025');
    const next = await post({ issuedOn: '2025-05-02' });
    expect(((await next.json()) as InvoiceRecord).number).toBe('08/2025');
  });

  it('refuses a future date, an impossible one and a pre-2000 one — without burning a number', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    for (const [issuedOn, code] of [[tomorrow, 'IN_FUTURE'], ['2026-02-30', 'INVALID_DATE'], ['1999-12-31', 'TOO_OLD']] as const) {
      const res = await post({ issuedOn });
      expect(res.status).toBe(422);
      expect(JSON.stringify(await res.json())).toContain(code);
    }
    expect((await db.read()).invoices).toHaveLength(0);
    expect(await counters()).toBeNull();
    const ok = await post({});
    expect(((await ok.json()) as InvoiceRecord).seq).toBe(1);
  });

  it('rejects a malformed value at the schema', async () => {
    expect((await post({ issuedOn: '03/11/2026' })).status).toBe(422);
    expect((await post({ issuedOn: 20261103 })).status).toBe(422);
    expect((await db.read()).invoices).toHaveLength(0);
  });

  it('cannot be changed by editing a draft: the date and number are the document\'s', async () => {
    const fp = await (await post({ kind: 'PROFORMA', issuedOn: '2025-03-12' })).json() as InvoiceRecord;
    const res = await putInvoice(fp.id, {
      clientId: 'cl-date',
      lines: [{ designation: 'Autre', quantity: 1, unitPriceHt: 1_000 }],
      paymentMethod: 'VIREMENT',
      issuedOn: '2020-01-01',
    });
    expect(res.status).toBe(200);
    const { invoice } = await res.json() as { invoice: InvoiceRecord };
    expect(invoice.issuedAt).toBe('2025-03-12T12:00:00.000Z');
    expect(invoice.number).toBe(fp.number);
  });

  it('refuses a validity date earlier than the chosen document date', async () => {
    const res = await post({ kind: 'DEVIS', issuedOn: '2026-09-10', validUntil: '2026-09-01' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('VALIDITY_BEFORE_DATE');
    expect((await db.read()).invoices).toHaveLength(0);
    const ok = await post({ kind: 'DEVIS', issuedOn: '2026-09-10', validUntil: '2026-10-10' });
    expect(ok.status).toBe(201);
  });

  it('works the same for a proforma and for today’s Algiers date', async () => {
    const res = await post({ kind: 'PROFORMA', issuedOn: algiersToday() });
    expect(res.status).toBe(201);
  });
});
