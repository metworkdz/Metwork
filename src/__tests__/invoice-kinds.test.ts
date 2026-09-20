/**
 * Facture, facture proforma and devis — one document system, three documents.
 *
 * They look alike, and that is exactly the danger: a proforma printed as a
 * facture with a different word at the top is a document somebody will file as
 * a facture. So the tests here are not about layout. They pin the four rules
 * that have consequences if they slip:
 *
 *   1. A proforma or a devis must never consume a facture number. A facture
 *      sequence has to be gapless — that is what an inspection looks at — and
 *      every hole is a question about an invoice that does not exist.
 *   2. No droit de timbre on either new document. It is a duty on a payment;
 *      nothing has been paid, so charging it asserts a tax that was not
 *      collected AND inflates the figure the client is being quoted.
 *   3. A devis must carry a validity date. Without one it is an open-ended
 *      commitment to that price.
 *   4. Everything already issued keeps its number and keeps reading as a
 *      facture, because nothing was migrated.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { IncubatorRecord, InvoiceRecord } from '@/server/db/store';
import {
  allocateInvoiceNumber,
  computeInvoiceTotals,
  computeStampDuty,
  counterKey,
  formatInvoiceNumber,
  peekNextSeq,
} from '@/server/invoices/engine';
import { renderInvoicePdf } from '@/server/invoices/pdf';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

const MANAGER_EMAIL = 'manager@qa-incubator.dz';

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
  requireApprovedApiRole: vi.fn(async () => ({ ok: true, user: { id: 'u1', email: MANAGER_EMAIL } })),
}));

import { db } from '@/server/db/store';
import { POST as createInvoice } from '@/app/api/incubator/invoices/route';

/* ════════════════════════ Numbering ════════════════════════ */

function makeIncubator(counters?: Record<string, number>): IncubatorRecord {
  return {
    id: 'inc_1',
    name: 'Test Hub',
    city: 'Alger',
    status: 'ACTIVE',
    invoiceCounters: counters ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as IncubatorRecord;
}

describe('each document counts in its own sequence', () => {
  it('numbers the three kinds independently, with a visible prefix', () => {
    const inc = makeIncubator();
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'FACTURE')).toEqual({ number: '01/2026', seq: 1 });
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'PROFORMA')).toEqual({ number: 'FP 01/2026', seq: 1 });
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'DEVIS')).toEqual({ number: 'DV 01/2026', seq: 1 });
  });

  it('never lets a proforma or a devis punch a hole in the facture sequence', () => {
    const inc = makeIncubator();
    allocateInvoiceNumber(inc, 2026, undefined, 'FACTURE'); // 01/2026
    allocateInvoiceNumber(inc, 2026, undefined, 'PROFORMA');
    allocateInvoiceNumber(inc, 2026, undefined, 'PROFORMA');
    allocateInvoiceNumber(inc, 2026, undefined, 'DEVIS');
    // The next facture is 02, not 05.
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'FACTURE')).toEqual({ number: '02/2026', seq: 2 });
  });

  it('keeps the bare-year key for factures, so stored counters need no migration', () => {
    const inc = makeIncubator({ '2026': 8 }); // written before the other kinds existed
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'FACTURE')).toEqual({ number: '09/2026', seq: 9 });
    expect(inc.invoiceCounters).toEqual({ '2026': 9 });
    expect(counterKey('FACTURE', 2026)).toBe('2026');
  });

  it('defaults to FACTURE when no kind is passed — every existing caller', () => {
    const inc = makeIncubator();
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '01/2026', seq: 1 });
    expect(formatInvoiceNumber(3, 2026)).toBe('03/2026');
  });

  it('honours a custom starting range per kind, then continues from it', () => {
    // The incubator already has eight proformas in a paper book.
    const inc = makeIncubator();
    expect(allocateInvoiceNumber(inc, 2026, 9, 'PROFORMA')).toEqual({ number: 'FP 09/2026', seq: 9 });
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'PROFORMA')).toEqual({ number: 'FP 10/2026', seq: 10 });
    // …and the facture sequence is untouched by any of it.
    expect(allocateInvoiceNumber(inc, 2026, undefined, 'FACTURE')).toEqual({ number: '01/2026', seq: 1 });
  });

  it('peekNextSeq reads the next number without consuming it', () => {
    const inc = makeIncubator({ '2026': 4, 'PROFORMA:2026': 2 });
    expect(peekNextSeq(inc, 2026)).toBe(5);
    expect(peekNextSeq(inc, 2026, 'PROFORMA')).toBe(3);
    expect(peekNextSeq(inc, 2026, 'DEVIS')).toBe(1);
    // Read three times, nothing moved.
    expect(inc.invoiceCounters).toEqual({ '2026': 4, 'PROFORMA:2026': 2 });
  });
});

/* ════════════════════════ Stamp duty ════════════════════════ */

