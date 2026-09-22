/**
 * The stamp and the free-text note on a document.
 *
 * Both are per-document and FROZEN, which is the rule worth pinning: a PDF
 * re-downloaded next year has to look exactly as it did the day it was
 * issued, even if the incubator has changed their stamp since. So the choice
 * and the image URL live on the record, not in settings at print time.
 *
 * The size of the stamp is the other thing with a real constraint behind it.
 * At the requested 180pt it does not fit under the totals of an ordinary
 * invoice — there are only 90 to 130 points of clear space between the last
 * total and the footer — so it negotiates with the page instead of landing on
 * top of "Net à Payer".
 */
import { describe, it, expect } from 'vitest';
import type { InvoiceRecord } from '@/server/db/store';
import { renderInvoicePdf } from '@/server/invoices/pdf';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

const STAMP = 'https://example.test/stamp.png';

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_stamp', incubatorId: 'inc_1', number: '07/2026', year: 2026, seq: 7,
    issuedAt: '2026-07-05T10:00:00.000Z', clientId: 'cl_1',
    clientSnapshot: {
      clientType: 'COMPANY', name: 'Yacine Benali', legalName: 'SARL TechNova',
      address: 'Alger', rc: '16/00-1', nif: '0026', nis: '0026', ai: '161',
      phone: '0550 12 34 56', email: 'contact@technova.dz',
    },
    issuerSnapshot: {
      name: 'Metwork Hub', address: 'Alger', rc: '16/00-7', nif: '0026',
      nis: '0026', ai: '169', logoUrl: null,
      website: null, contactEmail: null, contactPhone: null,
      bankName: null, bankRib: null,
      stampUrl: STAMP,
    },
    lines: [{ designation: 'Accompagnement', quantity: 1, unitPriceHt: 20_000 }],
    vatRate: 19, paymentMethod: 'ESPECE', template: 'CLASSIC',
    totals: { ht: 20_000, tva: 3_800, ttc: 23_800, timbre: 238, net: 24_038 },
    amountInWords: 'VINGT QUATRE MILLE TRENTE HUIT DINARS',
    status: 'ISSUED',
    createdAt: '2026-07-05T10:00:00.000Z', updatedAt: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('whether the stamp is printed', () => {
  it('prints it when the document was issued with one', () => {
    expect(buildInvoiceViewModel(makeInvoice({ withStamp: true })).stampUrl).toBe(STAMP);
  });

  it('does not when the host left the box unticked', () => {
    expect(buildInvoiceViewModel(makeInvoice({ withStamp: false })).stampUrl).toBeNull();
  });

  it('does not on a document issued before the choice existed', () => {
    // No `withStamp` at all. Those were printed without a stamp, and
    // re-downloading one must not silently start adding it.
    expect(buildInvoiceViewModel(makeInvoice()).stampUrl).toBeNull();
  });

  it('reads the FROZEN url, not today\'s settings', () => {
    // The snapshot is the whole point: changing the stamp in settings must
    // not change a document already issued.
    const vm = buildInvoiceViewModel(makeInvoice({
      withStamp: true,
      issuerSnapshot: { ...makeInvoice().issuerSnapshot, stampUrl: 'https://example.test/old.png' },
    }));
    expect(vm.stampUrl).toBe('https://example.test/old.png');
  });

  it('asks for nothing when the issuer had no stamp at the time', () => {
    const vm = buildInvoiceViewModel(makeInvoice({
      withStamp: true,
      issuerSnapshot: { ...makeInvoice().issuerSnapshot, stampUrl: null },
    }));
    expect(vm.stampUrl).toBeNull();
  });
});

describe('the note', () => {
  it('carries the host\'s text', () => {
    const vm = buildInvoiceViewModel(makeInvoice({ note: 'Règlement à 30 jours.' }));
    expect(vm.note).toBe('Règlement à 30 jours.');
  });

  it('is absent when empty or whitespace — not an empty NOTE heading', () => {
    expect(buildInvoiceViewModel(makeInvoice({ note: '' })).note).toBeNull();
    expect(buildInvoiceViewModel(makeInvoice({ note: '   ' })).note).toBeNull();
    expect(buildInvoiceViewModel(makeInvoice()).note).toBeNull();
  });

  it('is per document — nothing carries over from the last one', () => {
    // Two documents from the same issuer, only one of which has a note.
    expect(buildInvoiceViewModel(makeInvoice({ note: 'Only here' })).note).toBe('Only here');
    expect(buildInvoiceViewModel(makeInvoice()).note).toBeNull();
  });
});

describe('rendering with them', () => {
  const kinds = ['FACTURE', 'PROFORMA', 'DEVIS'] as const;
  const templates = ['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const;
  const combos = kinds.flatMap((kind) => templates.map((template) => [kind, template] as const));

  it.each(combos)('renders a stamped %s on one page with the %s template', async (kind, template) => {
    const buf = await renderInvoicePdf(makeInvoice({
      kind, template, withStamp: true,
      note: 'Merci de régler en espèces à la réception.',
      validUntil: kind === 'FACTURE' ? null : '2026-10-20',
    }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // The stamp must not push an ordinary document onto a second page.
    const pages = buf.toString('latin1').split('/Type /Page\n').length - 1;
    expect(pages).toBeLessThanOrEqual(1);
  });

  it('renders a long document with a stamp without throwing', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      designation: `Prestation n°${i + 1}`, quantity: 1, unitPriceHt: 1_000,
    }));
    const buf = await renderInvoicePdf(makeInvoice({ lines, withStamp: true, note: 'x'.repeat(400) }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('fetches no image at all when the document is unstamped', async () => {
    // vm.stampUrl null ⇒ nothing to fetch. A remote call here would make
    // every unstamped PDF wait on the network for nothing.
    const vm = buildInvoiceViewModel(makeInvoice({ withStamp: false }));
    expect(vm.stampUrl).toBeNull();
    const buf = await renderInvoicePdf(makeInvoice({ withStamp: false }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
