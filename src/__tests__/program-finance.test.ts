/**
 * A program's financial report, and the expenses behind it.
 *
 * The report is money a host will act on, so each booking shape is pinned
 * separately: what it billed, what actually came in, what is still owed, and
 * what the platform took. Then the totals, the participant count (deduped the
 * way seats are), and ownership of every expense route.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const incubatorActor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: incubatorActor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
let consultantId = 'mentor-1';
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: consultantId })),
}));

import { db, type BookingRecord } from '@/server/db/store';
import { bookingMoney, computeProgramFinance } from '@/server/program-finance/report';
import {
  createProgramExpense,
  deleteProgramExpense,
  loadProgramFinances,
  updateProgramExpense,
} from '@/server/program-finance/service';
import { incubatorScope, mentorScope } from '@/server/registrations/service';

const A = incubatorScope('inc-a');
const B = incubatorScope('inc-b');
const M = mentorScope('mentor-1');
const NOW = '2026-09-01T10:00:00.000Z';

function booking(id: string, extra: Partial<BookingRecord>): BookingRecord {
  return {
    id,
    userId: null,
    itemKind: 'PROGRAM',
    itemId: 'p-a',
    itemName: 'P',
    vendorName: 'Hub',
    city: 'Oran',
    unit: 'DAY',
    quantity: 1,
    startsAt: NOW,
    endsAt: NOW,
    totalAmount: 10_000,
    status: 'CONFIRMED',
    clientReference: id,
    transactionId: null,
    clientEmail: `${id}@example.dz`,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as BookingRecord;
}

describe('one booking\'s money', () => {
  it('card, paid in full: all online, commission as frozen', () => {
    expect(bookingMoney(booking('b', {
      paymentMethod: 'card', paymentMode: 'ONLINE_FULL', onlinePaidAmount: 10_000,
      cashRemainingAmount: 0, commissionAmount: 500, payerFeeAmount: 300, onlineChargeAmount: 10_300,
      paymentStatus: 'PAID',
    }))).toEqual({ billed: 10_000, online: 10_000, cash: 0, outstanding: 0, commission: 500, channel: 'CARD' });
  });

  it('card deposit, balance not yet collected: the balance is outstanding', () => {
    expect(bookingMoney(booking('b', {
      paymentMethod: 'card', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 3_000,
      cashRemainingAmount: 7_000, commissionAmount: 150, paymentStatus: 'AWAITING_CASH',
    }))).toMatchObject({ online: 3_000, cash: 0, outstanding: 7_000, commission: 150 });
  });

  it('card deposit, balance collected: the balance is cash in hand', () => {
    expect(bookingMoney(booking('b', {
      paymentMethod: 'card', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 3_000,
      cashRemainingAmount: 7_000, commissionAmount: 150, paymentStatus: 'PAID',
    }))).toMatchObject({ online: 3_000, cash: 7_000, outstanding: 0 });
  });

  it('walk-in at the desk with a cash deposit: no online money, no commission', () => {
    expect(bookingMoney(booking('b', {
      paymentMethod: 'manual', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 0,
      cashDepositPaidAmount: 4_000, cashRemainingAmount: 6_000, paymentStatus: 'AWAITING_CASH',
    }))).toEqual({ billed: 10_000, online: 0, cash: 4_000, outstanding: 6_000, commission: 0, channel: 'CASH' });
  });

  it('wallet and plain manual bookings are paid whole', () => {
    expect(bookingMoney(booking('b', { paymentMethod: 'wallet', commissionAmount: 500 })))
      .toMatchObject({ online: 10_000, cash: 0, channel: 'WALLET', commission: 500 });
    expect(bookingMoney(booking('b', { paymentMethod: 'manual' })))
      .toMatchObject({ online: 0, cash: 10_000, channel: 'CASH' });
  });
});

describe('the report', () => {
  const data = {
    bookings: [
      booking('full', {
        paymentMethod: 'card', paymentMode: 'ONLINE_FULL', onlinePaidAmount: 10_000,
        cashRemainingAmount: 0, commissionAmount: 500, payerFeeAmount: 300, paymentStatus: 'PAID',
        settledAt: '2026-09-02T10:00:00.000Z',
      }),
      booking('deposit', {
        paymentMethod: 'card', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 3_000,
        cashRemainingAmount: 7_000, commissionAmount: 150, paymentStatus: 'AWAITING_CASH',
        settledAt: '2026-09-03T10:00:00.000Z',
      }),
      booking('desk', {
        paymentMethod: 'manual', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 0, totalAmount: 8_000,
        cashDepositPaidAmount: 8_000, cashRemainingAmount: 0, paymentStatus: 'PAID',
        createdAt: '2026-09-03T12:00:00.000Z',
      }),
      // None of these count.
      booking('cancelled', { status: 'CANCELLED', paymentMethod: 'manual' }),
      booking('refunded', { status: 'REFUNDED', paymentMethod: 'wallet' }),
      booking('intent', { status: 'PENDING_PAYMENT', paymentMethod: 'card' }),
      booking('deleted', { status: 'CANCELLED', deletedAt: NOW, paymentMethod: 'manual' }),
      booking('other-program', { itemId: 'p-other', paymentMethod: 'manual' }),
      booking('space', { itemKind: 'SPACE', paymentMethod: 'manual' }),
    ],
    registrations: [
      // Paid registration materialised from its booking — the same person.
      { id: 'r-full', entityType: 'PROGRAM', entityId: 'p-a', status: 'CONFIRMED', userId: null,
        email: 'full@example.dz', bookingId: 'full', createdAt: NOW } as never,
      // Free participants.
      { id: 'r-free', entityType: 'PROGRAM', entityId: 'p-a', status: 'CONFIRMED', userId: null,
        email: 'free@example.dz', createdAt: '2026-09-04T09:00:00.000Z', absent: true } as never,
      { id: 'r-wait', entityType: 'PROGRAM', entityId: 'p-a', status: 'WAITLISTED', userId: null,
        email: 'wait@example.dz', createdAt: NOW } as never,
    ],
    expenses: [
      { id: 'e1', incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-01', title: 'Salle', amount: 6_000, category: 'Salle' },
      { id: 'e2', incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-02', title: 'Café', amount: 1_500, category: 'Pause-café' },
      { id: 'e3', incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-05', title: 'Café 2', amount: 500, category: 'Pause-café' },
      { id: 'e-general', incubatorId: 'inc-a', programId: null, date: '2026-09-02', title: 'Loyer', amount: 90_000, category: null },
    ] as never,
  };

  const report = computeProgramFinance(data, { id: 'p-a', seatsTotal: 10 }, new Date(NOW));

  it('adds up the money', () => {
    expect(report).toMatchObject({
      billed: 28_000,
      collected: 21_000,       // 10 000 card + 3 000 deposit + 8 000 desk
      outstanding: 7_000,
      commission: 650,
      netRevenue: 20_350,
      expensesTotal: 8_000,    // the general 90 000 rent is not this program's
      netProfit: 12_350,
      projectedProfit: 19_350,
    });
    expect(report.margin).toBeCloseTo(12_350 / 21_000);
  });

  it('never counts the payer fee — that is the platform\'s, not the host\'s', () => {
    // Charged 10 300 by card: 10 000 for the seat, 300 fee to the platform.
    const r = computeProgramFinance({ bookings: [booking('fee', {
      paymentMethod: 'card', paymentMode: 'ONLINE_FULL', onlinePaidAmount: 10_000, onlineChargeAmount: 10_300,
      payerFeeAmount: 300, cashRemainingAmount: 0, commissionAmount: 0, paymentStatus: 'PAID',
    })] }, { id: 'p-a', seatsTotal: 10 });
    expect(r).toMatchObject({ billed: 10_000, collected: 10_000, netRevenue: 10_000 });
  });

  it('groups expenses by category, largest first', () => {
    expect(report.expensesByCategory).toEqual([
      { category: 'Salle', amount: 6_000, count: 1 },
      { category: 'Pause-café', amount: 2_000, count: 2 },
    ]);
  });

  it('counts people once, however they signed up', () => {
    expect(report).toMatchObject({
      participants: 4,          // full, deposit, desk, free — not the waitlisted one
      payingParticipants: 3,
      freeParticipants: 1,
      absent: 1,
      fillRate: 0.4,
      seatsTotal: 10,
    });
  });

  it('works out the unit economics', () => {
    expect(report.averageTicket).toBe(Math.round(28_000 / 3));
    expect(report.costPerParticipant).toBe(2_000);
    // Net per paying ticket = (28 000 − 650) / 3 ≈ 9 117 → one ticket covers 8 000.
    expect(report.breakEvenParticipants).toBe(1);
  });

  it('splits what came in by channel', () => {
    expect(report.byChannel).toEqual([
      { channel: 'CARD', amount: 13_000 },
      { channel: 'CASH', amount: 8_000 },
    ]);
  });

  it('draws the sign-up and cash curve by Algiers day, with running totals', () => {
    expect(report.timeline.map((t) => [t.date, t.signups, t.cumulativeSignups, t.collected, t.cumulativeCollected])).toEqual([
      ['2026-09-01', 2, 2, 0, 0],
      ['2026-09-02', 0, 2, 10_000, 10_000],
      ['2026-09-03', 1, 3, 11_000, 21_000],
      ['2026-09-04', 1, 4, 0, 21_000],
    ]);
  });

  it('is all zeros, not NaN, for a program with nothing yet', () => {
    const empty = computeProgramFinance({}, { id: 'p-a', seatsTotal: 0 });
    expect(empty).toMatchObject({
      billed: 0, collected: 0, netProfit: 0, margin: null, fillRate: null,
      averageTicket: null, costPerParticipant: null, breakEvenParticipants: 0,
      byChannel: [], timeline: [],
    });
  });

  it('has no break-even when nobody pays and there are costs', () => {
    const r = computeProgramFinance({ expenses: data.expenses }, { id: 'p-a', seatsTotal: 10 });
    expect(r.breakEvenParticipants).toBeNull();
    expect(r.netProfit).toBe(-8_000);
  });
});

/* ─────────────────────────── Ownership ─────────────────────────── */

