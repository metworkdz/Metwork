/**
 * API-driven e2e: consultant PROGRAM revenue → mentor ledger → withdrawal.
 *
 * Proves the money half of paid consultant programs, end to end:
 *
 *   1. An ENTREPRENEUR pays online for a consultant's paid program → the
 *      consultant's WITHDRAWABLE (AVAILABLE) balance rises by exactly
 *      price × (1 − commissionRate), and the platform's cut is recorded both on
 *      the booking and as a COMMISSION ledger row.
 *   2. Replaying the confirmation (the same thing a double-click, a provider
 *      retry, or a webhook redelivery does) moves NO further money — idempotency
 *      proven from server state, not assumed.
 *   3. An admin editing the MENTOR_PROGRAM commission rule afterwards does NOT
 *      re-split the already-settled booking (the rate is frozen onto the booking
 *      at creation), while a NEW booking created after the edit DOES pick the new
 *      rate up — together proving the rate is read from the admin-editable rule
 *      and never hardcoded.
 *   4. The consultant withdraws those program earnings through the EXISTING
 *      withdrawal service; the request lands in the admin queue and approves
 *      cleanly, with the escrow hold leaving AVAILABLE at request time.
 *
 * Rates are read from the live commission rule, never hard-coded, so a seed
 * drift can't silently invalidate the assertions. Mock provider in SYNC mode.
 * Serial (workers:1, shared seeded mentor).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  cardIntent,
  settleCard,
  payCard,
  findBookingByRef,
  readLocalDb,
  clientRef,
  isoFromNow,
} from './_helpers';
import { mintConsultantContext, MENTOR_ID } from './_consult-helpers';

/** The rule id seeded for consultant-owned programs (see settings-defaults.ts). */
const MENTOR_PROGRAM_RULE_ID = 'rule_mentor_program';

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The LIVE admin-editable platform rate for consultant programs (decimal 0–1). */
function liveProgramRate(): number {
  const rule = (readLocalDb().commissionRules ?? []).find(
    (r) => r.transactionType === 'MENTOR_PROGRAM' && r.isActive,
  );
  expect(rule, 'an active MENTOR_PROGRAM commission rule should exist').toBeTruthy();
  return rule!.rate;
}

/** The seeded mentor's earnings wallet, straight from server state. */
function mentorWallet(): { pending: number; available: number } {
  const w = (readLocalDb().mentorWallets ?? []).find((x) => x.mentorId === MENTOR_ID);
  return { pending: w?.pendingBalance ?? 0, available: w?.availableBalance ?? 0 };
}

/** Every ledger row written against one booking. */
function ledgerFor(bookingId: string) {
  return (readLocalDb().mentorLedgerTxns ?? []).filter((t) => t.bookingId === bookingId);
}

