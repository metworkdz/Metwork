/**
 * Shared helpers for the invoicing e2e suite (`--project=invoices`).
 *
 * Same design constraints as _helpers.ts: reuse the global-setup cookies (no
 * per-test logins — the login route is rate-limited), run SERIALLY against the
 * one local JSON doc, and make every suite create/repair its own issuer state
 * so specs never depend on what a previous run left behind.
 */
import { expect, type APIRequestContext } from '@playwright/test';

export interface InvoiceLineInput {
  designation: string;
  quantity: number;
  unitPriceHt: number;
}

export interface ClientDraftInput {
  clientType: 'COMPANY' | 'INDIVIDUAL';
  name: string;
  legalName?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  nis?: string | null;
  ai?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface InvoiceView {
  id: string;
  number: string;
  year: number;
  seq: number;
  status: 'ISSUED' | 'CANCELLED';
  vatRate: number;
  paymentMethod: 'ESPECE' | 'CHEQUE' | 'VIREMENT';
  template: 'CLASSIC' | 'GREEN_BAND' | 'MINIMAL';
  lines: InvoiceLineInput[];
  totals: { ht: number; tva: number; ttc: number; timbre: number; net: number };
  amountInWords: string;
  clientSnapshot: { clientType: string; name: string; legalName?: string | null };
  issuerSnapshot: { name: string; rc?: string | null; nif?: string | null };
}

/** Issuer legal header used by every suite — idempotent to re-apply. */
export const ISSUER = {
  address: '12 Rue Didouche Mourad, Alger',
  commercialRegNumber: '16/00-7654321B24',
  nif: '002616987654321',
  nis: '002616987654320',
  ai: '16987654321',
  bankName: 'BNA — Agence QA',
  bankRib: '00100000000000000000',
  contactEmail: 'contact@qahub.test',
  contactPhone: '06 70 10 91 05',
} as const;

/**
 * Make sure the seeded incubator can issue invoices: name/RC/NIF (legal gate)
 * + bank RIB (VIREMENT gate). Idempotent — safe at the top of every spec.
 */
export async function ensureIssuerLegal(inc: APIRequestContext): Promise<void> {
  const res = await inc.patch('/api/incubator/profile', { data: ISSUER });
  expect(res.ok(), `profile PATCH failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Set the invoicing defaults consumed by the create form. */
export async function setInvoiceDefaults(
  inc: APIRequestContext,
  defaults: { defaultVatRate?: number; invoiceTemplate?: 'CLASSIC' | 'GREEN_BAND' | 'MINIMAL' },
): Promise<void> {
  const res = await inc.patch('/api/incubator/profile', { data: defaults });
  expect(res.ok(), `defaults PATCH failed: ${res.status()}`).toBeTruthy();
}

/** A minimal valid ad-hoc recipient. */
export function draftClient(overrides: Partial<ClientDraftInput> = {}): ClientDraftInput {
  return {
    clientType: 'COMPANY',
    name: 'QA Contact',
    legalName: 'Test SARL QA Invoices',
    address: 'Bab Ezzouar, Alger',
    rc: '16/00-1234567B26',
    nif: '002616123456789',
    ...overrides,
  };
}

/** Issue an invoice through the real API and return the stored record. */
export async function createInvoiceApi(
  inc: APIRequestContext,
  input: {
    lines: InvoiceLineInput[];
    paymentMethod: 'ESPECE' | 'CHEQUE' | 'VIREMENT';
    vatRate?: number;
    template?: 'CLASSIC' | 'GREEN_BAND' | 'MINIMAL';
    clientDraft?: ClientDraftInput;
    clientId?: string;
    seq?: number;
  },
): Promise<InvoiceView> {
  const res = await inc.post('/api/incubator/invoices', {
    data: {
      clientDraft: input.clientId ? undefined : (input.clientDraft ?? draftClient()),
      clientId: input.clientId,
      lines: input.lines,
      vatRate: input.vatRate,
      paymentMethod: input.paymentMethod,
      template: input.template,
      seq: input.seq,
    },
  });
  expect(res.status(), `invoice POST failed: ${await res.text()}`).toBe(201);
  return await res.json() as InvoiceView;
}

/** GET a single invoice (tenant-checked route). */
export async function getInvoiceApi(inc: APIRequestContext, id: string): Promise<InvoiceView> {
  const res = await inc.get(`/api/incubator/invoices/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json() as { invoice: InvoiceView };
  return body.invoice;
}

/**
 * Download the invoice PDF and assert it really is one:
 * 200, application/pdf, attachment filename `Facture_NN_YYYY.pdf`, %PDF magic.
 */
export async function fetchInvoicePdf(
  inc: APIRequestContext,
  invoice: Pick<InvoiceView, 'id' | 'number'>,
): Promise<Buffer> {
  const res = await inc.get(`/api/incubator/invoices/${invoice.id}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  const expectedName = `Facture_${invoice.number.replace(/\//g, '_')}.pdf`;
  expect(res.headers()['content-disposition']).toContain(expectedName);
  const body = await res.body();
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(body.length).toBeGreaterThan(10_000); // embedded fonts ⇒ non-trivial
  return body;
}