beforeEach(async () => {
  consultantId = 'mentor-1';
  await db.update((d) => {
    d.users = [];
    d.incubators = [
      { id: 'inc-a', name: 'Hub A', managerId: 'mgr-a', email: 'a@x.dz', status: 'ACTIVE' } as never,
      { id: 'inc-b', name: 'Hub B', managerId: 'mgr-b', email: 'b@x.dz', status: 'ACTIVE' } as never,
    ];
    d.programs = [
      { id: 'p-a', incubatorId: 'inc-a', mentorId: null, title: 'A', seatsTotal: 10, startDate: NOW, endDate: NOW } as never,
      { id: 'p-b', incubatorId: 'inc-b', mentorId: null, title: 'B', seatsTotal: 10, startDate: NOW, endDate: NOW } as never,
      { id: 'p-m1', incubatorId: null, mentorId: 'mentor-1', title: 'M', seatsTotal: 10, startDate: NOW, endDate: NOW } as never,
    ];
    d.bookings = [];
    d.registrations = [];
    d.expenses = [];
  });
});

const input = { date: '2026-09-10', title: 'Salle', amount: 5_000, category: 'Salle' };

describe('program expenses', () => {
  it('an incubator\'s program expense is an ordinary row of its ledger, tagged', async () => {
    const e = await createProgramExpense('p-a', A, input);
    expect(e).toMatchObject({ incubatorId: 'inc-a', mentorId: null, programId: 'p-a', amount: 5_000 });
    const f = await loadProgramFinances('p-a', A);
    expect(f!.report.expensesTotal).toBe(5_000);
    expect(f!.expenses).toHaveLength(1);
  });

  it('a consultant\'s program expense carries the consultant, not an incubator', async () => {
    const e = await createProgramExpense('p-m1', M, input);
    expect(e).toMatchObject({ incubatorId: null, mentorId: 'mentor-1', programId: 'p-m1' });
  });

  it('nobody reaches another owner\'s program or expenses', async () => {
    expect(await createProgramExpense('p-b', A, input)).toBeNull();
    expect(await createProgramExpense('p-m1', A, input)).toBeNull();
    expect(await createProgramExpense('p-a', M, input)).toBeNull();
    expect(await loadProgramFinances('p-b', A)).toBeNull();

    const theirs = await createProgramExpense('p-b', B, input);
    expect(await updateProgramExpense('p-b', A, theirs!.id, { amount: 1 })).toBeNull();
    expect(await deleteProgramExpense('p-b', A, theirs!.id)).toBe(false);
    // Nor through its own program id.
    expect(await updateProgramExpense('p-a', A, theirs!.id, { amount: 1 })).toBeNull();
    expect(await deleteProgramExpense('p-a', A, theirs!.id)).toBe(false);
    expect((await db.read()).expenses.find((e) => e.id === theirs!.id)!.amount).toBe(5_000);
  });

  it('a row another owner tagged with my program id never reaches my report', async () => {
    await db.update((d) => {
      d.expenses.push({ id: 'x', incubatorId: 'inc-b', programId: 'p-a', date: '2026-09-01', title: 'x',
        description: null, amount: 99_999, category: null, createdAt: NOW, updatedAt: NOW });
    });
    expect((await loadProgramFinances('p-a', A))!.report.expensesTotal).toBe(0);
  });

  it('edits and deletes the owner\'s own expense', async () => {
    const e = await createProgramExpense('p-a', A, input);
    expect(await updateProgramExpense('p-a', A, e!.id, { amount: 7_000, category: '  ' }))
      .toMatchObject({ amount: 7_000, category: null });
    expect(await deleteProgramExpense('p-a', A, e!.id)).toBe(true);
    expect((await db.read()).expenses).toHaveLength(0);
  });
});