/** Create a paid, ONLINE-only program owned by the seeded consultant. */
async function createPaidProgram(consultant: APIRequestContext, price: number) {
  const res = await consultant.post('/api/consultant/programs', {
    data: {
      title: `QA Revenue Program ${uniq()}`,
      description: 'Automated e2e program-revenue fixture. Safe to delete.',
      type: 'WORKSHOP',
      city: 'Alger',
      price,
      acceptedPaymentMethods: ['ONLINE'],
      seatsTotal: 20,
      deadline: isoFromNow(30),
      startDate: isoFromNow(40),
      endDate: isoFromNow(70),
    },
  });
  expect(res.status(), `createPaidProgram → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json() as Promise<{ id: string; slug: string }>;
}

/** Set the admin-editable MENTOR_PROGRAM rate. */
async function setProgramRate(admin: APIRequestContext, rate: number) {
  const res = await admin.patch(`/api/admin/commission-rules/${MENTOR_PROGRAM_RULE_ID}`, {
    data: { rate },
  });
  expect(res.status(), `set commission rate → ${res.status()} ${await res.text()}`).toBe(200);
}

test.describe.serial('Consultant program revenue → mentor ledger → withdrawal', () => {
  let consultant: APIRequestContext;
  let entrepreneur: APIRequestContext;
  let admin: APIRequestContext;

  /** Carried across the serial tests: the booking settled in test 1. */
  let settledBookingId: string;
  let settledRef: string;
  let settledPrice: number;
  let settledRate: number;
  let expectedNet: number;
  let expectedCut: number;
  /** Rate restored in afterAll so a mid-run failure can't poison other specs. */
  let originalRate: number;

  test.beforeAll(async () => {
    ({ ctx: consultant } = await mintConsultantContext());
    entrepreneur = await roleContext('founder');
    admin = await roleContext('admin');
    originalRate = liveProgramRate();
  });

  test.afterAll(async () => {
    // Always put the admin-editable rate back, then dispose.
    if (admin && liveProgramRate() !== originalRate) await setProgramRate(admin, originalRate);
    await entrepreneur?.dispose();
    await admin?.dispose();
  });

  test('entrepreneur pays online → consultant AVAILABLE balance += price × (1 − rate), platform cut recorded', async () => {
    settledPrice = 20_000;
    settledRate = liveProgramRate();
    expectedCut = Math.round(settledPrice * settledRate);
    expectedNet = settledPrice - expectedCut;

    const program = await createPaidProgram(consultant, settledPrice);
    settledRef = clientRef('rev-online');

    const intent = await cardIntent(entrepreneur, {
      target: { itemKind: 'PROGRAM', programId: program.id },
      paymentMode: 'ONLINE_FULL',
      customer: { fullName: 'QA Founder', email: `qa.rev.${Date.now()}@metwork.test`, phone: '+213700554433' },
      clientReference: settledRef,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    // The rate is FROZEN onto the booking at CREATION, before any money moves.
    const created = findBookingByRef(settledRef)!;
    settledBookingId = created.id;
    expect(created.status, 'intent starts PENDING_PAYMENT').toBe('PENDING_PAYMENT');
    expect(created.mentorCommissionRate, 'mentor rate frozen at creation').toBe(settledRate);

    const before = mentorWallet();
    await settleCard(entrepreneur, token);
    const after = mentorWallet();

    const b = findBookingByRef(settledRef)!;
    expect(b.status, 'settled → CONFIRMED').toBe('CONFIRMED');
    expect(b.paymentStatus, 'paid in full online').toBe('PAID');
    expect(b.onlinePaidAmount, 'whole price collected online').toBe(settledPrice);

    // The headline assertion: withdrawable balance up by exactly the net share.
    expect(after.available - before.available, 'AVAILABLE += price × (1 − rate)').toBe(expectedNet);
    expect(after.pending, 'program earnings take no PENDING hold').toBe(before.pending);

    // The platform's cut is recorded on the booking...
    expect(b.commissionRate, 'settled at the frozen rate').toBe(settledRate);
    expect(b.commissionAmount, 'platform cut on the booking').toBe(expectedCut);

    // ...and as a COMMISSION ledger row (audit-only, never added to the wallet).
    const rows = ledgerFor(settledBookingId);
    const earning = rows.filter((t) => t.type === 'EARNING');
    const commission = rows.filter((t) => t.type === 'COMMISSION');
    expect(earning, 'exactly one EARNING row').toHaveLength(1);
    expect(earning[0]!.amount, 'EARNING = consultant net').toBe(expectedNet);
    expect(earning[0]!.bucket, 'credited straight to AVAILABLE').toBe('AVAILABLE');
    expect(commission, 'exactly one COMMISSION row').toHaveLength(1);
    expect(commission[0]!.amount, 'COMMISSION = −platform cut').toBe(-expectedCut);
  });

  test('replaying the confirmation credits nothing further (idempotent)', async () => {
    const before = mentorWallet();
    const rowsBefore = ledgerFor(settledBookingId).length;

    // Replay the exact call the return page / a webhook redelivery makes.
    const b = findBookingByRef(settledRef)!;
    const replay = await payCard(entrepreneur, b.payToken!, 'verify');
    expect(replay.status(), 'replayed verify is accepted, not an error').toBe(200);
    // ...and again, the way a double-click would.
    await payCard(entrepreneur, b.payToken!, 'verify');

    const after = mentorWallet();
    expect(after.available, 'AVAILABLE unchanged on replay').toBe(before.available);
    expect(after.pending, 'PENDING unchanged on replay').toBe(before.pending);
    expect(ledgerFor(settledBookingId).length, 'no extra ledger rows on replay').toBe(rowsBefore);

    const b2 = findBookingByRef(settledRef)!;
    expect(b2.commissionAmount, 'platform cut unchanged on replay').toBe(expectedCut);
  });

  test('an admin rate change does not re-split the settled booking, but does apply to new bookings', async () => {
    const walletBefore = mentorWallet();
    const newRate = settledRate === 0.4 ? 0.25 : 0.4; // definitely different

    await setProgramRate(admin, newRate);
    expect(liveProgramRate(), 'rule updated').toBe(newRate);

    // The already-settled booking is untouched: same rate, same cut, same rows,
    // same balance. This is what the creation-time freeze buys.
    const b = findBookingByRef(settledRef)!;
    expect(b.mentorCommissionRate, 'frozen rate survives the rule edit').toBe(settledRate);
    expect(b.commissionRate, 'settled rate unchanged').toBe(settledRate);
    expect(b.commissionAmount, 'settled cut unchanged').toBe(expectedCut);

    const rows = ledgerFor(settledBookingId);
    expect(rows.filter((t) => t.type === 'EARNING')[0]!.amount, 'EARNING unchanged').toBe(expectedNet);
    expect(rows.filter((t) => t.type === 'COMMISSION')[0]!.amount, 'COMMISSION unchanged').toBe(-expectedCut);
    expect(mentorWallet().available, 'balance unchanged by the rule edit').toBe(walletBefore.available);

    // A booking created AFTER the edit picks the new rate up — proving the rate
    // is genuinely read from the admin rule and not hardcoded anywhere.
    const price = 10_000;
    const program = await createPaidProgram(consultant, price);
    const ref = clientRef('rev-newrate');
    const intent = await cardIntent(entrepreneur, {
      target: { itemKind: 'PROGRAM', programId: program.id },
      paymentMode: 'ONLINE_FULL',
      customer: { fullName: 'QA Founder', email: `qa.rev2.${Date.now()}@metwork.test`, phone: '+213700554433' },
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    expect(findBookingByRef(ref)!.mentorCommissionRate, 'new booking freezes the NEW rate').toBe(newRate);

    // Settle it too, so the new rate is proven to flow through settlement.
    const { token } = await intent.json();
    const beforeNew = mentorWallet();
    await settleCard(entrepreneur, token);
    expect(
      mentorWallet().available - beforeNew.available,
      'new booking settles at the NEW rate',
    ).toBe(price - Math.round(price * newRate));

    await setProgramRate(admin, originalRate);
  });

  test('consultant withdraws program earnings → lands in the admin queue → approves cleanly', async () => {
    // A bank withdrawal needs a payout account on file (account-first gate).
    const acct = await consultant.put('/api/consultant/payout-account', {
      data: { accountType: 'bank', accountNumber: '00799999000123456789', holderName: 'QA Mentor Expert' },
    });
    expect(acct.status(), `payout account → ${acct.status()} ${await acct.text()}`).toBe(200);

    const before = mentorWallet();
    expect(before.available, 'program earnings are withdrawable').toBeGreaterThanOrEqual(expectedNet);

    // Withdraw an amount that only program earnings could cover.
    const amount = expectedNet;
    const req = await consultant.post('/api/consultant/withdrawals', {
      data: { amount, method: 'bank_transfer' },
    });
    expect(req.status(), `withdrawal request → ${req.status()} ${await req.text()}`).toBe(201);
    const { withdrawal } = await req.json();
    expect(withdrawal.status, 'created PENDING').toBe('PENDING');

    // Hold-at-request: the money leaves AVAILABLE immediately.
    expect(mentorWallet().available, 'escrow hold leaves AVAILABLE').toBe(before.available - amount);

    // It shows up in the admin queue…
    const queue = await admin.get('/api/admin/mentor-withdrawals');
    expect(queue.status(), `admin queue → ${queue.status()} ${await queue.text()}`).toBe(200);
    const { items } = await queue.json();
    const mine = (items as Array<{ id: string; status: string; amount: number }>).find(
      (w) => w.id === withdrawal.id,
    );
    expect(mine, 'request visible to admin').toBeTruthy();
    expect(mine!.amount, 'queued for the requested amount').toBe(amount);

    // …and approves cleanly.
    const approve = await admin.patch(`/api/admin/mentor-withdrawals/${withdrawal.id}`, {
      data: { status: 'APPROVED' },
    });
    expect(approve.status(), `approve → ${approve.status()} ${await approve.text()}`).toBe(200);

    const afterApprove = mentorWallet();
    expect(afterApprove.available, 'approval does not re-debit (money left at request time)')
      .toBe(before.available - amount);
    const finalRow = (readLocalDb().mentorWithdrawals ?? []).find((w) => w.id === withdrawal.id);
    expect(finalRow?.status, 'withdrawal marked APPROVED').toBe('APPROVED');
  });
});