describe('no droit de timbre where nothing has been paid', () => {
  it.each(['PROFORMA', 'DEVIS'] as const)('is zero on a %s, in every bracket', (kind) => {
    expect(computeStampDuty(10_000, 'ESPECE', kind)).toBe(0);
    expect(computeStampDuty(60_000, 'ESPECE', kind)).toBe(0);
    expect(computeStampDuty(250_000, 'ESPECE', kind)).toBe(0);
  });

  it('still charges it on a cash facture — the rule that was already there', () => {
    expect(computeStampDuty(10_000, 'ESPECE', 'FACTURE')).toBe(100);
    expect(computeStampDuty(10_000, 'ESPECE')).toBe(100); // no kind = facture
  });

  it('leaves the net equal to the TTC on a proforma, not TTC + timbre', () => {
    const lines = [{ designation: 'Accompagnement', quantity: 1, unitPriceHt: 24_000 }];
    const facture = computeInvoiceTotals(lines, 19, 'ESPECE', 'FACTURE');
    const proforma = computeInvoiceTotals(lines, 19, 'ESPECE', 'PROFORMA');

    expect(facture.timbre).toBe(286);
    expect(facture.net).toBe(28_846);
    expect(proforma.timbre).toBe(0);
    expect(proforma.net).toBe(proforma.ttc);
    expect(proforma.net).toBe(28_560);
  });
});

/* ════════════════════════ What the PDF says ════════════════════════ */

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_kind_1',
    incubatorId: 'inc_1',
    number: '07/2026',
    year: 2026,
    seq: 7,
    issuedAt: '2026-07-05T10:00:00.000Z',
    clientId: 'cl_1',
    clientSnapshot: {
      clientType: 'COMPANY',
      name: 'Yacine Benali',
      legalName: 'SARL TechNova',
      address: 'Cité 200 logts, Bab Ezzouar, Alger',
      rc: '16/00-1234567B26', nif: '002616123456789',
      nis: '002616123456780', ai: '16123456789',
      phone: '0550 12 34 56', email: 'contact@technova.dz',
    },
    issuerSnapshot: {
      name: 'Metwork Hub',
      address: '12 Rue Didouche Mourad, Alger',
      rc: '16/00-7654321B24', nif: '002616987654321',
      nis: '002616987654320', ai: '16987654321',
      logoUrl: null, // no network fetch in tests
      website: 'www.metwork.dz', contactEmail: 'contact@metwork.dz', contactPhone: '023 45 67 89',
      bankName: 'BNA — Agence d\'Oran', bankRib: '00100000000000000000',
    },
    lines: [{ designation: 'Abonnement coworking — juillet 2026', quantity: 2, unitPriceHt: 10_000 }],
    vatRate: 19,
    paymentMethod: 'ESPECE',
    template: 'CLASSIC',
    totals: { ht: 20_000, tva: 3_800, ttc: 23_800, timbre: 0, net: 23_800 },
    amountInWords: 'VINGT TROIS MILLE HUIT CENTS DINARS',
    status: 'ISSUED',
    createdAt: '2026-07-05T10:00:00.000Z',
    updatedAt: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('the document says which document it is', () => {
  it('titles each kind', () => {
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'FACTURE' })).title).toBe('FACTURE');
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'PROFORMA' })).title).toBe('FACTURE PROFORMA');
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'DEVIS' })).title).toBe('DEVIS');
  });

  it('reads a record with no kind as a facture', () => {
    // Everything issued before this feature existed.
    const vm = buildInvoiceViewModel(makeInvoice());
    expect(vm.kind).toBe('FACTURE');
    expect(vm.title).toBe('FACTURE');
    expect(vm.notices).toEqual([]);
  });

  it('declares on a proforma that it is not an invoice', () => {
    const vm = buildInvoiceViewModel(makeInvoice({ kind: 'PROFORMA' }));
    expect(vm.notices).toEqual([
      "Ce document n'est pas une facture et ne vaut pas pièce comptable.",
    ]);
  });

  it('prints the validity date the way a reader reads it', () => {
    const vm = buildInvoiceViewModel(makeInvoice({ kind: 'DEVIS', validUntil: '2026-08-04' }));
    expect(vm.notices).toEqual(["Devis valable jusqu'au 04/08/2026."]);
    expect(vm.showAcceptance).toBe(true);
  });

  it('hides the timbre row on the two new kinds even when paid in cash', () => {
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'FACTURE', paymentMethod: 'ESPECE' })).showTimbre).toBe(true);
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'PROFORMA', paymentMethod: 'ESPECE' })).showTimbre).toBe(false);
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'DEVIS', paymentMethod: 'ESPECE' })).showTimbre).toBe(false);
  });

  it('only offers a signature line on the devis', () => {
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'FACTURE' })).showAcceptance).toBe(false);
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'PROFORMA' })).showAcceptance).toBe(false);
  });

  it('agrees with itself grammatically', () => {
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'DEVIS' })).amountInWordsLabel)
      .toBe('Arrêté le présent devis à la somme de :');
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'DEVIS', status: 'CANCELLED' })).cancelledLabel)
      .toBe('ANNULÉ');
    expect(buildInvoiceViewModel(makeInvoice({ kind: 'PROFORMA', status: 'CANCELLED' })).cancelledLabel)
      .toBe('ANNULÉE');
  });
});

