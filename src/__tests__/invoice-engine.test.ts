/**
 * Unit tests for the canonical invoice engine
 * (src/server/invoices/engine.ts).
 *
 * This module is the single source of truth for invoice money math (HT / TVA /
 * TTC / droit de timbre / net), the "NN/YYYY" numbering, DZD display
 * formatting and the frozen French amount-in-words — the UI and PDF layers
 * consume stored results and never recompute, so these tests pin the exact
 * values, including both stamp-duty bracket boundaries (30 000 / 100 000 DZD).
 */
import { describe, it, expect } from 'vitest';
import type { IncubatorRecord } from '@/server/db/store';
import {
  allocateInvoiceNumber,
  amountToFrenchWords,
  computeInvoiceTotals,
  computeStampDuty,
  formatDZD,
  formatDZDWhole,
  formatInvoiceNumber,
  round2,
} from '@/server/invoices/engine';

const NBSP = '\u00A0';

describe('computeInvoiceTotals', () => {
  it('sums lines, applies VAT and adds timbre for ESPECE', () => {
    // 2 × 10 000 + 1 × 4 000 = 24 000 HT ; 19% TVA = 4 560 ; TTC = 28 560
    // timbre (≤30 000, espèce) = 1% = 286 ; net = 28 846
    const t = computeInvoiceTotals(
      [
        { designation: 'Coworking — pack mensuel', quantity: 2, unitPriceHt: 10_000 },
        { designation: 'Domiciliation', quantity: 1, unitPriceHt: 4_000 },
      ],
      19,
      'ESPECE',
    );
    expect(t).toEqual({ ht: 24_000, tva: 4_560, ttc: 28_560, timbre: 286, net: 28_846 });
  });

  it('rounds TVA to 2 decimals and keeps net = ttc for non-cash', () => {
    // 3 × 33.33 = 99.99 HT ; 19% = 18.9981 → 19.00 ; TTC = 118.99
    const t = computeInvoiceTotals(
      [{ designation: 'Impression', quantity: 3, unitPriceHt: 33.33 }],
      19,
      'VIREMENT',
    );
    expect(t.ht).toBe(99.99);
    expect(t.tva).toBe(19.0);
    expect(t.ttc).toBe(118.99);
    expect(t.timbre).toBe(0);
    expect(t.net).toBe(118.99);
  });

  it('handles a 0% VAT rate', () => {
    const t = computeInvoiceTotals(
      [{ designation: 'Formation', quantity: 1, unitPriceHt: 50_000 }],
      0,
      'CHEQUE',
    );
    expect(t).toEqual({ ht: 50_000, tva: 0, ttc: 50_000, timbre: 0, net: 50_000 });
  });
});

describe('computeStampDuty — brackets and boundaries', () => {
  it('is 0 for CHEQUE and VIREMENT regardless of amount', () => {
    expect(computeStampDuty(500_000, 'CHEQUE')).toBe(0);
    expect(computeStampDuty(500_000, 'VIREMENT')).toBe(0);
  });

  it('applies 1% up to and including 30 000', () => {
    expect(computeStampDuty(10_000, 'ESPECE')).toBe(100);
    expect(computeStampDuty(30_000, 'ESPECE')).toBe(300); // boundary stays in the 1% bracket
  });

  it('applies 1.5% from just above 30 000 up to and including 100 000', () => {
    expect(computeStampDuty(30_001, 'ESPECE')).toBe(450); // 450.015 → 450
    expect(computeStampDuty(60_000, 'ESPECE')).toBe(900);
    expect(computeStampDuty(100_000, 'ESPECE')).toBe(1_500); // boundary stays in the 1.5% bracket
  });

  it('applies 2% above 100 000', () => {
    expect(computeStampDuty(100_001, 'ESPECE')).toBe(2_000); // 2000.02 → 2000
    expect(computeStampDuty(250_000, 'ESPECE')).toBe(5_000);
  });

  it('rounds to the whole dinar', () => {
    expect(computeStampDuty(12_345, 'ESPECE')).toBe(123); // 123.45 → 123
    expect(computeStampDuty(12_355, 'ESPECE')).toBe(124); // 123.55 → 124
  });
});