describe('the routes', () => {
  const ctx = (id: string, expenseId?: string) => ({ params: Promise.resolve({ id, expenseId: expenseId ?? '' }) });
  const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  it('create, read, patch, delete — incubator', async () => {
    const { POST } = await import('@/app/api/incubator/programs/[id]/finances/expenses/route');
    const created = await POST(req('POST', input), ctx('p-a'));
    expect(created.status).toBe(201);
    const { expense } = await created.json();

    const { GET } = await import('@/app/api/incubator/programs/[id]/finances/route');
    const body = await (await GET(req('GET'), ctx('p-a'))).json();
    expect(body.report.expensesTotal).toBe(5_000);
    expect(body.program).toMatchObject({ id: 'p-a', title: 'A' });

    const { PATCH, DELETE } = await import('@/app/api/incubator/programs/[id]/finances/expenses/[expenseId]/route');
    expect((await PATCH(req('PATCH', { amount: 6_000 }), ctx('p-a', expense.id))).status).toBe(200);
    expect((await DELETE(req('DELETE'), ctx('p-a', expense.id))).status).toBe(200);
    expect((await DELETE(req('DELETE'), ctx('p-a', expense.id))).status).toBe(404);
  });

  it('the consultant routes answer for the consultant\'s own program only', async () => {
    const { POST } = await import('@/app/api/consultant/programs/[id]/finances/expenses/route');
    expect((await POST(req('POST', input), ctx('p-m1'))).status).toBe(201);
    expect((await POST(req('POST', input), ctx('p-a'))).status).toBe(404);
    consultantId = 'mentor-2';
    const { GET } = await import('@/app/api/consultant/programs/[id]/finances/route');
    expect((await GET(req('GET'), ctx('p-m1'))).status).toBe(404);
  });

  it.each([
    ['an impossible date', { date: '2026-02-31' }],
    ['a zero amount', { amount: 0 }],
    ['a decimal amount', { amount: 10.5 }],
    ['an absurd amount', { amount: 2_000_000_000 }],
    ['an empty title', { title: '  ' }],
    ['a receipt hosted elsewhere', { receiptUrl: 'https://evil.example/r.png' }],
  ])('refuses %s', async (_label, patch) => {
    const { POST } = await import('@/app/api/incubator/programs/[id]/finances/expenses/route');
    expect((await POST(req('POST', { ...input, ...patch }), ctx('p-a'))).status).toBe(422);
    expect((await db.read()).expenses).toHaveLength(0);
  });

  it('the general Dépenses ledger can tag its own programs, and only those', async () => {
    const { POST } = await import('@/app/api/incubator/expenses/route');
    const ok = await POST(req('POST', { ...input, programId: 'p-a' }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).programId).toBe('p-a');
    expect((await POST(req('POST', { ...input, programId: 'p-b' }))).status).toBe(404);
    expect((await POST(req('POST', { ...input, programId: 'p-m1' }))).status).toBe(404);

    const { PATCH } = await import('@/app/api/incubator/expenses/[id]/route');
    const general = await (await POST(req('POST', input))).json();
    const patchCtx = { params: Promise.resolve({ id: general.id }) };
    expect((await PATCH(req('PATCH', { programId: 'p-b' }), patchCtx)).status).toBe(404);
    expect((await PATCH(req('PATCH', { programId: 'p-a' }), patchCtx)).status).toBe(200);
    expect((await loadProgramFinances('p-a', A))!.report.expensesTotal).toBe(10_000);
  });
});
