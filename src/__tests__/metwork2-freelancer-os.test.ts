/**
 * Metwork 2.0 phase 3a — freelancers as the third invoice issuer, their
 * Free-plan limits, and DZD payment links paid into their own wallet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ user: { id: 'fl-1', email: 'fl-1@x.dz', role: 'FREELANCER' as string } }));
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: session.user }));
  return { requireApiRole: guard, requireApprovedApiRole: guard, requireApiSession: guard, requireApprovedApiSession: guard };
});
vi.mock('@/server/notifications/mock', async (orig) => {
  const actual = await orig<typeof NotificationsModule>();
  return { ...actual, sendPaymentLinkReceiptEmail: vi.fn(async () => undefined), sendPaymentLinkPaidIncubatorEmail: vi.fn(async () => undefined) };
});

import type * as NotificationsModule from '@/server/notifications/mock';
import { db } from '@/server/db/store';
import { issueInvoice } from '@/server/invoices/issue';
import { clientsFor, invoicesFor, ownsInvoice } from '@/server/invoices/owner';
import { updateFreelancerInvoiceSettings } from '@/server/invoices/freelancer-access';
import { emptyProfile } from '@/server/freelancers/service';
import {
  cancelPaymentLink,
  createPaymentLink,
  listPaymentLinks,
  settlePaymentLinkFromWebhook,
} from '@/server/payments/payment-links';

const T0 = '2026-11-01T10:00:00.000Z';
const FREELANCER = { type: 'FREELANCER' as const, id: 'fl-1' };
const INCUBATOR = { type: 'INCUBATOR' as const, id: 'inc-1' };
const LINES = [{ designation: 'Maquettes Figma', quantity: 1, unitPriceHt: 45_000 }];
const draft = () => ({ clientType: 'INDIVIDUAL' as const, name: 'Café Djurdjura' });

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

async function completeLetterhead(userId = 'fl-1') {
  await updateFreelancerInvoiceSettings(userId, {
    invoiceLegalStatus: 'AUTO_ENTREPRENEUR', invoiceRegNumber: 'AE-16-0012345', nif: '000016001234567', address: 'Alger',
  });
}

beforeEach(async () => {
  session.user = { id: 'fl-1', email: 'fl-1@x.dz', role: 'FREELANCER' };
  await db.update((d) => {
    d.users = [user('fl-1', 'FREELANCER'), user('mgr-1', 'INCUBATOR')];
    d.freelancerProfiles = [emptyProfile('fl-1', T0)];
    d.incubators = [{ id: 'inc-1', managerId: 'mgr-1', name: 'Hub', city: 'alger', email: 'hub@x.dz', commercialRegNumber: 'RC1', nif: 'NIF1', subscriptionCode: 'COMMISSION', status: 'ACTIVE', createdAt: T0, updatedAt: T0 } as never];
    d.invoices = [];
    d.clients = [];
    d.paymentLinks = [];
    d.wallets = [];
    d.transactions = [];
    d.userMemberships = [];
  });
});

describe('freelancer as invoice issuer', () => {
  it('refuses to issue before the legal details are complete', async () => {
    const r = await issueInvoice(FREELANCER, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(r).toMatchObject({ ok: false, code: 'ISSUER_LEGAL_INCOMPLETE' });
  });

  it('issues with its own numbering, its own letterhead and no VAT by default as auto-entrepreneur', async () => {
    await completeLetterhead();
    const a = await issueInvoice(FREELANCER, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    const b = await issueInvoice(INCUBATOR, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.invoice.freelancerId).toBe('fl-1');
    expect(a.invoice.incubatorId).toBeUndefined();
    expect(a.invoice.issuerSnapshot).toMatchObject({ name: 'Amine Kaci', rcLabel: 'Carte AE', rc: 'AE-16-0012345' });
    // Both are the first facture of the year: counters are per issuer.
    expect(a.invoice.number).toBe(b.invoice.number);
    const d = await db.read();
    expect(invoicesFor(d, FREELANCER).map((i) => i.id)).toEqual([a.invoice.id]);
    expect(invoicesFor(d, INCUBATOR).map((i) => i.id)).toEqual([b.invoice.id]);
    expect(ownsInvoice(a.invoice, INCUBATOR)).toBe(false);
    // An inline client is a snapshot on the document, not a book entry.
    expect(clientsFor(d, FREELANCER)).toHaveLength(0);
    expect(d.freelancerProfiles![0]!.invoiceCounters).toBeTruthy();
  });

  it('pre-fills the registration number from an approved business document', async () => {
    await db.update((d) => {
      d.freelancerProfiles![0]!.legal = {
        status: 'AUTO_ENTREPRENEUR', documentKind: 'AUTO_ENTREPRENEUR_CARD', documentPublicId: 'x', mimeType: 'image/png', submittedAt: T0,
        extracted: { documentType: 'AUTO_ENTREPRENEUR_CARD', holderName: 'KACI Amine', documentNumber: 'AE 99-777777', activity: null, issueDate: null, expiryDate: null, legible: true, confidence: 0.9 },
        numberKey: 'AE99777777', review: { state: 'APPROVED', by: 'AUTO', reasons: [], at: T0 },
      };
    });
    await updateFreelancerInvoiceSettings('fl-1', { nif: '123' });
    const s = (await db.read()).freelancerProfiles![0]!.invoiceSettings!;
    expect(s).toMatchObject({ invoiceRegNumber: 'AE 99-777777', invoiceLegalStatus: 'AUTO_ENTREPRENEUR', nif: '123' });
  });
});

describe('Free-plan limits on the routes', () => {
  async function post(path: string, body: unknown) {
    const mod = path === 'invoices'
      ? await import('@/app/api/freelancer/invoices/route')
      : await import('@/app/api/freelancer/clients/route');
    const res = await mod.POST(new NextRequest(`http://localhost/api/freelancer/${path}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }));
    return { status: res.status, body: await res.json() };
  }

  it('allows 5 documents a month on Free, then refuses with PLAN_LIMIT_REACHED', async () => {
    await completeLetterhead();
    for (let i = 0; i < 5; i++) {
      expect((await post('invoices', { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' })).status).toBe(201);
    }
    const sixth = await post('invoices', { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(sixth.status).toBe(403);
    expect(sixth.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('lifts the limit on Premium', async () => {
    await completeLetterhead();
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'fl-1')!;
      u.membershipCode = 'FREELANCER_PREMIUM';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = '2030-01-01T00:00:00.000Z';
    });
    for (let i = 0; i < 6; i++) {
      expect((await post('invoices', { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' })).status).toBe(201);
    }
  });
});

describe('freelancer payment links', () => {
  it('pays the base into the freelancer wallet minus 3 % on Free, exactly once', async () => {
    const link = await createPaymentLink({ freelancerId: 'fl-1', serviceName: 'Logo', amount: 45_000, hasExpiry: false });
    expect(await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED')).toBe('SETTLED');
    expect(await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED')).toBe('ALREADY');
    const d = await db.read();
    expect(d.wallets.find((w) => w.userId === 'fl-1')!.balance).toBe(45_000 - 1_350);
    expect(d.wallets.find((w) => w.userId === 'mgr-1')).toBeUndefined();
    expect(d.paymentLinks!.find((l) => l.id === link.id)).toMatchObject({ status: 'PAID', commissionRate: 0.03, commissionAmount: 1_350 });
    expect(d.transactions.filter((t) => t.userId === 'fl-1').map((t) => t.type).sort()).toEqual(['COMMISSION', 'PAYOUT']);
  });

  it('takes no fee from a Premium freelancer', async () => {
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'fl-1')!;
      u.membershipCode = 'FREELANCER_PREMIUM';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = '2030-01-01T00:00:00.000Z';
    });
    const link = await createPaymentLink({ freelancerId: 'fl-1', serviceName: 'Logo', amount: 45_000, hasExpiry: false });
    await settlePaymentLinkFromWebhook(link.id, 'ref-2', 'COMPLETED');
    const d = await db.read();
    expect(d.wallets.find((w) => w.userId === 'fl-1')!.balance).toBe(45_000);
    expect(d.transactions.some((t) => t.type === 'COMMISSION')).toBe(false);
  });

  it('keeps incubator and freelancer links apart', async () => {
    const mine = await createPaymentLink({ freelancerId: 'fl-1', serviceName: 'A', amount: 1_000, hasExpiry: false });
    const theirs = await createPaymentLink({ incubatorId: 'inc-1', serviceName: 'B', amount: 1_000, hasExpiry: false });
    expect((await listPaymentLinks({ freelancerId: 'fl-1' })).map((l) => l.id)).toEqual([mine.id]);
    expect((await listPaymentLinks('inc-1')).map((l) => l.id)).toEqual([theirs.id]);
    expect(await cancelPaymentLink(theirs.id, { freelancerId: 'fl-1' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect((await cancelPaymentLink(mine.id, { freelancerId: 'fl-1' })).ok).toBe(true);
  });

  it('refuses a third active link on Free', async () => {
    const { POST } = await import('@/app/api/freelancer/payment-links/route');
    const make = () => POST(new NextRequest('http://localhost/api/freelancer/payment-links', {
      method: 'POST', body: JSON.stringify({ serviceName: 'Site', amount: 10_000 }), headers: { 'content-type': 'application/json' },
    }));
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(403);
  });
});