describe('formatDZD', () => {
  it('formats with no-break-space thousands and comma decimals', () => {
    expect(formatDZD(28_560)).toBe(`28${NBSP}560,00${NBSP}DA`);
    expect(formatDZD(1_234_567.5)).toBe(`1${NBSP}234${NBSP}567,50${NBSP}DA`);
  });

  it('formats small and negative amounts', () => {
    expect(formatDZD(0)).toBe(`0,00${NBSP}DA`);
    expect(formatDZD(999.99)).toBe(`999,99${NBSP}DA`);
    expect(formatDZD(-4_500)).toBe(`-4${NBSP}500,00${NBSP}DA`);
  });
});

describe('formatDZDWhole — table rows', () => {
  it('drops decimals for whole amounts (official template row style)', () => {
    expect(formatDZDWhole(24_000)).toBe(`24${NBSP}000${NBSP}DA`);
    expect(formatDZDWhole(0)).toBe(`0${NBSP}DA`);
  });

  it('keeps 2 decimals for fractional amounts', () => {
    expect(formatDZDWhole(1_500.5)).toBe(`1${NBSP}500,50${NBSP}DA`);
  });
});

describe('amountToFrenchWords', () => {
  it('spells 28560 like the reference invoice', () => {
    expect(amountToFrenchWords(28_560)).toBe(
      'VINGT HUIT MILLE CINQ CENT SOIXANTE DINARS',
    );
  });

  it('spells hundreds with the plural/singular "cent" rules', () => {
    expect(amountToFrenchWords(200)).toBe('DEUX CENTS DINARS');
    expect(amountToFrenchWords(101)).toBe('CENT UN DINARS');
  });

  it('spells millions and the 80/90 special forms', () => {
    expect(amountToFrenchWords(1_000_000)).toBe('UN MILLION DINARS');
    expect(amountToFrenchWords(80)).toBe('QUATRE VINGTS DINARS');
    expect(amountToFrenchWords(91)).toBe('QUATRE VINGT ONZE DINARS');
  });

  it('appends centimes when the net has decimals', () => {
    expect(amountToFrenchWords(28_846.5)).toBe(
      'VINGT HUIT MILLE HUIT CENT QUARANTE SIX DINARS ET CINQUANTE CENTIMES',
    );
  });
});

describe('round2', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(19.005)).toBe(19.01);
    expect(round2(118.994)).toBe(118.99);
  });
});

describe('allocateInvoiceNumber', () => {
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

  it('starts at 01/<year> and zero-pads', () => {
    const inc = makeIncubator();
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '01/2026', seq: 1 });
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '02/2026', seq: 2 });
    expect(inc.invoiceCounters).toEqual({ '2026': 2 });
  });

  it('supports a custom starting range — 07/2026 then 08/2026', () => {
    const inc = makeIncubator();
    expect(allocateInvoiceNumber(inc, 2026, 7)).toEqual({ number: '07/2026', seq: 7 });
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '08/2026', seq: 8 });
  });

  it('does not lower the counter when an earlier free number is used', () => {
    const inc = makeIncubator({ '2026': 9 });
    expect(allocateInvoiceNumber(inc, 2026, 3)).toEqual({ number: '03/2026', seq: 3 });
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '10/2026', seq: 10 });
  });

  it('keeps independent counters per year', () => {
    const inc = makeIncubator({ '2026': 12 });
    expect(allocateInvoiceNumber(inc, 2027)).toEqual({ number: '01/2027', seq: 1 });
    expect(inc.invoiceCounters).toEqual({ '2026': 12, '2027': 1 });
  });

  it('grows past two digits without truncation', () => {
    const inc = makeIncubator({ '2026': 99 });
    expect(allocateInvoiceNumber(inc, 2026)).toEqual({ number: '100/2026', seq: 100 });
  });
});

describe('formatInvoiceNumber', () => {
  it('pads to two digits minimum', () => {
    expect(formatInvoiceNumber(1, 2026)).toBe('01/2026');
    expect(formatInvoiceNumber(42, 2026)).toBe('42/2026');
    expect(formatInvoiceNumber(123, 2026)).toBe('123/2026');
  });
});
