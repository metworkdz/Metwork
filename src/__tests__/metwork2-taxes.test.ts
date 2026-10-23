/**
 * Metwork 2.0 phase 4 — the tax calendar rules, the tax center state
 * (done / receipts / prefill) and the reminder cron.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { obligationsFor, reminderDue, tasksFor, type TaxTask } from '@/lib/tax-calendar';
import { isOwnTaskKey, runTaxReminders, setTaskDone, setTaxRegime, taxCenterFor, taxProfileOf } from '@/server/taxes/service';

vi.mock('@/server/notifications/mock', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/server/notifications/mock')),
  sendTaxReminderNotice: vi.fn(async () => undefined),
}));

const T0 = '2026-01-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';

function user(id: string, role: 'FREELANCER' | 'ENTREPRENEUR', extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

function profile(userId: string, extra: Record<string, unknown> = {}) {
  return {
    userId, headline: null, bio: null, skills: [], languages: [], remote: true, dayRate: null, address: null,
    portfolio: [], legal: null, createdAt: T0, updatedAt: T0,
    invoiceSettings: { invoiceLegalStatus: 'AUTO_ENTREPRENEUR' }, ...extra,
  } as never;
}

const invoice = (issuedAt: string, ht: number, tva = 0) => ({
  id: `inv-${issuedAt}-${ht}`, ownerType: 'FREELANCER', ownerId: 'fl-1', freelancerId: 'fl-1', kind: 'FACTURE', status: 'ISSUED',
  issuedAt, createdAt: issuedAt, totals: { ht, tva, ttc: ht + tva, timbre: 0, net: ht + tva },
}) as never;

beforeEach(async () => {
  await db.update((d) => {
    d.users = [user('fl-1', 'FREELANCER'), user('en-1', 'ENTREPRENEUR')];
    d.freelancerProfiles = [profile('fl-1')];
    d.ventures = [];
    d.taxTaskStates = [];
    d.invoices = [];
    d.notifications = [];
    d.userMemberships = [];
  });
});

describe('rule table', () => {
  it('gives each status its obligations', () => {
    expect(obligationsFor({ status: 'AUTO_ENTREPRENEUR' })).toEqual(['G12', 'G12_BIS', 'IFU_INSTALMENT_SEPT', 'IFU_INSTALMENT_DEC', 'CASNOS_DECLARATION', 'CASNOS_PAYMENT']);
    expect(obligationsFor({ status: 'COMPANY' })).toEqual(['G50', 'G4']);
    expect(obligationsFor({ status: 'LIBERAL_PROFESSION' })).toEqual(['CASNOS_DECLARATION', 'CASNOS_PAYMENT']);
    expect(obligationsFor({ status: 'LIBERAL_PROFESSION', taxRegime: 'REEL' })).toEqual(['CASNOS_DECLARATION', 'CASNOS_PAYMENT', 'G50', 'G13']);
    expect(obligationsFor({ status: 'UNREGISTERED' })).toEqual([]);
    expect(obligationsFor({ status: 'ASSOCIATION' })).toEqual([]);
  });

  it('puts every deadline on its legal date', () => {
    const due = (p: Parameters<typeof tasksFor>[0]) =>
      Object.fromEntries(tasksFor(p, '2026-10-23').map((t) => [t.key, t.dueDate]));
    const ae = due({ status: 'AUTO_ENTREPRENEUR' });
    expect(ae['G12_BIS:2026']).toBe('2027-01-20');
    expect(ae['G12:2027']).toBe('2027-06-30');
    expect(ae['CASNOS_DECLARATION:2027']).toBe('2027-03-01');
    expect(ae['CASNOS_PAYMENT:2027']).toBe('2027-06-30');
    expect(ae['IFU_INSTALMENT_DEC:2026']).toBe('2026-12-15');
    // Missed in the last 60 days stays visible.
    expect(ae['IFU_INSTALMENT_SEPT:2026']).toBe('2026-09-15');
    const co = due({ status: 'COMPANY' });
    expect(co['G50:2026-10']).toBe('2026-11-20');
    expect(co['G50:2026-12']).toBe('2027-01-20');
    expect(co['G4:2026']).toBe('2027-04-30');
  });

  it('starts CASNOS reminders on 1 January, leap year or not, then J-7 and J-1', () => {
    for (const y of [2027, 2028]) {
      const decl: TaxTask = { key: `CASNOS_DECLARATION:${y}`, obligation: 'CASNOS_DECLARATION', period: String(y), dueDate: `${y}-03-01` };
      const pay: TaxTask = { key: `CASNOS_PAYMENT:${y}`, obligation: 'CASNOS_PAYMENT', period: String(y), dueDate: `${y}-06-30` };
      expect(reminderDue(decl, `${y - 1}-12-31`, [])).toBeNull();
      const first = reminderDue(decl, `${y}-01-01`, []);
      expect(first).not.toBeNull();
      expect(reminderDue(decl, `${y}-01-02`, [first!])).toBeNull();
      expect(reminderDue(pay, `${y}-01-01`, [])).not.toBeNull();
    }
    const g12: TaxTask = { key: 'G12:2027', obligation: 'G12', period: '2027', dueDate: '2027-06-30' };
    expect(reminderDue(g12, '2027-06-14', [])).toBeNull();
    expect(reminderDue(g12, '2027-06-15', [])).toBe(15);
    // A late cron sends the tightest reminder reached, once.
    expect(reminderDue(g12, '2027-06-25', [])).toBe(7);
    expect(reminderDue(g12, '2027-06-26', [7])).toBeNull();
    expect(reminderDue(g12, '2027-06-29', [15, 7])).toBe(1);
    expect(reminderDue(g12, '2027-07-01', [])).toBeNull();
  });
});

describe('tax center', () => {
  it('reads the freelancer status from the letterhead and the entrepreneur status from the venture', async () => {
    const d = await db.read();
    expect(taxProfileOf(d, { id: 'fl-1', role: 'FREELANCER' })).toEqual({ status: 'AUTO_ENTREPRENEUR', taxRegime: null });
    expect(taxProfileOf(d, { id: 'en-1', role: 'ENTREPRENEUR' })).toBeNull();
    await db.update((x) => {
      x.ventures = [{ id: 'v1', ownerId: 'en-1', legal: { status: 'COMPANY', taxRegime: 'REEL' } } as never];
    });
    expect(taxProfileOf(await db.read(), { id: 'en-1', role: 'ENTREPRENEUR' })).toEqual({ status: 'COMPANY', taxRegime: 'REEL' });
  });

  it('refuses keys that are not the user\'s own tasks', async () => {
    const p = { status: 'AUTO_ENTREPRENEUR' } as const;
    expect(isOwnTaskKey(p, 'G12:2027', '2026-10-23')).toBe(true);
    expect(isOwnTaskKey(p, 'G50:2026-10', '2026-10-23')).toBe(false);
    expect(isOwnTaskKey(p, 'G12:2026-10', '2026-10-23')).toBe(false);
    expect(isOwnTaskKey(p, 'G12:1999', '2026-10-23')).toBe(false);
    expect(isOwnTaskKey(p, '__proto__', '2026-10-23')).toBe(false);
    expect(await setTaskDone('fl-1', 'G4:2026', true)).toEqual({ ok: false, reason: 'UNKNOWN_TASK' });
    expect(await setTaskDone('en-1', 'G12:2026', true)).toEqual({ ok: false, reason: 'NO_PROFILE' });
  });

  it('marks done and reopens, privately per user', async () => {
    const year = new Date().getUTCFullYear();
    const key = `G12:${year + 1}`;
    const r = await setTaskDone('fl-1', key, true);
    expect(r.ok && r.state.doneAt).toBeTruthy();
    const d = await db.read();
    const today = new Date().toISOString().slice(0, 10);
    expect(taxCenterFor(d, d.users.find((u) => u.id === 'fl-1')!, today).tasks.find((t) => t.key === key)?.state).toBe('DONE');
    const again = await setTaskDone('fl-1', key, false);
    expect(again.ok && again.state.doneAt).toBeNull();
  });

  it('prefills amounts from factures on Premium only', async () => {
    await db.update((d) => {
      d.invoices = [invoice('2026-03-10T10:00:00Z', 1_000_000), invoice('2026-11-02T10:00:00Z', 3_000_000, 0)];
    });
    let d = await db.read();
    const free = taxCenterFor(d, d.users.find((u) => u.id === 'fl-1')!, '2026-12-01');
    expect(free.prefillEnabled).toBe(false);
    expect(free.tasks.every((t) => t.prefill === null)).toBe(true);
    await db.update((x) => {
      const u = x.users.find((y) => y.id === 'fl-1')!;
      u.membershipCode = 'FREELANCER_PREMIUM';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = FUTURE;
    });
    d = await db.read();
    const paid = taxCenterFor(d, d.users.find((u) => u.id === 'fl-1')!, '2026-12-01');
    expect(paid.tasks.find((t) => t.key === 'G12_BIS:2026')?.prefill).toEqual({ turnover: 4_000_000, estimatedIfu: 20_000 });
    expect(paid.tasks.find((t) => t.key === 'G12:2027')?.prefill).toEqual({ turnover: 4_000_000 });
  });

  it('asks a liberal profession for its regime, then follows it', async () => {
    await db.update((d) => { d.freelancerProfiles = [profile('fl-1', { legal: { status: 'LIBERAL_PROFESSION' } })]; });
    let d = await db.read();
    expect(taxCenterFor(d, d.users[0]!, '2026-10-23').needsRegime).toBe(true);
    await setTaxRegime({ id: 'fl-1', role: 'FREELANCER' }, 'REEL');
    d = await db.read();
    const view = taxCenterFor(d, d.users[0]!, '2026-10-23');
    expect(view.needsRegime).toBe(false);
    expect(view.tasks.some((t) => t.obligation === 'G13')).toBe(true);
  });
});

describe('reminder cron', () => {
  it('sends each reminder once and never for a task marked done', async () => {
    const { sendTaxReminderNotice } = await import('@/server/notifications/mock');
    const send = vi.mocked(sendTaxReminderNotice);
    send.mockClear();
    const jan1 = new Date('2027-01-01T08:00:00Z');
    const first = await runTaxReminders(jan1);
    // 1 January: both CASNOS tasks start; G12 bis 2026 (20 Jan) is 19 days out — not yet.
    expect(send.mock.calls.map((c) => c[0].obligation).sort()).toEqual(['CASNOS_DECLARATION', 'CASNOS_PAYMENT']);
    expect(first).toEqual({ sent: 2, users: 1 });
    expect((await runTaxReminders(jan1)).sent).toBe(0);
    expect((await db.read()).notifications.filter((n) => n.userId === 'fl-1')).toHaveLength(2);

    await db.update((d) => {
      d.taxTaskStates!.find((s) => s.key === 'CASNOS_DECLARATION:2027')!.doneAt = '2027-01-10T00:00:00Z';
    });
    send.mockClear();
    await runTaxReminders(new Date('2027-02-22T08:00:00Z'));
    expect(send.mock.calls.map((c) => c[0].obligation)).not.toContain('CASNOS_DECLARATION');
  });
});
