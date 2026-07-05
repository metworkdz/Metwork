/**
 * Smoke tests for the invoice PDF pipeline (src/server/invoices/pdf/).
 *
 * Renders one invoice per template and checks a real PDF Buffer comes back.
 * Also pins the view-model rules the templates rely on: timbre row only for
 * ESPECE, empty legal lines omitted, stored totals rendered verbatim.
 */
import { describe, it, expect } from 'vitest';
import type { InvoiceRecord } from '@/server/db/store';
import { renderInvoicePdf } from '@/server/invoices/pdf';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_test_1',
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
      rc: '16/00-1234567B26',
      nif: '002616123456789',
      nis: '002616123456780',
      ai: '16123456789',
      phone: '0550 12 34 56',
      email: 'contact@technova.dz',
    },
    issuerSnapshot: {
      name: 'Metwork Hub',
      address: '12 Rue Didouche Mourad, Alger',
      rc: '16/00-7654321B24',
      nif: '002616987654321',
      nis: '002616987654320',
      ai: '16987654321',
      logoUrl: null, // no network fetch in tests
      website: 'www.metwork.dz',
      contactEmail: 'contact@metwork.dz',
      contactPhone: '023 45 67 89',
      bankName: 'BNA — Agence d\'Oran',
      bankRib: '00100000000000000000',
    },
    lines: [
      { designation: 'Abonnement coworking — juillet 2026', quantity: 2, unitPriceHt: 10_000 },
      { designation: 'Domiciliation commerciale', quantity: 1, unitPriceHt: 4_000 },
    ],
    vatRate: 19,
    paymentMethod: 'ESPECE',
    template: 'CLASSIC',
    totals: { ht: 24_000, tva: 4_560, ttc: 28_560, timbre: 286, net: 28_846 },
    amountInWords:
      'VINGT HUIT MILLE HUIT CENT QUARANTE SIX DINARS',
    status: 'ISSUED',
    createdAt: '2026-07-05T10:00:00.000Z',
    updatedAt: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('renderInvoicePdf', () => {
  it.each(['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const)(
    'renders a valid PDF with the %s template',
    async (template) => {
      const buf = await renderInvoicePdf(makeInvoice({ template }));
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(10_000); // embedded fonts ⇒ non-trivial size
    },
  );

  it.each(['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const)(
    'renders a VIREMENT invoice (bank details block) with the %s template',
    async (template) => {
      const buf = await renderInvoicePdf(
        makeInvoice({
          template,
          paymentMethod: 'VIREMENT',
          totals: { ht: 24_000, tva: 4_560, ttc: 28_560, timbre: 0, net: 28_560 },
        }),
      );
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    },
  );

  it('renders many lines across multiple pages without throwing', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      designation: `Prestation n°${i + 1} — accompagnement et mise à disposition d'espace`,
      quantity: 1,
      unitPriceHt: 1_000,
    }));
    const buf = await renderInvoicePdf(
      makeInvoice({ lines, totals: { ht: 60_000, tva: 11_400, ttc: 71_400, timbre: 1_071, net: 72_471 } }),
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('buildInvoiceViewModel', () => {
  it('shows the timbre row only for ESPECE', () => {
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'ESPECE' })).showTimbre).toBe(true);
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'VIREMENT' })).showTimbre).toBe(false);
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'CHEQUE' })).showTimbre).toBe(false);
  });

  it('shows the issuer bank details only for VIREMENT', () => {
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'VIREMENT' })).bankLines).toEqual([
      "Banque: BNA — Agence d'Oran",
      'RIB: 00100000000000000000',
    ]);
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'ESPECE' })).bankLines).toEqual([]);
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'CHEQUE' })).bankLines).toEqual([]);
  });

  it('renders stored totals verbatim (no recomputation)', () => {
    // Deliberately inconsistent totals — the VM must NOT "fix" them.
    const vm = buildInvoiceViewModel(
      makeInvoice({ totals: { ht: 1, tva: 2, ttc: 3, timbre: 4, net: 5 } }),
    );
    expect(vm.totals).toEqual({
      ht: '1,00 DA', tva: '2,00 DA', ttc: '3,00 DA',
      timbre: '4,00 DA', net: '5,00 DA',
    });
  });

  it('omits empty legal lines and switches the client block by type', () => {
    const vm = buildInvoiceViewModel(
      makeInvoice({
        clientSnapshot: {
          clientType: 'INDIVIDUAL',
          name: 'Amina Cherif',
          address: null, rc: null, nif: null, nis: null, ai: null,
          phone: '0770 11 22 33',
          email: null,
        },
        issuerSnapshot: {
          name: 'Metwork Hub',
          address: null, rc: '16/00-7654321B24', nif: '002616987654321',
          nis: null, ai: null, logoUrl: null,
          website: null, contactEmail: null, contactPhone: null,
        },
      }),
    );
    expect(vm.clientLines).toEqual(['Amina Cherif', 'N TEL: 0770 11 22 33']);
    expect(vm.issuerLines).toEqual([
      'Metwork Hub', 'RCN: 16/00-7654321B24', 'NIF: 002616987654321',
    ]);
    expect(vm.footerItems).toEqual([]);
  });

  it('labels the payment method in French', () => {
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'ESPECE' })).paymentLabel).toBe('Espèce');
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'CHEQUE' })).paymentLabel).toBe('Chèque');
    expect(buildInvoiceViewModel(makeInvoice({ paymentMethod: 'VIREMENT' })).paymentLabel).toBe('Virement bancaire');
  });

  it('formats the date dd/mm/yyyy and keeps the number verbatim', () => {
    const vm = buildInvoiceViewModel(makeInvoice());
    expect(vm.date).toBe('05/07/2026');
    expect(vm.number).toBe('07/2026');
  });
});