describe('renderInvoicePdf across kinds and templates', () => {
  const combos = (['FACTURE', 'PROFORMA', 'DEVIS'] as const).flatMap((kind) =>
    (['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const).map((template) => [kind, template] as const),
  );

  it.each(combos)('renders a %s with the %s template', async (kind, template) => {
    const buf = await renderInvoicePdf(
      makeInvoice({ kind, template, validUntil: kind === 'FACTURE' ? null : '2026-08-04' }),
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10_000); // embedded fonts ⇒ non-trivial size
  });
});

/* ════════════════════════ The create route ════════════════════════ */

const INC = 'inc-kinds';
const NOW = '2026-01-01T00:00:00.000Z';
/** The route stamps the CURRENT year onto the number, so the test follows it. */
const YEAR = new Date().getUTCFullYear();

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.clients = [];
    d.invoices = [];
    d.incubators = [
      {
        id: INC, name: 'QA Incubator', city: 'Oran', status: 'ACTIVE',
        managerId: 'u1', email: MANAGER_EMAIL,
        commercialRegNumber: '16/00-7654321B24', nif: '002616987654321',
        bankRib: '00100000000000000000', invoiceCounters: null,
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.clients = [
      {
        id: 'cl-kinds', incubatorId: INC, fullName: 'Amina Cherif', email: 'amina@example.dz',
        phone: '0770112233', clientType: 'INDIVIDUAL', createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
  });
}

function post(body: Record<string, unknown>) {
  return createInvoice(
    new NextRequest('http://localhost/api/incubator/invoices', {
      method: 'POST',
      body: JSON.stringify({
        clientId: 'cl-kinds',
        lines: [{ designation: 'Accompagnement', quantity: 1, unitPriceHt: 24_000 }],
        vatRate: 19,
        paymentMethod: 'ESPECE',
        ...body,
      }),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('POST /api/incubator/invoices', () => {
  beforeEach(async () => { await seed(); });

  it('refuses a devis with no validity date', async () => {
    const res = await post({ kind: 'DEVIS' });
    expect(res.status).toBe(422);
    expect((await db.read()).invoices).toHaveLength(0);
  });

  it('accepts a devis that has one, and stores it', async () => {
    const res = await post({ kind: 'DEVIS', validUntil: '2026-08-04' });
    expect(res.status).toBe(201);
    const invoice = await res.json() as InvoiceRecord;
    expect(invoice.kind).toBe('DEVIS');
    expect(invoice.number).toBe(`DV 01/${YEAR}`);
    expect(invoice.validUntil).toBe('2026-08-04');
    // Rule 2, end to end: a cash devis carries no timbre.
    expect(invoice.totals.timbre).toBe(0);
    expect(invoice.totals.net).toBe(invoice.totals.ttc);
  });

  it('lets a facture and a proforma share the same sequence number', async () => {
    // "01/2026" and "FP 01/2026" are different documents. Refusing the second
    // one would be the collision check confusing a prefix for a duplicate.
    expect((await post({ kind: 'FACTURE', seq: 1 })).status).toBe(201);
    const proforma = await post({ kind: 'PROFORMA', seq: 1 });
    expect(proforma.status).toBe(201);
    expect(((await proforma.json()) as InvoiceRecord).number).toBe(`FP 01/${YEAR}`);
  });

  it('still refuses a number already used by the SAME kind', async () => {
    expect((await post({ kind: 'PROFORMA', seq: 3 })).status).toBe(201);
    const dupe = await post({ kind: 'PROFORMA', seq: 3 });
    expect(dupe.status).toBe(409);
    const body = await dupe.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NUMBER_TAKEN');
    expect(body.error.message).toContain(`FP 03/${YEAR}`);
  });

  it('starts a series where the incubator says, then continues from there', async () => {
    // "some incubators already have invoices, so they need to start at 09/2026"
    const first = await post({ seq: 9 });
    expect(((await first.json()) as InvoiceRecord).number).toBe(`09/${YEAR}`);
    const next = await post({});
    expect(((await next.json()) as InvoiceRecord).number).toBe(`10/${YEAR}`);
  });

  it('defaults to a facture when no kind is sent — the old client', async () => {
    const res = await post({});
    const invoice = await res.json() as InvoiceRecord;
    expect(invoice.kind).toBe('FACTURE');
    expect(invoice.number).toBe(`01/${YEAR}`);
    expect(invoice.totals.timbre).toBe(286); // cash facture keeps its timbre
  });
});
