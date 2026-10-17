/**
 * The consultant routes share the draft rules, scoped to the consultant:
 * another issuer's proforma is simply not found.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/consultations/instant-book', () => ({ isInstantBookEnabled: () => true }));
vi.mock('@/server/invoices/consultant-access', () => ({
  requireInvoicingConsultant: vi.fn(async () => ({ ok: true, owner: { type: 'CONSULTANT', id: 'm-1' } })),
}));

import { db } from '@/server/db/store';
import { PATCH, PUT } from '@/app/api/consultant/invoices/[id]/route';
import { POST as CONVERT } from '@/app/api/consultant/invoices/[id]/convert/route';

const NOW = '2026-01-01T00:00:00.000Z';
const doc = (id: string, owner: Record<string, string>) => ({
  id, ...owner, kind: 'PROFORMA', number: 'FP 01/2026', year: 2026, seq: 1, issuedAt: NOW, clientId: null,
  clientSnapshot: { clientType: 'INDIVIDUAL', name: 'X' }, issuerSnapshot: { name: 'I' },
  lines: [{ designation: 'A', quantity: 1, unitPriceHt: 1000 }], vatRate: 0, paymentMethod: 'ESPECE',
  template: 'CLASSIC', totals: { ht: 1000, tva: 0, ttc: 1000, timbre: 0, net: 1000 }, amountInWords: 'x',
  status: 'ISSUED', createdAt: NOW, updatedAt: NOW,
}) as never;

beforeEach(async () => {
  await db.update((d) => { d.invoices = [doc('inc-doc', { incubatorId: 'inc-1' }), doc('other-m', { mentorId: 'm-2' })]; });
});

const req = (method: string, body: unknown) => new NextRequest('http://localhost/x', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('consultant draft routes', () => {
  it('never reach an incubator’s or another consultant’s document', async () => {
    for (const id of ['inc-doc', 'other-m']) {
      expect((await PATCH(req('PATCH', { withStamp: false }), ctx(id))).status).toBe(404);
      expect((await CONVERT(req('POST', { paymentMethod: 'ESPECE', withStamp: false }), ctx(id))).status).toBe(404);
      expect((await PUT(req('PUT', { clientDraft: { clientType: 'INDIVIDUAL', name: 'Y' }, lines: [{ designation: 'B', quantity: 1, unitPriceHt: 5 }], paymentMethod: 'ESPECE' }), ctx(id))).status).toBe(404);
    }
    const d = await db.read();
    expect(d.invoices!.every((i) => !i.convertedToInvoiceId && i.lines[0]!.designation === 'A')).toBe(true);
  });
});
